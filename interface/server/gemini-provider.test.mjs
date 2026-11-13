import test from 'node:test';
import assert from 'node:assert/strict';
import {callGemini} from './gemini-provider.mjs';
const config={apiKey:'FAKE_SECRET_FOR_TEST',model:'gemini-2.5-flash'};
const request={operation:'generate',system:'Use evidence only.',payload:{question:'Revenue?'},schema:{type:'OBJECT',properties:{claims:{type:'ARRAY',items:{type:'STRING'}}}}};
test('Transport Gemini : destination fixe, secret en en-tête, JSON structuré, pensées exclues',async()=>{
  const result=await callGemini(config,request,{fetcher:async(url,options)=>{
    assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');assert.ok(!url.includes(config.apiKey));assert.equal(options.headers['x-goog-api-key'],config.apiKey);
    assert.equal(JSON.parse(options.body).generationConfig.responseMimeType,'application/json');
    return new Response(JSON.stringify({candidates:[{content:{parts:[{thought:true,text:'HIDDEN_PRIVATE_REASONING'},{text:'{"claims":[]}'}]}}]}));
  }});assert.deepEqual(result,{claims:[]});
});
test('Les erreurs HTTP et réseau restent génériques et ne divulguent pas le contenu fournisseur',async()=>{
  for(const [status,code] of [[403,'MODEL_AUTH'],[429,'MODEL_QUOTA'],[503,'MODEL_UNAVAILABLE']])await assert.rejects(callGemini(config,request,{fetcher:async()=>new Response(config.apiKey,{status})}),error=>error.code===code&&!error.message.includes(config.apiKey));
  await assert.rejects(callGemini(config,request,{fetcher:async()=>{throw new Error(config.apiKey);}}),error=>error.code==='MODEL_UNAVAILABLE'&&!error.message.includes(config.apiKey));
});
test('JSON invalide et absence de clé sont refusés',async()=>{
  await assert.rejects(callGemini(config,request,{fetcher:async()=>new Response('invalid-json')}),error=>error.code==='INVALID_OUTPUT');
  await assert.rejects(callGemini({...config,apiKey:''},request),error=>error.code==='MISSING_KEY');
});
test('L’annulation est propagée au transport',async()=>{
  const controller=new AbortController();controller.abort();await assert.rejects(callGemini(config,request,{signal:controller.signal,fetcher:async(url,options)=>{options.signal.throwIfAborted();}}),error=>error.code==='CANCELLED');
});
