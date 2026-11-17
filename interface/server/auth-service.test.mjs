import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createAuthService} from './auth-service.mjs';
const password='Fixture-only passphrase for local tests',email='owner@example.test';
const request=(cookie='')=>({headers:{cookie},socket:{remoteAddress:'127.0.0.1'}});
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'folio-auth-'));let clock=Date.now();const options={storageDirectory:root,now:()=>clock};const auth=await createAuthService(options);t.after(async()=>{await auth.close();assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(root,{recursive:true,force:true});});return {auth,root,options,advance:milliseconds=>clock+=milliseconds};}
test('Le premier compte crée une session protégée sans stocker mot de passe, code ou cookie en clair',async t=>{
  const {auth,root}=await fixture(t);assert.equal(auth.status().setupRequired,true);assert.equal(auth.status().apiProtected,true);assert.equal(auth.status().localPreviewAllowed,false);
  const result=await auth.setup({email,password},request());assert.equal(auth.status().setupRequired,false);assert.match(result.cookie,/HttpOnly; SameSite=Strict/);assert.equal(auth.session(request(result.cookie)).authenticated,true);
  const stored=(await fs.readFile(path.join(root,'auth/owner.json'),'utf8'))+(await fs.readFile(path.join(root,'auth/sessions.json'),'utf8'));
  for(const sensitive of [password,result.recoveryCode,result.cookie.split(';')[0].split('=')[1]])assert.ok(!stored.includes(sensitive));
  assert.equal(auth.session(request('folio_session=forged')).authenticated,false);assert.ok(!JSON.stringify(auth.status()).includes(email));
});
test('Connexion valide, erreur générique, rotation et révocation du cookie',async t=>{
  const {auth}=await fixture(t),first=await auth.setup({email,password},request());
  for(const fields of [{email,password:'wrong'},{email:'unknown@example.test',password}])await assert.rejects(auth.login(fields,request()),error=>error.code==='INVALID_CREDENTIALS'&&error.status===401);
  const second=await auth.login({email,password},request(first.cookie));assert.equal(auth.session(request(first.cookie)).authenticated,false);assert.equal(auth.session(request(second.cookie)).authenticated,true);
  await auth.logout(request(second.cookie));assert.equal(auth.session(request(second.cookie)).authenticated,false);
});
test('La session survit au redémarrage et expire côté serveur',async t=>{
  const {auth,options,advance}=await fixture(t),created=await auth.setup({email,password},request());await auth.close();const reopened=await createAuthService(options);
  try{assert.equal(reopened.session(request(created.cookie)).authenticated,true);advance(8*60*60*1000+1);assert.equal(reopened.session(request(created.cookie)).authenticated,false);}finally{await reopened.close();}
});
test('Le code de récupération est à usage unique et révoque toutes les sessions',async t=>{
  const {auth}=await fixture(t),created=await auth.setup({email,password},request());const next=await auth.reset({email,recoveryCode:created.recoveryCode,newPassword:'A different fixture passphrase'},request());
  assert.equal(auth.session(request(created.cookie)).authenticated,false);assert.notEqual(next.recoveryCode,created.recoveryCode);
  await assert.rejects(auth.reset({email,recoveryCode:created.recoveryCode,newPassword:'Another fixture passphrase'},request()),error=>error.code==='INVALID_RECOVERY');
  await assert.rejects(auth.login({email,password},request()),error=>error.code==='INVALID_CREDENTIALS');assert.equal((await auth.login({email,password:'A different fixture passphrase'},request())).session.authenticated,true);
});
test('Le premier compte ne peut être créé deux fois, même simultanément',async t=>{
  const {auth}=await fixture(t);const results=await Promise.allSettled([auth.setup({email,password},request()),auth.setup({email:'other@example.test',password},request())]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'SETUP_CLOSED');
});
test('Six échecs déclenchent la limite et un mode Cognito incomplet reste fermé',async t=>{
  const {auth,root}=await fixture(t);await auth.setup({email,password},request());for(let i=0;i<6;i++)await assert.rejects(auth.login({email,password:'wrong'},request()),error=>error.code==='INVALID_CREDENTIALS');await assert.rejects(auth.login({email,password},request()),error=>error.code==='RATE_LIMITED');
  const aws=await createAuthService({storageDirectory:path.join(root,'aws'),values:{FOLIO_AUTH_MODE:'cognito'}});try{assert.equal(aws.status().configured,false);assert.equal(aws.status().apiProtected,true);assert.equal(aws.session(request()).authenticated,false);await assert.rejects(aws.oauthStart(request()),error=>error.code==='AUTH_NOT_CONNECTED');}finally{await aws.close();}
});
