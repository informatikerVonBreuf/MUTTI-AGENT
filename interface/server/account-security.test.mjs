import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {base32Decode,base32Encode,createAccountLocks,newTotpSecret,passwordProblems,totpCode,verifyTotp} from './account-security.mjs';
import {createHumanCheck,solveChallenge,leadingZeroBits} from './human-check.mjs';
import {createAuthService,deviceLabel} from './auth-service.mjs';

async function temp(t,prefix){const directory=await fs.mkdtemp(path.join(os.tmpdir(),prefix));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return directory;}

test('TOTP conforme à la RFC 6238 (vecteur SHA-1), fenêtre ±30 s et anti-rejeu',()=>{
  // Vecteur de test RFC 6238 : clé ASCII « 12345678901234567890 », T = 59 s → 94287082 (8 chiffres) → 287082.
  const secret=base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(totpCode(secret,1),'287082');
  assert.deepEqual(base32Decode(secret),Buffer.from('12345678901234567890'));
  const fresh=newTotpSecret(),now=1_800_000_000_000,step=Math.floor(now/30000);
  assert.equal(verifyTotp(fresh,totpCode(fresh,step),{now}),step);
  assert.equal(verifyTotp(fresh,totpCode(fresh,step-1),{now}),step-1);
  assert.equal(verifyTotp(fresh,totpCode(fresh,step-3),{now}),null);
  assert.equal(verifyTotp(fresh,totpCode(fresh,step),{now,lastStep:step}),null);
  assert.equal(verifyTotp(fresh,'12345a',{now}),null);
});

test('Mot de passe : longueur, mots de passe courants, adresse reprise, diversité',()=>{
  assert.deepEqual(passwordProblems('Analyse comparative des marges 2026','owner@example.test'),[]);
  assert.ok(passwordProblems('court','a@b.c').length);
  assert.ok(passwordProblems('motdepasse123','a@b.c').some(p=>p.includes('courant')));
  assert.ok(passwordProblems('azertyuiop12','a@b.c').some(p=>p.includes('courant')));
  assert.ok(passwordProblems('aaaaaaaaaaaaaaa','a@b.c').length);
  assert.ok(passwordProblems('owner@example.test2026','owner@example.test').some(p=>p.includes('adresse')));
});

test('Verrou de compte progressif, indépendant de l’adresse IP',()=>{
  let now=0;const locks=createAccountLocks({now:()=>now,threshold:3,base:1000});
  for(let i=0;i<3;i++)locks.failure('a@b.c');assert.equal(locks.lockedUntil('a@b.c'),1000);
  now=1001;for(let i=0;i<3;i++)locks.failure('a@b.c');assert.equal(locks.lockedUntil('a@b.c'),1001+2000);
  locks.success('a@b.c');assert.equal(locks.lockedUntil('a@b.c'),0);assert.equal(locks.lockedUntil('autre@b.c'),0);
});

test('Anti-robot : preuve de travail, signature, délai minimal, usage unique, champ piège',async t=>{
  const directory=await temp(t,'folio-human-');let now=1_000_000;const check=await createHumanCheck({storageDirectory:directory,now:()=>now,difficulty:10});
  const issued=check.issue();const nonce=solveChallenge(issued.challenge,issued.difficulty);
  assert.equal(check.verify({challenge:issued.challenge,nonce}),'too_fast');
  now+=1000;assert.equal(check.verify(undefined),'missing');
  assert.equal(check.verify({challenge:issued.challenge,nonce,trap:'rempli par un robot'}),'trap');
  assert.equal(check.verify({challenge:issued.challenge.replace(/.$/,c=>c==='A'?'B':'A'),nonce}),'bad_signature');
  const wrong=String(Number(nonce)+1);if(leadingZeroBits(require_hash(issued.challenge,wrong))<10)assert.equal(check.verify({challenge:issued.challenge,nonce:wrong}),'unsolved');
  assert.equal(check.verify({challenge:issued.challenge,nonce}),null);
  assert.equal(check.verify({challenge:issued.challenge,nonce}),'replayed');
  const late=check.issue();now+=6*60*1000;assert.equal(check.verify({challenge:late.challenge,nonce:solveChallenge(late.challenge,late.difficulty)}),'expired');
});
import {powHash} from './human-check.mjs';
function require_hash(challenge,nonce){const {salt}=JSON.parse(Buffer.from(challenge.split('.')[0],'base64url').toString('utf8'));return powHash(salt,nonce);}

const request=(cookie='',ip='127.0.0.1',ua='Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36')=>({headers:{cookie,'user-agent':ua},socket:{remoteAddress:ip}});
const cookieOf=result=>result.cookie.split(';')[0];
async function authFixture(t){const directory=await temp(t,'folio-accounts-');let clock=1_800_000_000_000;const auth=await createAuthService({storageDirectory:directory,now:()=>clock});t.after(()=>auth.close());const owner=await auth.setup({email:'owner@example.test',password:'Fixture-only passphrase for local tests'},request());return {auth,directory,owner,ownerUser:owner.session.user,advance:ms=>clock+=ms,now:()=>clock};}

