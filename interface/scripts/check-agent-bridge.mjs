// Full local protocol integration: actual Python/LangGraph, deterministic model substitute.
// No API key, corpus excerpt or request is sent to an external service.
// Vérifie aussi les transferts signés entre agents de bout en bout (JSON canonique identique en Node et en Python).
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {runPython} from '../server/python-bridge.mjs';
import {newEnvelopeKey,sealEnvelope,createEnvelopeVerifier,payloadHash} from '../server/agent-envelopes.mjs';
const projectRoot=fileURLToPath(new URL('../../',import.meta.url));
const config={projectRoot,python:process.env.FOLIO_TEST_PYTHON||'python',apiKey:'OFFLINE_TEST_ONLY',model:'offline',timeoutMs:120000};
const passage={id:'offline-p1',documentId:'offline-doc',text:'Annual revenue was $100 million in 2024. Le chiffre « publié » inclut l’année.',year:'2024'};
const expected={chat:['server>researcher','researcher>verifier','verifier>server'],thematic:['server>planner','planner>researcher','researcher>verifier','verifier>writer','writer>server']};
for(const mode of ['chat','thematic']){
  const events=[],security=[];let retrievals=0,models=0;
  const question='Quels revenus annuels en 2024 ?',runId='bridge-check-'+mode,key=newEnvelopeKey(),verifier=createEnvelopeVerifier(key,runId);
  const opening=sealEnvelope(key,{runId,from:'server',to:mode==='chat'?'researcher':'planner',seq:1,payload:{question}});verifier.verify(opening,{payload:{question}});
  const job={mode,question,context:{recentMessages:[]},policy:{runId,userRef:'check'},envelopeKey:key,envelope:opening};
  const result=await runPython(config,job,{onEvent:event=>events.push(event),onHandoff:envelope=>verifier.verify(envelope),onSecurity:packet=>security.push(packet),onRetrieve:async request=>{assert.equal(request.tool,'retrieve_passages');retrievals++;return {passages:[{...passage,trust:'untrusted_document_data',instructionAuthority:'none'}]};},onModel:async request=>{
    models++;assert.ok(['planner','researcher','verifier','writer'].includes(request.agent));const fields=request.schema?.properties||{};
    if(fields.axes)return {axes:['Revenus annuels','Évolution','Périmètre publié']};
    if(fields.approvedIndices)return {approvedIndices:[0]};
    if(fields.selectedIndices)return {selectedIndices:[0]};
    assert.ok(fields.claims);return {claims:[{claim:'Le revenu annuel publié est de 100 millions de dollars.',evidenceId:passage.id,quote:passage.text.slice(0,40),sourceYear:passage.year}]};
  }});
  assert.equal(result.claims.length,1);assert.equal(result.claims[0].evidenceId,passage.id);assert.equal(retrievals,mode==='chat'?1:3);
  assert.equal(models,mode==='chat'?2:6);assert.equal(events.length,mode==='chat'?4:8);assert.equal(security.length,0);
  const chain=verifier.accepted();assert.deepEqual(chain.map(e=>e.from_role+'>'+e.to_role),expected[mode]);
  assert.equal(chain.at(-1).payload_hash,payloadHash({claims:result.claims}));
  if(mode==='thematic')assert.equal(result.engine,'langgraph_bounded');
}
console.log('Pont Node/Python et graphe LangGraph vérifiés hors ligne : chat et résumé, middleware LangChain, transferts signés vérifiés côté serveur, événements et citations.');
