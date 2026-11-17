import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {solveChallenge} from '../server/human-check.mjs';
import {totpCode} from '../server/account-security.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'folio-api-'));
const child=spawn(process.execPath,['server/index.mjs'],{cwd:root,env:{...process.env,FOLIO_DATA_DIR:temporary,PORT:'0',FOLIO_DISABLE_AI:'1',FOLIO_AUTH_MODE:'local'},stdio:['ignore','pipe','pipe'],windowsHide:true});
let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
try{
  const origin=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{clearInterval(poll);reject(new Error('Server startup timed out: '+output));},20000);const poll=setInterval(()=>{const found=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(found){clearTimeout(timer);clearInterval(poll);resolve(found[0]);}},100);child.once('exit',code=>{clearTimeout(timer);clearInterval(poll);reject(new Error('Server exited '+code+': '+output));});});
  // Un client = un navigateur : ses cookies, son jeton CSRF, sa vérification anti-robot.
  function client(){
    const jar=new Map();const cookieHeader=()=>[...jar].filter(([,v])=>v).map(([k,v])=>k+'='+v).join('; ');
    async function api(route,method='GET',payload,expected=200,{csrf=true}={}){
      const mutation=!['GET','HEAD'].includes(method);
      const send=()=>fetch(origin+route,{method,headers:{...(payload?{'Content-Type':'application/json'}:{}),...(jar.size?{Cookie:cookieHeader()}:{}),...(mutation&&csrf&&jar.get('folio_csrf')?{'X-CSRF-Token':jar.get('folio_csrf')}:{})},body:payload?JSON.stringify(payload):undefined});
      // Course classique du keep-alive : connexion réutilisée au moment où le serveur la ferme. Un navigateur renvoie la requête.
      let response;try{response=await send();}catch(error){if(error.cause?.code!=='ECONNRESET')throw error;response=await send();}
      for(const line of response.headers.getSetCookie()){const [pair]=line.split(';');const index=pair.indexOf('=');jar.set(pair.slice(0,index),pair.slice(index+1));}
      const data=await response.json();assert.equal(response.status,expected,route+' '+JSON.stringify(data));return data;
    }
    // Résout la preuve de travail comme le navigateur, en respectant le délai minimal de remplissage.
    async function human(extra={}){const challenge=await api('/api/auth/challenge'),issued=Date.now();const nonce=solveChallenge(challenge.challenge,challenge.difficulty);const wait=900-(Date.now()-issued);if(wait>0)await new Promise(r=>setTimeout(r,wait));return {challenge:challenge.challenge,nonce,...extra};}
    return {api,human,jar,cookie:()=>jar.get('folio_session')?'folio_session='+jar.get('folio_session'):''};
  }
  const owner=client(),{api}=owner;
  assert.equal((await api('/api/health')).version,'sessions-v7');
  const auth=await api('/api/auth/status');assert.equal(auth.configured,true);assert.equal(auth.apiProtected,true);assert.equal(auth.setupRequired,true);assert.equal(auth.localPreviewAllowed,false);assert.equal(auth.humanCheck,'proof_of_work');
  assert.deepEqual(await api('/api/auth/session'),{authenticated:false,user:null});
  await api('/api/workspace','GET',undefined,401);await api('/api/backend/status','GET',undefined,401);
  const credentials={email:'fixture@example.test',password:'Temporary isolated fixture passphrase'};
  // Anti-robot : sans preuve, ou avec le champ piège rempli, la création est refusée avant tout calcul.
  assert.equal((await api('/api/auth/setup','POST',credentials,400)).code,'HUMAN_CHECK_FAILED');
  assert.equal((await api('/api/auth/setup','POST',{...credentials,human:await owner.human({trap:'https://spam.example'})},400)).code,'HUMAN_CHECK_FAILED');
  assert.equal((await api('/api/auth/setup','POST',{...credentials,password:'azertyuiop12',human:await owner.human()},400)).code,'WEAK_PASSWORD');
  const created=await api('/api/auth/setup','POST',{...credentials,human:await owner.human()},201);assert.match(created.recoveryCode,/^[A-Za-z0-9_-]{43}$/);assert.equal((await api('/api/auth/session')).authenticated,true);
  await api('/api/auth/setup','POST',{...credentials,human:await owner.human()},409);await api('/api/auth/recovery','POST',{email:credentials.email},409);
  const workspace=await api('/api/workspace');assert.ok(workspace.documents.length>0);
  // CSRF : sans jeton, aucune modification n'est acceptée ; champ inconnu refusé ; journal d'audit intact.
  await api('/api/threads','POST',{kind:'chat'},403,{csrf:false});
  await api('/api/threads','POST',{kind:'chat',role:'admin'},400);
  const chain=await api('/api/audit/verify');assert.equal(chain.valid,true);assert.ok(chain.entries>=1);
  const backend=await api('/api/backend/status');assert.equal(backend.connected,false);assert.equal(backend.configured,false);assert.equal(backend.automaticSources,true);assert.equal(backend.vector.used,false);
  const automatic=await api('/api/threads','POST',{kind:'chat'},201);
  const automaticPacket=await api(`/api/threads/${automatic.id}/rag-context`,'POST',{question:'Comparer les revenus annuels de Meta et Google en 2024'});
  assert.equal(automaticPacket.automaticScope,true);assert.ok(automaticPacket.passages.length>0);
  const saved=await api(`/api/threads/${automatic.id}/messages`,'POST',{content:'Quels revenus annuels Meta en 2024 ?'},201);
  await api(`/api/threads/${automatic.id}/run`,'POST',{messageId:saved.thread.messages[0].id},202);
  let run;for(let i=0;i<30;i++){run=await api(`/api/threads/${automatic.id}/run`);if(run.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(run.status,'failed');assert.equal(run.error.code,'AI_DISABLED');assert.equal((await api(`/api/threads/${automatic.id}`)).messages.length,1);
  await api(`/api/threads/${automatic.id}/run`,'POST',{messageId:'unknown'},404);
  await api('/api/threads/'+automatic.id,'DELETE');
  const doc=workspace.documents.find(doc=>doc.hasText&&doc.company==='meta'&&doc.year==='2024')||workspace.documents.find(doc=>doc.hasText);assert.ok(doc);
  const thread=await api('/api/threads','POST',{kind:'chat',documentIds:[doc.id]},201);
  const packet=await api(`/api/threads/${thread.id}/rag-context`,'POST',{question:'annual revenue'});
  assert.ok(packet.passages.length>0);assert.ok(packet.passages.every(p=>p.documentId===doc.id));assert.equal(packet.answerGenerated,false);assert.equal(packet.citationsEnabled,false);assert.ok(packet.metrics.contextCharacters<=12000);
  await api(`/api/threads/${thread.id}`,'PATCH',{documentIds:['unknown']},400);
  const theme=await api('/api/threads','POST',{kind:'thematic',theme:'Annual revenue',sourceThreadIds:[thread.id]},201);
  const plan=await api(`/api/threads/${theme.id}/plan`);assert.equal(plan.tasks.length,4);assert.deepEqual(plan.events,[]);assert.equal(plan.status,'prepared_not_executed');
  const page=await fetch(origin);assert.equal(page.status,200);assert.match(await page.text(),/\/assets\/index-/);
  const forbidden=await fetch(origin+'/api/workspace',{headers:{Origin:'https://example.com'}});assert.equal(forbidden.status,403);

  // Sous-compte : créé par le propriétaire, code d'invitation à remplacer, isolé, sans accès aux mesures, désactivable.
  const invited=await api('/api/accounts','POST',{email:'analyste@example.test',companies:['apple']},201);assert.match(invited.invitationCode,/^[A-Za-z0-9_-]{43}$/);assert.equal(invited.member.mustChangePassword,true);
  const member=client();
  await member.api('/api/auth/login','POST',{email:'analyste@example.test',password:invited.invitationCode,human:await member.human()});
  assert.equal((await member.api('/api/workspace','GET',undefined,403)).code,'PASSWORD_CHANGE_REQUIRED');
  await member.api('/api/account/password','POST',{currentPassword:invited.invitationCode,newPassword:'Analyse comparative des marges 2026'});
  const memberSpace=await member.api('/api/workspace');assert.deepEqual(memberSpace.companies,['apple']);assert.equal(memberSpace.threads.length,0);
  await member.api('/api/threads/'+thread.id,'GET',undefined,404);
  await member.api('/api/metrics','GET',undefined,403);await member.api('/api/accounts','GET',undefined,403);
  await member.api(`/api/documents/${doc.id}`,'GET',undefined,404);
  assert.equal((await member.api('/api/account')).role,'member');
  await api(`/api/accounts/${invited.member.id}`,'PATCH',{disabled:true});
  await member.api('/api/workspace','GET',undefined,401);
  await api(`/api/accounts/${invited.member.id}`,'DELETE');

  // Double authentification : activée avec un code valide, exigée ensuite à la connexion.
  const setupMfa=await api('/api/account/mfa/setup','POST',{});assert.match(setupMfa.otpauthUrl,/^otpauth:\/\/totp\//);
  const step=Math.floor(Date.now()/30000);
  await api('/api/account/mfa/enable','POST',{code:totpCode(setupMfa.secret,step),password:credentials.password});
  assert.equal((await api('/api/account')).mfaEnabled,true);
  const second=client();
  const pending=await second.api('/api/auth/login','POST',{...credentials,human:await second.human()});assert.equal(pending.mfaRequired,true);assert.equal(second.cookie(),'');
  await second.api('/api/auth/mfa','POST',{challenge:pending.challenge,code:'000000'},401);
  await second.api('/api/auth/mfa','POST',{challenge:pending.challenge,code:totpCode(setupMfa.secret,step+1)});
  assert.equal((await second.api('/api/auth/session')).authenticated,true);
  const sessions=(await api('/api/account/sessions')).sessions;assert.ok(sessions.length>=2);assert.equal(sessions.filter(s=>s.current).length,1);
  await api('/api/account/sessions/revoke-others','POST',{});await second.api('/api/workspace','GET',undefined,401);

  await api('/api/threads/'+thread.id,'DELETE');await api('/api/threads/'+theme.id,'DELETE');
  const previousCookie=owner.cookie();await api('/api/auth/logout','POST');await api('/api/workspace','GET',undefined,401);
  const forged=await fetch(origin+'/api/workspace',{headers:{Cookie:previousCookie}});assert.equal(forged.status,401);
  await api('/api/auth/login','POST',{...credentials,password:'Incorrect fixture password',human:await owner.human()},401);
  const relog=await api('/api/auth/login','POST',{...credentials,human:await owner.human()});assert.equal(relog.mfaRequired,true);
  await api('/api/auth/reset','POST',{email:credentials.email,recoveryCode:created.recoveryCode,newPassword:'A new isolated fixture passphrase',human:await owner.human()});await api('/api/workspace','GET',undefined,401);
  console.log(JSON.stringify({http:'ok',authentication:'setup_login_mfa_logout_reset_and_api_protection',humanCheck:'proof_of_work_trap_timing',subAccounts:'invite_change_password_isolation_disable',corpusDocuments:workspace.documents.length,selectedDocument:doc.name,passages:packet.passages.length,contextCharacters:packet.metrics.contextCharacters,agents:'planned_not_run',backendConnected:false}));
}catch(error){console.error('Sortie du serveur :\n'+output.slice(-3000));throw error;}finally{
  const exited=new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);});child.kill();await exited;
  assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(temporary,{recursive:true,force:true});
}
