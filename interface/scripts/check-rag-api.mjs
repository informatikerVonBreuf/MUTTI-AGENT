import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'folio-api-'));
const child=spawn(process.execPath,['server/index.mjs'],{cwd:root,env:{...process.env,FOLIO_DATA_DIR:temporary,PORT:'0',FOLIO_DISABLE_AI:'1',FOLIO_AUTH_MODE:'local'},stdio:['ignore','pipe','pipe'],windowsHide:true});
let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
try{
  const origin=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{clearInterval(poll);reject(new Error('Server startup timed out: '+output));},20000);const poll=setInterval(()=>{const found=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(found){clearTimeout(timer);clearInterval(poll);resolve(found[0]);}},100);child.once('exit',code=>{clearTimeout(timer);clearInterval(poll);reject(new Error('Server exited '+code+': '+output));});});
  let cookie='';
  async function api(route,method='GET',payload,expected=200){const response=await fetch(origin+route,{method,headers:{...(payload?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:payload?JSON.stringify(payload):undefined});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];const data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));return data;}
  assert.equal((await api('/api/health')).version,'sessions-v5');
  const auth=await api('/api/auth/status');assert.equal(auth.configured,true);assert.equal(auth.apiProtected,true);assert.equal(auth.setupRequired,true);assert.equal(auth.localPreviewAllowed,false);
  assert.deepEqual(await api('/api/auth/session'),{authenticated:false,user:null});
  await api('/api/workspace','GET',undefined,401);await api('/api/backend/status','GET',undefined,401);
  const credentials={email:'fixture@example.test',password:'Temporary isolated fixture passphrase'};
  const created=await api('/api/auth/setup','POST',credentials,201);assert.match(created.recoveryCode,/^[A-Za-z0-9_-]{43}$/);assert.equal((await api('/api/auth/session')).authenticated,true);
  await api('/api/auth/setup','POST',credentials,409);await api('/api/auth/recovery','POST',{email:credentials.email},409);
  const workspace=await api('/api/workspace');assert.ok(workspace.documents.length>0);
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
  await api('/api/threads/'+thread.id,'DELETE');await api('/api/threads/'+theme.id,'DELETE');
  const previousCookie=cookie;await api('/api/auth/logout','POST');await api('/api/workspace','GET',undefined,401);
  const forged=await fetch(origin+'/api/workspace',{headers:{Cookie:previousCookie}});assert.equal(forged.status,401);
  await api('/api/auth/login','POST',{...credentials,password:'Incorrect fixture password'},401);await api('/api/auth/login','POST',credentials);assert.equal((await api('/api/auth/session')).authenticated,true);
  await api('/api/auth/reset','POST',{email:credentials.email,recoveryCode:created.recoveryCode,newPassword:'A new isolated fixture passphrase'});await api('/api/workspace','GET',undefined,401);
  console.log(JSON.stringify({http:'ok',authentication:'setup_login_logout_reset_and_api_protection',corpusDocuments:workspace.documents.length,selectedDocument:doc.name,passages:packet.passages.length,contextCharacters:packet.metrics.contextCharacters,agents:'planned_not_run',backendConnected:false}));
}finally{
  const exited=new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);});child.kill();await exited;
  assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(temporary,{recursive:true,force:true});
}