test('Sous-comptes : invitation, mot de passe imposé, entreprises, désactivation et suppression',async t=>{
  const {auth,ownerUser,directory}=await authFixture(t);
  const {member,invitationCode}=await auth.createMember(ownerUser,{email:'Analyste@Example.test',companies:['apple','meta']});
  assert.equal(member.email,'analyste@example.test');assert.equal(member.mustChangePassword,true);assert.deepEqual(auth.companiesFor(member.id),['apple','meta']);
  await assert.rejects(auth.createMember(ownerUser,{email:'analyste@example.test',companies:['apple']}),error=>error.code==='ACCOUNT_EXISTS');
  const stored=await fs.readFile(path.join(directory,'auth/members.json'),'utf8');assert.ok(!stored.includes(invitationCode));
  const login=await auth.login({email:'analyste@example.test',password:invitationCode},request());const session=auth.session(request(cookieOf(login)));
  assert.equal(session.user.role,'member');assert.equal(session.user.mustChangePassword,true);
  assert.throws(()=>auth.listMembers(session.user),error=>error.code==='FORBIDDEN');
  await assert.rejects(auth.changePassword(session.user,{currentPassword:invitationCode,newPassword:'motdepasse123'},request(cookieOf(login))),error=>error.code==='WEAK_PASSWORD');
  await auth.changePassword(session.user,{currentPassword:invitationCode,newPassword:'Analyse comparative des marges 2026'},request(cookieOf(login)));
  assert.equal(auth.session(request(cookieOf(login))).user.mustChangePassword,undefined);
  await auth.updateMember(ownerUser,member.id,{disabled:true});
  assert.equal(auth.session(request(cookieOf(login))).authenticated,false);
  await assert.rejects(auth.login({email:'analyste@example.test',password:'Analyse comparative des marges 2026'},request()),error=>error.code==='INVALID_CREDENTIALS');
  const reset=await auth.updateMember(ownerUser,member.id,{disabled:false,resetInvitation:true});assert.match(reset.invitationCode,/^[A-Za-z0-9_-]{43}$/);
  await auth.deleteMember(ownerUser,member.id);assert.equal(auth.listMembers(ownerUser).length,0);assert.equal(auth.companiesFor(member.id),null);
});

test('Double authentification : défi après mot de passe, code à usage unique, désactivation contrôlée',async t=>{
  const {auth,ownerUser,owner,now}=await authFixture(t);
  const setup=auth.mfaSetup(ownerUser);const step=Math.floor(now()/30000);
  await assert.rejects(auth.mfaEnable(ownerUser,{code:totpCode(setup.secret,step),password:'faux mot de passe'},request(cookieOf(owner))),error=>error.code==='INVALID_CREDENTIALS');
  await auth.mfaEnable(ownerUser,{code:totpCode(setup.secret,step),password:'Fixture-only passphrase for local tests'},request(cookieOf(owner)));
  const first=await auth.login({email:'owner@example.test',password:'Fixture-only passphrase for local tests'},request('','10.0.0.2'));
  assert.equal(first.mfaRequired,true);assert.equal(first.cookie,undefined);
  await assert.rejects(auth.verifyMfa({challenge:first.challenge,code:totpCode(setup.secret,step)},request('','10.0.0.2')),error=>error.code==='INVALID_MFA');
  const done=await auth.verifyMfa({challenge:first.challenge,code:totpCode(setup.secret,step+1)},request('','10.0.0.2'));assert.equal(done.session.authenticated,true);
  await assert.rejects(auth.verifyMfa({challenge:first.challenge,code:totpCode(setup.secret,step+1)},request()),error=>error.code==='MFA_EXPIRED');
  assert.equal(auth.accountInfo(ownerUser).mfaEnabled,true);
});

test('Sessions : liste par appareil, déconnexion des autres, verrou par compte malgré des IP changeantes',async t=>{
  const {auth,ownerUser,owner}=await authFixture(t);
  const other=await auth.login({email:'owner@example.test',password:'Fixture-only passphrase for local tests'},request('','10.0.0.9','Mozilla/5.0 (iPhone) Safari/604.1'));
  const list=auth.listSessions(ownerUser,request(cookieOf(owner)));assert.equal(list.length,2);assert.equal(list.filter(s=>s.current).length,1);assert.ok(list.some(s=>s.device==='Safari · iOS'));
  assert.equal((await auth.revokeOtherSessions(ownerUser,request(cookieOf(owner)))).revoked,1);assert.equal(auth.session(request(cookieOf(other))).authenticated,false);
  // Attaque distribuée : 8 adresses IP différentes, puis le compte est verrouillé même pour une nouvelle IP.
  for(let i=0;i<8;i++)await assert.rejects(auth.login({email:'owner@example.test',password:'mauvais mot de passe'},request('','10.1.0.'+i)),error=>error.code==='INVALID_CREDENTIALS');
  await assert.rejects(auth.login({email:'owner@example.test',password:'Fixture-only passphrase for local tests'},request('','10.2.0.1')),error=>error.code==='RATE_LIMITED');
  assert.equal(deviceLabel('Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/130 Edg/130'),'Edge · Windows');
});
