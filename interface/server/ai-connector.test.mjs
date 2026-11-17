import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createAppStore} from './app-store.mjs';
import {createAIConnector} from './ai-connector.mjs';
import {BackendError} from './python-bridge.mjs';
import {sealEnvelope} from './agent-envelopes.mjs';

async function fixture(t,runner,{apiKey='fake-test-key',modelRequest,metrics,model='test'}={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'folio-ai-'));
  const projectRoot=path.join(directory,'project'),storageDirectory=path.join(directory,'state');
  for(const company of ['meta','google']){
    const folder=path.join(projectRoot,'data/rag-data/markdown',company);await fs.mkdir(folder,{recursive:true});
    await fs.writeFile(path.join(folder,company+' 10-k 2024.md'),`# Annual results\n\n${company} total revenue was $100 million in 2024. Reported annual revenue includes the financial results for the year.`);
  }
  let connector;const store=await createAppStore({projectRoot,storageDirectory,backendState:()=>connector?.status()||{connected:false}});
  const config={apiKey,projectRoot,storageDirectory,model,qdrantUrl:'invalid-url',timeoutMs:2000};
  connector=await createAIConnector({store,config,runner,...(modelRequest?{modelRequest}:{}),...(metrics?{metrics}:{})});
  t.after(async()=>{await connector.close();await store.close();assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(directory,{recursive:true,force:true});});
  return {store,connector,config};
}
async function question(store,kind='chat'){
  const thread=await store.createThread({kind,theme:kind==='thematic'?'Résultats annuels':''});
  const saved=await store.addMessage(thread.id,'Comparer les revenus annuels de Meta et Google en 2024.');
  return {id:thread.id,messageId:saved.thread.messages[0].id};
}
async function ended(connector,id){
  const until=Date.now()+60000;
  while(connector.latest(id)?.status==='running'&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,5));
  assert.notEqual(connector.latest(id)?.status,'running');return connector.latest(id);
}
// Simule les transferts signés du worker : chercheur → vérificateur → serveur, avec le résultat final.
function signedHandoffs(job,onHandoff,claims){const key=job.envelopeKey,runId=job.policy.runId;onHandoff(sealEnvelope(key,{runId,from:'researcher',to:'verifier',seq:2,payload:{claims,passages:[]}}));onHandoff(sealEnvelope(key,{runId,from:'verifier',to:'server',seq:3,payload:{claims}}));}
async function grounded(job,{onRetrieve,onEvent,onHandoff},transform=claims=>claims){
  onEvent({agent:'researcher',status:'running',tool:'retrieve_passages'});
  const packet=await onRetrieve({id:'r1',agent:'researcher',tool:'retrieve_passages',query:job.question});
  onEvent({agent:'researcher',status:'completed',tool:'retrieve_passages'});
  const claims=transform(packet.passages.map(p=>({claim:'Un résultat publié figure dans ce rapport.',evidenceId:p.id,quote:p.text.slice(0,90),sourceYear:p.year,axis:'Résultats'})));
  signedHandoffs(job,onHandoff,claims);return {claims};
}

