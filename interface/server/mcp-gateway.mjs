// Passerelle MCP des résumés thématiques : le serveur Node (et non l'agent) parle au serveur MCP Yahoo Finance
// (yahoo-finance-mcp-server==0.1.3) en JSON-RPC 2.0 sur stdio, sans dépendance. L'agent chercheur ne reçoit
// que des lignes de texte réduites aux champs autorisés, filtrées comme des données non fiables.
// Règles : tickers des entreprises du corpus seulement, deux outils en lecture seule, délai par appel, réponse
// bornée, cache de 15 minutes, aucun secret transmis au processus MCP. Un appel pendant le démarrage du serveur
// MCP (45 à 130 s mesurés sous Windows) renvoie « indisponible » sans bloquer l'analyse.
import {spawn} from 'node:child_process';
import tls from 'node:tls';
import {createHash} from 'node:crypto';
import {promises as fs,existsSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {screenUntrustedText} from './injection-screen.mjs';
import {MARKET_TICKERS,MARKET_DATASETS} from './agent-policies.mjs';

export const MCP_TOOLS={stock_info:{tool:'get_stock_info',args:ticker=>({ticker})},income_stmt:{tool:'get_financial_statement',args:ticker=>({ticker,financial_type:'income_stmt'})}};
const COMPANY={AMZN:'Amazon',AAPL:'Apple',GOOGL:'Google',META:'Meta'};
const STOCK_FIELDS=[['shortName','nom'],['currency','devise'],['marketCap','capitalisation boursière'],['currentPrice','cours'],['previousClose','clôture précédente'],['fiftyTwoWeekHigh','plus haut sur 52 semaines'],['fiftyTwoWeekLow','plus bas sur 52 semaines'],['trailingPE','PER sur douze mois glissants'],['forwardPE','PER prévisionnel'],['totalRevenue','chiffre d’affaires total'],['revenueGrowth','croissance du chiffre d’affaires'],['grossMargins','marge brute'],['operatingMargins','marge opérationnelle'],['profitMargins','marge nette'],['fullTimeEmployees','effectif à temps plein'],['recommendationKey','recommandation des analystes'],['numberOfAnalystOpinions','nombre d’analystes']];
const STATEMENT_FIELDS=[['Total Revenue','chiffre d’affaires total'],['Gross Profit','marge brute'],['Operating Income','résultat opérationnel'],['Net Income','résultat net'],['Diluted EPS','BPA dilué']];
const BINARY=process.platform==='win32'?'yahoo-finance-mcp-server.exe':'yahoo-finance-mcp-server';

export function findMcpCommand(env=process.env){
  if(env.FOLIO_MCP_COMMAND)return env.FOLIO_MCP_COMMAND;
  const dirs=[...(env.PATH||env.Path||'').split(path.delimiter),path.join(os.homedir(),'.local','bin')].filter(Boolean);
  for(const dir of dirs){const candidate=path.join(dir,BINARY);if(existsSync(candidate))return candidate;}
  return null;
}

// Valeur recopiée telle que reçue (aucun arrondi) ; texte court limité aux lettres, chiffres et ponctuation simple.
const value=raw=>typeof raw==='number'&&Number.isFinite(raw)?String(raw):typeof raw==='string'&&raw.trim()&&raw.length<=80?raw.replace(/[^\p{L}\p{N} .,'&()-]/gu,'').trim():null;
export function renderMarket(dataset,ticker,raw){
  let data;try{data=JSON.parse(raw);}catch{return null;}
  const lines=[],who=`${COMPANY[ticker]} (${ticker})`;
  if(dataset==='stock_info'&&data&&typeof data==='object'&&!Array.isArray(data)){
    for(const [key,label] of STOCK_FIELDS){const shown=value(data[key]);if(shown!==null)lines.push(`${who} — ${label} (${key}) : ${shown}`);}
  }else if(dataset==='income_stmt'&&Array.isArray(data)){
    const periods=data.filter(row=>row&&typeof row==='object'&&/^\d{4}-\d{2}-\d{2}/.test(String(row.date||''))).sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,2);
    for(const row of periods)for(const [key,label] of STATEMENT_FIELDS){const shown=value(row[key]);if(shown!==null)lines.push(`${who} — ${label} (${key}), exercice clos le ${String(row.date).slice(0,10)} : ${shown}`);}
  }
  return lines.length?lines.join('\n'):null;
}

async function writeCaBundle(file){
  // Les certificats du système (dont ceux d'une inspection TLS d'entreprise) sont passés au serveur MCP, qui utilise sinon son propre magasin.
  try{const pem=[...new Set([...tls.getCACertificates('system'),...tls.getCACertificates('bundled')])].join('\n');if(!pem)return null;await fs.writeFile(file,pem,{mode:0o600});return file;}catch{return null;}
}

export function createMcpGateway({command=findMcpCommand(),args=[],storageDirectory=os.tmpdir(),enabled=true,spawnImpl=spawn,startTimeoutMs=240000,callTimeoutMs=45000,cacheMs=900000,maxOutput=200000,restartDelayMs=60000,now=()=>new Date()}={}){
  let state=!enabled||!command?'disabled':'stopped',child=null,buffer='',nextId=1,tools=[],startedAt=null,readyAt=null,error=null,starting=null,closing=false,lastStart=0;
  const pending=new Map(),cache=new Map();
  const fail=reason=>{for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(new Error(reason));}pending.clear();};
  function send(method,params,timeoutMs){
    return new Promise((resolve,reject)=>{
      if(!child)return reject(new Error('not_running'));
      const id=nextId++,timer=setTimeout(()=>{pending.delete(id);reject(new Error('timeout'));},timeoutMs);timer.unref?.();
      pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
    });
  }
  function onData(chunk){
    buffer+=chunk;if(buffer.length>maxOutput*2){error='output_too_large';child?.kill();return;}
    let index;while((index=buffer.indexOf('\n'))>=0){
      const line=buffer.slice(0,index).trim();buffer=buffer.slice(index+1);if(!line)continue;
      let message;try{message=JSON.parse(line);}catch{continue;}
      const entry=message&&pending.get(message.id);if(!entry)continue;pending.delete(message.id);clearTimeout(entry.timer);
      message.error?entry.reject(new Error('rpc_error')):entry.resolve(message.result);
    }
  }
  async function start(){
    if(state==='disabled')return status();if(starting)return starting;if(state==='ready')return status();
    lastStart=Date.now();state='starting';startedAt=now().toISOString();error=null;closing=false;
    starting=(async()=>{
      await fs.mkdir(storageDirectory,{recursive:true}).catch(()=>{});
      const ca=await writeCaBundle(path.join(storageDirectory,'mcp-ca.pem'));
      const env={PYTHONIOENCODING:'utf-8',XDG_CACHE_HOME:path.join(storageDirectory,'mcp-cache')};
      for(const name of ['SystemRoot','SYSTEMROOT','PATH','Path','TEMP','TMP','LOCALAPPDATA','APPDATA','USERPROFILE','HOME','LANG','HTTPS_PROXY','HTTP_PROXY','NO_PROXY'])if(typeof process.env[name]==='string')env[name]=process.env[name];
      if(ca)Object.assign(env,{SSL_CERT_FILE:ca,CURL_CA_BUNDLE:ca,REQUESTS_CA_BUNDLE:ca});
      try{
        child=spawnImpl(command,args,{env,stdio:['pipe','pipe','pipe'],windowsHide:true,shell:false});
        child.stdout.setEncoding('utf8');child.stdout.on('data',onData);child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
        child.on('error',()=>{error='spawn_failed';});
        child.on('exit',()=>{child=null;buffer='';fail('exited');if(state!=='disabled')state=closing?'stopped':'failed';if(!closing&&!error)error='exited';});
        const init=await send('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'folio',version:'1'}},startTimeoutMs);
        if(!init||typeof init!=='object')throw new Error('bad_initialize');
        child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
        const list=await send('tools/list',{},startTimeoutMs);
        tools=(list?.tools||[]).map(tool=>tool?.name).filter(name=>typeof name==='string').slice(0,50);
        if(!Object.values(MCP_TOOLS).every(item=>tools.includes(item.tool)))throw new Error('tools_missing');
        state='ready';readyAt=now().toISOString();
      }catch(cause){error=error||String(cause?.message||'start_failed').slice(0,40);state='failed';child?.kill();child=null;}
      finally{starting=null;}
      return status();
    })();
    return starting;
  }
  function status(){return {state,tools:[...tools],startedAt,readyAt,error,command:command?path.basename(command):null,allowedTickers:[...MARKET_TICKERS],datasets:[...MARKET_DATASETS],cached:cache.size};}
  async function call({ticker,dataset}={}){
    const started=performance.now(),elapsed=()=>Math.round(performance.now()-started);
    if(!MARKET_TICKERS.includes(ticker)||typeof dataset!=='string'||!Object.hasOwn(MCP_TOOLS,dataset))return {status:'denied',passages:[],quarantined:[],durationMs:elapsed(),cached:false,reason:'outside_allowlist'};
    const key=dataset+':'+ticker,hit=cache.get(key);
    if(hit&&Date.now()-hit.at<cacheMs)return {...hit.reply,durationMs:elapsed(),cached:true};
    if(state!=='ready'){
      // Redémarrage paresseux après un arrêt, au plus une fois par minute ; l'appel en cours n'attend pas.
      if((state==='failed'||state==='stopped')&&Date.now()-lastStart>restartDelayMs)start().catch(()=>{});
      return {status:'unavailable',passages:[],quarantined:[],durationMs:elapsed(),cached:false,reason:state};
    }
    const spec=MCP_TOOLS[dataset];let result;
    try{result=await send('tools/call',{name:spec.tool,arguments:spec.args(ticker)},callTimeoutMs);}catch(cause){return {status:'error',passages:[],quarantined:[],durationMs:elapsed(),cached:false,reason:String(cause?.message||'call_failed').slice(0,40)};}
    const raw=(Array.isArray(result?.content)?result.content:[]).filter(part=>part?.type==='text'&&typeof part.text==='string').map(part=>part.text).join('');
    if(result?.isError||!raw||/^Error:/i.test(raw.trim()))return {status:'error',passages:[],quarantined:[],durationMs:elapsed(),cached:false,reason:'tool_error'};
    if(raw.length>maxOutput)return {status:'error',passages:[],quarantined:[],durationMs:elapsed(),cached:false,reason:'too_large'};
    const text=renderMarket(dataset,ticker,raw);
    if(!text)return {status:'error',passages:[],quarantined:[],durationMs:elapsed(),cached:false,reason:'unexpected_format'};
    // Les champs écartés ne sont jamais transmis ; le texte retenu passe le même filtre que les passages des rapports.
    const scan=screenUntrustedText(text),retrievedAt=now().toISOString();
    let reply;
    if(scan.disposition==='quarantine')reply={status:'quarantined',passages:[],quarantined:[{ticker,signals:scan.signals}],retrievedAt};
    else reply={status:'ok',retrievedAt,quarantined:[],passages:[{id:'market-'+createHash('sha256').update(spec.tool+':'+ticker+':'+text).digest('hex').slice(0,20),source:'yahoo_finance_mcp',tool:spec.tool,dataset,ticker,company:COMPANY[ticker].toLowerCase(),retrievedAt,name:'Yahoo Finance (MCP) — '+ticker,page:null,year:retrievedAt.slice(0,4),text,trust:'untrusted_external_data',instructionAuthority:'none'}]};
    cache.set(key,{at:Date.now(),reply});
    return {...reply,durationMs:elapsed(),cached:false};
  }
  async function close(){closing=true;fail('closing');if(child){child.kill();child=null;}if(state!=='disabled')state='stopped';}
  return {start,status,call,close};
}
