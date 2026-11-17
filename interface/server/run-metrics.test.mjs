import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {priceFor,costOf,usageFromGemini,createUsageLedger,percentile,summarize,routeKey,createLatencyRecorder,createMetricsLog,aggregateRuns,FOOTPRINT} from './run-metrics.mjs';
import {workerEnvironment} from './python-bridge.mjs';
import {loadBackendConfig} from './backend-config.mjs';
import {callGemini} from './gemini-provider.mjs';
import {callSimulated} from './simulated-provider.mjs';

test('Tarif daté : 0,75 $ / 3,75 $ en 2026, doublé au 1er janvier 2027',()=>{
  const now=priceFor('gemini-3.8-flash','2026-11-17T10:00:00Z'),later=priceFor('gemini-3.8-flash','2027-01-02T00:00:00Z');
  assert.equal(now.inputPerMTok,0.75);assert.equal(now.outputPerMTok,3.75);assert.equal(later.inputPerMTok,1.5);assert.equal(later.outputPerMTok,7.5);
  assert.equal(priceFor('modele-inconnu').known,false);
  assert.equal(priceFor('modele-inconnu',new Date(),{input:1,output:2}).source,'configuration');
});
test('Coût : raisonnement facturé en sortie, entrée en cache au tarif réduit',()=>{
  const price=priceFor('gemini-3.8-flash','2026-11-17T10:00:00Z');
  const usage=usageFromGemini({usageMetadata:{promptTokenCount:10000,candidatesTokenCount:1000,thoughtsTokenCount:500,cachedContentTokenCount:2000,totalTokenCount:11500}});
  assert.deepEqual(usage,{inputTokens:10000,outputTokens:1000,thoughtTokens:500,cachedTokens:2000,totalTokens:11500});
  // 8 000 × 0,75 + 2 000 × 0,075 + 1 500 × 3,75, par million
  assert.equal(Math.round(costOf(usage,price)*1e9),Math.round((8000*0.75+2000*0.075+1500*3.75)/1e6*1e9));
  assert.equal(costOf(usage,{known:false}),null);
});
test('Registre : coût et empreinte par agent ; simulé = zéro, sans faux impact',()=>{
  const ledger=createUsageLedger({model:'gemini-3.8-flash',at:'2026-11-17T10:00:00Z'});
  ledger.record('researcher',{inputTokens:1000,outputTokens:100},800);ledger.record('verifier',{inputTokens:500,outputTokens:20},400);ledger.record('researcher',{inputTokens:1000,outputTokens:100},700);
  const snap=ledger.snapshot();
  assert.equal(snap.byAgent.researcher.calls,2);assert.equal(snap.total.calls,3);
  assert.equal(snap.total.energyWh,Math.round(3*FOOTPRINT.energyWh*1e4)/1e4);assert.equal(snap.footprint.assurance,'estimation');
  assert.ok(snap.total.costUsd>0);assert.throws(()=>ledger.record('intrus',{}),/Rôle inconnu/);
  const simulated=createUsageLedger({model:'simulated',simulated:true});simulated.record('researcher',{inputTokens:1000,outputTokens:100});
  const s=simulated.snapshot();assert.equal(s.total.costUsd,0);assert.equal(s.total.energyWh,0);assert.equal(s.footprint.assurance,'simulated_no_model_call');
  const unknown=createUsageLedger({model:'modele-inconnu'});unknown.record('writer',{inputTokens:1});assert.equal(unknown.snapshot().total.costUsd,null);
});
test('Percentiles au rang le plus proche',()=>{
  const values=Array.from({length:100},(_,i)=>i+1);
  assert.equal(percentile(values,50),50);assert.equal(percentile(values,95),95);assert.equal(percentile(values,99),99);assert.equal(percentile([],95),null);
  assert.deepEqual(summarize([3,1,2]),{count:3,p50:2,p95:3,p99:3,max:3,mean:2});
});
test('Latences HTTP regroupées par route, sans identifiant',()=>{
  assert.equal(routeKey('GET','/api/threads/0b0e8a8e-1111-4c4c-9a9a-123456789abc/run'),'GET /api/threads/:id/run');
  assert.equal(routeKey('GET','/api/documents/abcdef0123456789ab/pdf'),'GET /api/documents/:doc/pdf');
  const recorder=createLatencyRecorder({size:3});for(const ms of [10,20,30,40])recorder.record('GET /api/workspace',ms,200);recorder.record('GET /api/workspace',50,503);
  const [row]=recorder.summary();assert.equal(row.count,3);assert.equal(row.errors,1);assert.equal(row.max,50);
});
test('Journal des exécutions : aucun contenu, relu après redémarrage, agrégé',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'folio-metrics-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const log=await createMetricsLog({storageDirectory:directory});
  const ledger=createUsageLedger({model:'gemini-3.8-flash',at:'2026-11-17T10:00:00Z'});ledger.record('researcher',{inputTokens:2000,outputTokens:200},900);
  const run={id:'r1',kind:'chat',status:'completed',startedAt:'2026-11-17T10:00:00.000Z',finishedAt:'2026-11-17T10:00:08.000Z',tasks:[{agent:'researcher',status:'completed',durationMs:5000},{agent:'planner',status:'not_used'}],usage:ledger.snapshot(),retrievals:[{query:'QUESTION_SECRETE',passages:[{excerpt:'EXTRAIT_PRIVE'}]}]};
  await log.append(run);await log.append({...run,id:'r2',status:'failed',error:{code:'MODEL_QUOTA'}});await log.close();
  const raw=await fs.readFile(path.join(directory,'metrics','runs.jsonl'),'utf8');assert.doesNotMatch(raw,/QUESTION_SECRETE|EXTRAIT_PRIVE/);
  const reopened=await createMetricsLog({storageDirectory:directory});const report=aggregateRuns(reopened.records());
  assert.equal(report.runs,2);assert.equal(report.byKind.chat.completed,1);assert.equal(report.byKind.chat.failed,1);assert.equal(report.byKind.chat.duration.p95,8000);
  assert.equal(report.agents.researcher.calls,2);assert.ok(report.totals.costUsd>0);assert.equal(report.agents.planner.calls,0);
});
test('Le worker reçoit un environnement minimal : ni clé IA en mode pont, ni clé LangSmith sans traçage',()=>{
  const source={PATH:'/bin',SECRET_UNRELATED:'x',LANGSMITH_API_KEY:'FAKE_LS',GOOGLE_API_KEY:'FAKE_G'};
  const off=workerEnvironment({apiKey:'FAKE_G',model:'m',tracing:{enabled:false,apiKey:'FAKE_LS'}},{bridgeModel:true,source});
  assert.equal(off.PATH,'/bin');assert.equal(off.SECRET_UNRELATED,undefined);assert.equal(off.GOOGLE_API_KEY,undefined);assert.equal(off.LANGSMITH_API_KEY,undefined);assert.equal(off.LANGSMITH_TRACING,'false');
  const on=workerEnvironment({apiKey:'FAKE_G',model:'m',tracing:{enabled:true,apiKey:'FAKE_LS',project:'folio-dev'}},{bridgeModel:true,source});
  assert.equal(off.LANGCHAIN_TRACING_V2,'false');assert.equal(on.LANGCHAIN_TRACING_V2,'true');
  assert.equal(on.LANGSMITH_TRACING,'true');assert.equal(on.LANGSMITH_HIDE_INPUTS,'true');assert.equal(on.LANGSMITH_HIDE_OUTPUTS,'true');assert.equal(on.LANGSMITH_PROJECT,'folio-dev');assert.equal(on.GOOGLE_API_KEY,undefined);
  assert.equal(workerEnvironment({apiKey:'FAKE_G',model:'m'},{bridgeModel:false,source}).GOOGLE_API_KEY,'FAKE_G');
});
test('Configuration : traçage explicite, adresse HTTPS, fournisseur simulé déclaré',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'folio-obs-config-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const options={projectRoot:root,storageDirectory:root};
  const base=await loadBackendConfig({...options,env:{GOOGLE_API_KEY:'FAKE',LANGSMITH_API_KEY:'FAKE_LS'}});assert.equal(base.tracing.enabled,false);assert.equal(base.simulated,false);
  const traced=await loadBackendConfig({...options,env:{GOOGLE_API_KEY:'FAKE',LANGSMITH_API_KEY:'FAKE_LS',FOLIO_TRACING:'on'}});assert.equal(traced.tracing.enabled,true);assert.equal(traced.tracing.project,'folio-dev');assert.equal(traced.tracing.hideContent,true);
  assert.equal((await loadBackendConfig({...options,env:{FOLIO_TRACING:'on'}})).tracing.enabled,false);
  await assert.rejects(loadBackendConfig({...options,env:{LANGSMITH_ENDPOINT:'http://evil.example'}}),/HTTPS requis/);
  const simulated=await loadBackendConfig({...options,env:{GOOGLE_API_KEY:'FAKE',FOLIO_PROVIDER:'simulated',FOLIO_SIMULATED_DELAY_MS:'0'}});
  assert.equal(simulated.simulated,true);assert.equal(simulated.apiKey,'');assert.equal(simulated.model,'simulated');assert.equal(simulated.simulatedDelayMs,0);
  await assert.rejects(loadBackendConfig({...options,env:{FOLIO_PROVIDER:'autre'}}),/Fournisseur IA inconnu/);
});
test('Gemini : l’usage est relevé même si la sortie est ensuite refusée',async()=>{
  let seen=null;
  const fetcher=async()=>({ok:true,text:async()=>JSON.stringify({candidates:[{content:{parts:[{text:'pas du json'}]}}],usageMetadata:{promptTokenCount:120,candidatesTokenCount:30,thoughtsTokenCount:10}})});
  await assert.rejects(callGemini({apiKey:'FAKE',model:'gemini-3.8-flash'},{operation:'generate',system:'s',payload:{},schema:{type:'OBJECT'}},{fetcher,onUsage:usage=>{seen=usage;}}),error=>error.code==='INVALID_OUTPUT');
  assert.equal(seen.inputTokens,120);assert.equal(seen.thoughtTokens,10);
});
test('Simulé : extraits littéraux étiquetés, aucune donnée inventée',async()=>{
  const passage={id:'p1',text:'Revenue was $100 million in 2024. Other text.',year:'2024'};
  const result=await callSimulated({simulatedDelayMs:0},{operation:'generate',schema:{properties:{claims:{}}},payload:{documentData:[passage]}});
  assert.match(result.claims[0].claim,/^\[Simulé\]/);assert.ok(passage.text.includes(result.claims[0].quote));assert.equal(result.claims[0].sourceYear,'2024');
  assert.deepEqual(await callSimulated({},{operation:'probe'}),{connected:true,model:'simulated'});
});