test('RAG automatique : réponse citée persistée et reprise sans nouvel appel',async t=>{
  let calls=0;const {store,connector,config}=await fixture(t,async(jobConfig,job,options)=>{calls++;return grounded(job,options);});
  const q=await question(store);await connector.start(q.id,q);const run=await ended(connector,q.id);
  assert.equal(run.status,'completed');assert.ok(run.evidenceCount>=2);assert.equal(run.events.length,2);
  const reply=store.getThread(q.id).messages.at(-1);assert.equal(reply.role,'assistant');assert.equal(reply.citationsVerified,true);
  assert.ok(reply.citations.every(c=>c.verification==='exact_quote_and_source_match'&&c.truthVerified===false));
  assert.equal(new Set(reply.citations.map(c=>c.documentId)).size,2);
  await connector.start(q.id,q);assert.equal(calls,1);
  await store.close();const reopened=await createAppStore(config);try{assert.equal(reopened.getThread(q.id).messages.at(-1).runId,run.id);}finally{await reopened.close();}
});
test('Une citation inventée ne devient jamais une réponse assistant',async t=>{
  const {store,connector}=await fixture(t,async(c,job,options)=>grounded(job,options,claims=>claims.map(claim=>({...claim,quote:'QUOTE_INVENTED_NOT_IN_THE_REPORT'}))));
  const q=await question(store);await connector.start(q.id,q);const run=await ended(connector,q.id);
  assert.equal(run.status,'failed');assert.equal(run.error.code,'NO_EVIDENCE');assert.equal(store.getThread(q.id).messages.length,1);
});
test('Une référence inconnue et une mauvaise année source sont rejetées',async t=>{
  const {store,connector}=await fixture(t,async(c,job,options)=>grounded(job,options,claims=>[{...claims[0],evidenceId:'invented'},{...claims[0],sourceYear:'2023'}]));
  const q=await question(store);await connector.start(q.id,q);assert.equal((await ended(connector,q.id)).error.code,'NO_EVIDENCE');assert.equal(store.getThread(q.id).messages.length,1);
});
test('Sans clé : historique préservé, aucune exécution ni réponse simulée',async t=>{
  const {store,connector}=await fixture(t,()=>{throw new Error('must not run');},{apiKey:''});const q=await question(store);
  await connector.start(q.id,q);assert.equal((await ended(connector,q.id)).error.code,'MISSING_KEY');assert.equal(store.getThread(q.id).messages.length,1);assert.equal(connector.status().connected,false);
});
test('Une seule exécution simultanée ; arrêt propagé au worker',async t=>{
  let entered;const ready=new Promise(resolve=>entered=resolve);
  const {store,connector}=await fixture(t,async(c,job,{signal})=>new Promise((resolve,reject)=>{entered();signal.addEventListener('abort',()=>reject(new BackendError('CANCELLED')),{once:true});}));
  const a=await question(store),b=await question(store);await connector.start(a.id,a);await ready;
  await assert.rejects(connector.start(b.id,b),error=>error.status===409);
  await connector.cancel(a.id);assert.equal(connector.latest(a.id).status,'cancelled');assert.equal(store.getThread(a.id).messages.length,1);
});
test('Un outil non autorisé échoue avant toute lecture de document',async t=>{
  const {store,connector}=await fixture(t,async(c,job,{onRetrieve})=>{await onRetrieve({id:'r1',agent:'writer',tool:'retrieve_passages',query:job.question});return {claims:[]};});
  const q=await question(store,'thematic');await connector.start(q.id,q);const run=await ended(connector,q.id);assert.equal(run.error.code,'INVALID_OUTPUT');assert.equal(run.evidenceCount,0);
});
test('Après redémarrage, une analyse en cours devient interrompue sans appel payant',async t=>{
  const {store,connector,config}=await fixture(t,()=>{throw new Error('must not run');});const q=await question(store);
  await store.setRun(q.id,{id:'interrupted-run',status:'running',tasks:[{agent:'researcher',status:'running'}]});
  const restarted=await createAIConnector({store,config,runner:()=>{throw new Error('must not run');}});
  try{assert.equal(restarted.latest(q.id).status,'interrupted');assert.equal(restarted.latest(q.id).tasks[0].status,'interrupted');}finally{await restarted.close();}
});
test('Le statut ne divulgue jamais la clé du fournisseur',async t=>{
  const {connector}=await fixture(t,async()=>({connected:true}));assert.equal(connector.status().connected,false);await connector.probe();assert.equal(connector.status().connected,true);assert.doesNotMatch(JSON.stringify(connector.status()),/fake-test-key/);assert.equal(connector.status().vector.used,false);
});
test('Un modèle visible mais refusé à la génération ne reste pas affiché disponible',async t=>{
  const {store,connector}=await fixture(t,async(config,job)=>{if(job.mode==='probe')return {connected:true};throw new BackendError('MODEL_NOT_FOUND');});
  await connector.probe();assert.equal(connector.status().connected,true);const q=await question(store);await connector.start(q.id,q);
  assert.equal((await ended(connector,q.id)).error.code,'MODEL_NOT_FOUND');assert.equal(connector.status().connected,false);assert.equal(connector.status().error.code,'MODEL_NOT_FOUND');assert.equal(store.getThread(q.id).messages.length,1);
});

test('Coût, empreinte et passages consultés : attribués au rôle réel, journal sans contenu',async t=>{
  const appended=[];const metrics={append:async run=>{appended.push(JSON.parse(JSON.stringify(run)));}};
  const modelRequest=async(config,request,{onUsage})=>{onUsage({inputTokens:1000,outputTokens:200,thoughtTokens:50,cachedTokens:0},120);return request.agent==='verifier'?{approvedIndices:[0]}:{};};
  const runner=async(c,job,{onRetrieve,onEvent,onModel,onHandoff})=>{
    const reported=[];const result=await grounded(job,{onRetrieve,onEvent,onHandoff});
    await onModel({operation:'generate',agent:'researcher',system:'s',schema:{}},{reportUsage:u=>reported.push(u)});
    await onModel({operation:'generate',agent:'verifier',system:'s',schema:{}},{reportUsage:u=>reported.push(u)});
    assert.equal(reported.length,2);assert.ok(reported[0].costUsd>0);assert.equal(job.trace.kind,'chat');assert.match(job.trace.userRef,/^[a-f0-9]{16}$/);assert.doesNotMatch(JSON.stringify(job.trace),/owner@example/);
    return result;
  };
  const {store,connector}=await fixture(t,runner,{modelRequest,metrics,model:'gemini-3.8-flash'});
  const q=await question(store);await connector.start(q.id,q,{actor:{id:'owner',email:'owner@example.test'}});const run=await ended(connector,q.id);
  assert.equal(run.status,'completed');assert.equal(run.usage.byAgent.researcher.calls,1);assert.equal(run.usage.byAgent.verifier.calls,1);
  assert.ok(run.usage.total.costUsd>0);assert.equal(run.usage.total.energyWh,0.48);assert.equal(run.usage.pricing.inputPerMTok,0.75);
  assert.equal(run.retrievals.length,1);assert.ok(run.retrievals[0].passages.length>=1);assert.ok(run.retrievals[0].passages.every(p=>p.excerpt.length<=280&&p.documentId));
  for(let i=0;i<200&&!appended.length;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(appended.length,1);assert.equal(appended[0].id,run.id);
});
test('Un rôle sans droit d’appel au modèle est refusé (planificateur dans un chat)',async t=>{
  const runner=async(c,job,{onModel})=>{await onModel({operation:'generate',agent:'planner',system:'s',schema:{}});return {claims:[]};};
  const {store,connector}=await fixture(t,runner,{modelRequest:async()=>{throw new Error('must not call');}});
  const q=await question(store);await connector.start(q.id,q);const run=await ended(connector,q.id);assert.equal(run.error.code,'INVALID_OUTPUT');assert.equal(run.usage.total.calls,0);
});
