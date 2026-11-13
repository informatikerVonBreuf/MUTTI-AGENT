// Full local protocol integration: actual Python/LangGraph, deterministic model substitute.
// No API key, corpus excerpt or request is sent to an external service.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {runPython} from '../server/python-bridge.mjs';
const projectRoot=fileURLToPath(new URL('../../',import.meta.url));
const config={projectRoot,python:process.env.FOLIO_TEST_PYTHON||'python',apiKey:'OFFLINE_TEST_ONLY',model:'offline',timeoutMs:15000};
const passage={id:'offline-p1',documentId:'offline-doc',text:'Annual revenue was $100 million in 2024.',year:'2024'};
for(const mode of ['chat','thematic']){
  const events=[];let retrievals=0,models=0;
  const result=await runPython(config,{mode,question:'Quels revenus annuels en 2024 ?',context:{recentMessages:[]}},{onEvent:event=>events.push(event),onRetrieve:async request=>{assert.equal(request.tool,'retrieve_passages');retrievals++;return {passages:[passage]};},onModel:async request=>{
    models++;const fields=request.schema?.properties||{};
    if(fields.axes)return {axes:['Revenus annuels']};
    if(fields.approvedIndices)return {approvedIndices:[0]};
    assert.ok(fields.claims);return {claims:[{claim:'Le revenu annuel publié est de 100 millions de dollars.',evidenceId:passage.id,quote:passage.text,sourceYear:passage.year}]};
  }});
  assert.equal(result.claims.length,1);assert.equal(result.claims[0].evidenceId,passage.id);assert.equal(retrievals,1);
  assert.equal(models,mode==='chat'?2:3);assert.equal(events.length,mode==='chat'?4:8);
  if(mode==='thematic')assert.equal(result.engine,'langgraph_bounded');
}
console.log('Pont Node/Python et graphe LangGraph vérifiés hors ligne : chat et résumé, événements et citations.');
