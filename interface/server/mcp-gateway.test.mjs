import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createMcpGateway,renderMarket,findMcpCommand} from './mcp-gateway.mjs';

const FIXTURE=fileURLToPath(new URL('./fixtures/fake-mcp-server.mjs',import.meta.url));
async function gateway(t,mode,options={}){
  const storageDirectory=await fs.mkdtemp(path.join(os.tmpdir(),'folio-mcp-'));
  const mcp=createMcpGateway({command:process.execPath,args:[FIXTURE,mode],storageDirectory,startTimeoutMs:5000,callTimeoutMs:3000,...options});
  t.after(async()=>{await mcp.close();await fs.rm(storageDirectory,{recursive:true,force:true});});
  return {mcp,storageDirectory};
}

test('MCP : démarrage, outils listés, données réduites aux champs autorisés et rendues en texte',async t=>{
  const {mcp,storageDirectory}=await gateway(t,'normal');
  assert.equal(mcp.status().state,'stopped');
  const ready=await mcp.start();assert.equal(ready.state,'ready');assert.ok(ready.tools.includes('get_stock_info'));
  const reply=await mcp.call({ticker:'AMZN',dataset:'stock_info'});
  assert.equal(reply.status,'ok');assert.equal(reply.cached,false);
  const [passage]=reply.passages;assert.match(passage.id,/^market-[a-f0-9]{20}$/);assert.equal(passage.source,'yahoo_finance_mcp');assert.equal(passage.trust,'untrusted_external_data');
  assert.match(passage.text,/Amazon \(AMZN\) — capitalisation boursière \(marketCap\) : 2413000000000/);
  assert.doesNotMatch(passage.text,/Terry Avenue|206 266 1000|retail sale/,'adresse, téléphone et texte libre ne sont jamais transmis');
  const statement=await mcp.call({ticker:'AMZN',dataset:'income_stmt'});
  assert.match(statement.passages[0].text,/résultat opérationnel \(Operating Income\), exercice clos le 2024-12-31 : 68593000000/);assert.doesNotMatch(statement.passages[0].text,/2022-12-31/);
  assert.equal((await mcp.call({ticker:'AMZN',dataset:'stock_info'})).cached,true);
  const ca=await fs.readFile(path.join(storageDirectory,'mcp-ca.pem'),'utf8').catch(()=>'');assert.ok(ca===''||ca.includes('BEGIN CERTIFICATE'));
});

test('MCP : ticker, outil ou argument hors liste blanche refusés sans appel',async t=>{
  const {mcp}=await gateway(t,'normal');await mcp.start();
  for(const request of [{ticker:'MSFT',dataset:'stock_info'},{ticker:'amzn',dataset:'stock_info'},{ticker:'AMZN',dataset:'get_option_chain'},{ticker:'AMZN; rm -rf /',dataset:'stock_info'},{}])
    assert.equal((await mcp.call(request)).status,'denied',JSON.stringify(request));
});

test('MCP : réponse piégée mise en quarantaine, champs libres jamais retenus',async t=>{
  const {mcp}=await gateway(t,'injected');await mcp.start();
  const reply=await mcp.call({ticker:'META',dataset:'stock_info'});
  assert.equal(reply.status,'quarantined');assert.deepEqual(reply.passages,[]);assert.ok(reply.quarantined[0].signals.includes('instruction_override'));
});

test('MCP : réponse trop grande, erreur d’outil, outils manquants, plantage et démarrage lent',async t=>{
  const huge=await gateway(t,'huge');await huge.mcp.start();assert.equal((await huge.mcp.call({ticker:'AAPL',dataset:'stock_info'})).reason,'too_large');
  const failing=await gateway(t,'error');await failing.mcp.start();assert.equal((await failing.mcp.call({ticker:'AAPL',dataset:'stock_info'})).status,'error');
  const partial=await gateway(t,'notools');assert.equal((await partial.mcp.start()).state,'failed');
  const crash=await gateway(t,'crash');assert.equal((await crash.mcp.start()).state,'failed');assert.equal((await crash.mcp.call({ticker:'AAPL',dataset:'stock_info'})).status,'unavailable');
  const slow=await gateway(t,'slow');const starting=slow.mcp.start();
  assert.equal((await slow.mcp.call({ticker:'AAPL',dataset:'stock_info'})).status,'unavailable','un appel pendant le démarrage ne bloque pas l’analyse');
  assert.equal((await starting).state,'ready');assert.equal((await slow.mcp.call({ticker:'AAPL',dataset:'stock_info'})).status,'ok');
});

test('MCP : désactivé sans commande, et rendu robuste aux formats inattendus',async()=>{
  const off=createMcpGateway({command:null});assert.equal(off.status().state,'disabled');assert.equal((await off.call({ticker:'AMZN',dataset:'stock_info'})).status,'unavailable');
  assert.equal(createMcpGateway({command:'x',enabled:false}).status().state,'disabled');
  assert.equal(renderMarket('stock_info','AMZN','pas du JSON'),null);assert.equal(renderMarket('stock_info','AMZN','[]'),null);
  assert.equal(findMcpCommand({FOLIO_MCP_COMMAND:'/opt/mcp/bin/yahoo-finance-mcp-server'}),'/opt/mcp/bin/yahoo-finance-mcp-server');
});
