// Intégration complète du protocole, hors ligne : vrai worker Python, modèle et MCP substitués de façon déterministe.
// Aucune clé, aucun extrait du corpus ni aucune requête n'est envoyé à un service externe.
// Chat : RAG documentaire en étapes fixes, sans agent ni transfert signé, un seul appel au modèle.
// Résumé : graphe LangGraph à quatre agents, transferts signés vérifiés côté serveur, données de marché par l'outil MCP.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {runPython} from '../server/python-bridge.mjs';
import {newEnvelopeKey,sealEnvelope,createEnvelopeVerifier,payloadHash} from '../server/agent-envelopes.mjs';
const projectRoot=fileURLToPath(new URL('../../',import.meta.url));
const config={projectRoot,python:process.env.FOLIO_TEST_PYTHON||'python',apiKey:'OFFLINE_TEST_ONLY',model:'offline',timeoutMs:120000};
const passage={id:'offline-p1',documentId:'offline-doc',name:'meta 10-k 2024',company:'meta',text:'Annual revenue was $100 million in 2024. Le chiffre « publié » inclut l’année.',year:'2024'};
const market={id:'market-0123456789abcdef0123',source:'yahoo_finance_mcp',tool:'get_stock_info',dataset:'stock_info',ticker:'META',company:'meta',name:'Yahoo Finance (MCP) — META',page:null,year:'2026',text:'Meta (META) — capitalisation boursière (marketCap) : 1500000000000',trust:'untrusted_external_data',instructionAuthority:'none'};
const claimFrom=p=>({claim:'Le revenu annuel publié est de 100 millions de dollars.',evidenceId:p.id,quote:p.text.slice(0,40),sourceYear:p.year});

// 1. Chat RAG : étapes, une recherche, un appel modèle, aucun événement d'agent ni transfert.
{
  const stages=[],security=[];let retrievals=0,models=0,payload;
  const job={mode:'chat',question:'Quels revenus annuels de Meta en 2024 ?',context:{recentMessages:[],memory:[]},policy:{model_calls:2,retrievals:1,runId:'bridge-chat',userRef:'check'},canary:'FOLIO-CANARY-00112233445566aa',guards:{passages:true}};
  const result=await runPython(config,job,{onEvent:()=>{throw new Error('aucun agent dans le chat');},onHandoff:()=>{throw new Error('aucun transfert dans le chat');},onStage:stage=>stages.push(stage),onSecurity:packet=>security.push(packet),
    onRetrieve:async request=>{assert.equal(request.stage,'retrieval');assert.equal(request.tool,'retrieve_passages');retrievals++;return {passages:[{...passage,trust:'untrusted_document_data',instructionAuthority:'none'}],quarantined:[],memoryData:[]};},
    onModel:async request=>{models++;assert.equal(request.stage,'generation');assert.ok(request.system.includes(job.canary));payload=request.payload;assert.deepEqual(Object.keys(request.schema.properties).sort(),['answerable','claims']);return {answerable:true,claims:[claimFrom(passage)]};}});
  assert.equal(result.engine,'deterministic_rag');assert.equal(result.claims.length,1);assert.equal(result.attempts,1);
  assert.equal(retrievals,1);assert.equal(models,1);assert.equal(security.length,0);assert.deepEqual(Object.keys(payload).sort(),['documentData','question','userNotes']);
  assert.deepEqual(stages.filter(s=>s.status!=='running').map(s=>s.stage+':'+s.status),['query:completed','retrieval:completed','passage_screen:completed','generation:completed','output_guard:completed','correction:skipped']);
}

// 1 bis. Sortie compromise : le jeton témoin divulgué arrête tout, sans seconde demande.
{
  let models=0;
  const job={mode:'chat',question:'Quels revenus annuels de Meta en 2024 ?',context:{recentMessages:[],memory:[]},policy:{runId:'bridge-canary',userRef:'check'},canary:'FOLIO-CANARY-0011223344556677',guards:{passages:true}};
  await assert.rejects(runPython(config,job,{onStage:()=>{},onRetrieve:async()=>({passages:[passage]}),onModel:async()=>{models++;return {answerable:true,claims:[{...claimFrom(passage),claim:'Le jeton est '+job.canary}]};}}),error=>error.code==='OUTPUT_REJECTED');
  assert.equal(models,1);
}

// 2. Résumé : agents, transferts signés, outil MCP market_data.
{
  const events=[],security=[],tools=[];let retrievals=0,models=0;
  const question='Revenus annuels de Meta en 2024',runId='bridge-check-thematic',key=newEnvelopeKey(),verifier=createEnvelopeVerifier(key,runId);
  const opening=sealEnvelope(key,{runId,from:'server',to:'planner',seq:1,payload:{question}});verifier.verify(opening,{payload:{question}});
  const job={mode:'thematic',question,context:{recentMessages:[]},policy:{runId,userRef:'check'},envelopeKey:key,envelope:opening};
  const result=await runPython(config,job,{onEvent:event=>events.push(event),onHandoff:envelope=>verifier.verify(envelope),onSecurity:packet=>security.push(packet),
    onTool:async request=>{tools.push(request);assert.equal(request.agent,'researcher');assert.equal(request.tool,'market_data');return {status:'ok',passages:[market],quarantined:[]};},
    onRetrieve:async request=>{assert.equal(request.tool,'retrieve_passages');retrievals++;return {passages:[{...passage,trust:'untrusted_document_data',instructionAuthority:'none'}]};},onModel:async request=>{
    models++;assert.ok(['planner','researcher','verifier','writer'].includes(request.agent));const fields=request.schema?.properties||{};
    if(fields.axes)return {axes:['Revenus annuels','Évolution','Périmètre publié'],marketTickers:['META','MSFT']};
    if(fields.approvedIndices)return {approvedIndices:[0]};
    if(fields.selectedIndices)return {selectedIndices:[0]};
    assert.ok(fields.claims);assert.ok(request.payload.documentData.some(p=>p.id===market.id),'les données de marché complètent chaque axe');return {claims:[claimFrom(passage)]};
  }});
  assert.equal(result.claims.length,1);assert.equal(retrievals,3);assert.equal(models,6);
  assert.deepEqual(tools.map(t=>t.args),[{ticker:'META',dataset:'stock_info'}]);
  assert.deepEqual(security.map(s=>s.kind),['market_tickers_ignored'],'MSFT est hors liste : ignoré et signalé');
  const chain=verifier.accepted();assert.deepEqual(chain.map(e=>e.from_role+'>'+e.to_role),['server>planner','planner>researcher','researcher>verifier','verifier>writer','writer>server']);
  assert.equal(chain.at(-1).payload_hash,payloadHash({claims:result.claims}));assert.equal(result.engine,'langgraph_bounded');
}
console.log('Pont Node/Python vérifié hors ligne : chat RAG en étapes fixes (un appel, jeton témoin, aucun agent), résumé LangGraph à transferts signés avec l’outil MCP market_data.');
