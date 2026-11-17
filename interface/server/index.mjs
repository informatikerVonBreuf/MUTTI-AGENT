import {createServer} from 'node:http';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createAppStore} from './app-store.mjs';
import {createAuthService} from './auth-service.mjs';
import {parseEnv} from 'node:util';
import {loadBackendConfig} from './backend-config.mjs';
import {createAIConnector} from './ai-connector.mjs';
import {createMetricsLog,createLatencyRecorder,routeKey,aggregateRuns,priceFor,FOOTPRINT,PRICING} from './run-metrics.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const development=process.argv.includes('--dev');
const projectRoot=path.resolve(root,'..'),storageDirectory=process.env.FOLIO_DATA_DIR||path.join(root,'.runtime');
let connector;
const store=await createAppStore({projectRoot,storageDirectory,backendState:()=>connector?.status()||{connected:false,citationsEnabled:false}});
const config=await loadBackendConfig({projectRoot,storageDirectory});
let environmentValues={};try{environmentValues=parseEnv(await fs.readFile(config.environmentFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw new Error('Configuration de connexion illisible.');}
const auth=await createAuthService({storageDirectory,values:{...environmentValues,...process.env}});
const metrics=await createMetricsLog({storageDirectory}),latency=createLatencyRecorder();
connector=await createAIConnector({store,config,metrics});
void connector.probe();
// En conteneur, le serveur écoute sur le réseau interne ; les hôtes admis restent explicites.
const allowedHosts=new Set(['127.0.0.1','localhost','[::1]',...(process.env.FOLIO_ALLOWED_HOSTS||'').split(',').map(host=>host.trim().toLowerCase()).filter(host=>/^[a-z0-9.-]{1,253}$/.test(host))]);
function metricsReport(){
  const records=metrics.records();
  return {generatedAt:new Date().toISOString(),runs:aggregateRuns(records),
    recent:records.slice(-25).reverse().map(({runId,kind,status,errorCode,startedAt,durationMs,tasks,simulated,usage})=>({runId,kind,status,errorCode,startedAt,durationMs,tasks,simulated,total:usage?.total||null})),
    http:latency.summary(),pricing:{...priceFor(config.model,new Date(),config.priceOverride),checkedAt:PRICING.checkedAt},footprint:FOOTPRINT,
    provider:{simulated:Boolean(config.simulated),model:config.model},
    method:{percentiles:'nearest_rank',httpWindow:'5000 dernières requêtes depuis le démarrage',runs:'exécutions terminées enregistrées dans .runtime/metrics/runs.jsonl'}};
}
const json=(response,status,data)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(JSON.stringify(data));};
async function body(request){let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>65536){const error=new Error('La demande est trop volumineuse.');error.status=413;throw error;}chunks.push(chunk);}let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{const error=new Error('Données JSON invalides.');error.status=400;throw error;}if(!data||Array.isArray(data)||typeof data!=='object'){const error=new Error('Un objet JSON est requis.');error.status=400;throw error;}return data;}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
let vite;
const server=createServer(async(request,response)=>{
  const started=performance.now();
  try{
    const url=new URL(request.url,`http://${request.headers.host}`);
    if(url.pathname.startsWith('/api/'))response.on('finish',()=>latency.record(routeKey(request.method,url.pathname),performance.now()-started,response.statusCode));
    if(!allowedHosts.has(url.hostname))return json(response,403,{error:'Hôte non autorisé.'});
    if(url.pathname.startsWith('/api/')){
      const oauthCallback=request.method==='GET'&&url.pathname==='/api/auth/callback';
      if(!oauthCallback&&(request.headers.origin&&request.headers.origin!==url.origin||request.headers['sec-fetch-site']==='cross-site'))return json(response,403,{error:'Origine non autorisée.'});
      if(request.method==='GET'&&url.pathname==='/api/health')return json(response,200,{status:'ok',version:'sessions-v5',backendConnected:connector.status().connected});
      if(request.method==='GET'&&url.pathname==='/api/auth/status')return json(response,200,auth.status());
      if(request.method==='GET'&&url.pathname==='/api/auth/session')return json(response,200,auth.session(request));
      if(request.method==='POST'&&url.pathname==='/api/auth/setup'){const result=await auth.setup(await body(request),request);response.setHeader('Set-Cookie',result.cookie);return json(response,201,{accepted:true,recoveryCode:result.recoveryCode});}
      if(request.method==='POST'&&url.pathname==='/api/auth/login'){const result=await auth.login(await body(request),request);response.setHeader('Set-Cookie',result.cookie);return json(response,200,{accepted:true});}
      if(request.method==='POST'&&url.pathname==='/api/auth/reset'){const result=await auth.reset(await body(request),request);response.setHeader('Set-Cookie',result.cookie);return json(response,200,{accepted:true,recoveryCode:result.recoveryCode});}
      if(request.method==='POST'&&url.pathname==='/api/auth/logout'){request.resume();const result=await auth.logout(request);response.setHeader('Set-Cookie',result.cookie);return json(response,200,{accepted:true,logoutUrl:result.logoutUrl});}
      if(request.method==='POST'&&url.pathname==='/api/auth/recovery'){request.resume();return json(response,409,{code:'RECOVERY_METHOD_REQUIRED',error:'Utilisez le code de récupération local ou le parcours AWS indiqué sur la page.'});}
      if(request.method==='GET'&&url.pathname==='/api/auth/redirect'){const result=await auth.oauthStart(request);if(result.cookie)response.setHeader('Set-Cookie',result.cookie);response.writeHead(303,{Location:result.location,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});return response.end();}
      if(oauthCallback){try{const result=await auth.oauthCallback(request,url);response.setHeader('Set-Cookie',[result.cookie,result.stateCookie]);response.writeHead(303,{Location:result.location,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});}catch{response.writeHead(303,{Location:'/?auth=failed#login','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});}return response.end();}
      if(!auth.session(request).authenticated)return json(response,401,{code:'SESSION_EXPIRED',error:'Connectez-vous pour accéder à votre atelier.'});
      if(request.method==='GET'&&url.pathname==='/api/backend/status')return json(response,200,connector.status());
      if(request.method==='POST'&&url.pathname==='/api/backend/probe')return json(response,200,await connector.probe());
      if(request.method==='GET'&&url.pathname==='/api/workspace')return json(response,200,store.overview());
      if(request.method==='GET'&&url.pathname==='/api/metrics')return json(response,200,metricsReport());
      const documentMatch=url.pathname.match(/^\/api\/documents\/([a-f0-9]{18})(?:\/(pdf))?$/);
      if(documentMatch&&request.method==='GET'){
        const doc=store.document(documentMatch[1]);if(!doc)return json(response,404,{error:'Document introuvable.'});
        if(documentMatch[2]==='pdf'){
          if(!doc.pdf)return json(response,404,{error:'Le PDF original n’est pas disponible.'});
          const content=await fs.readFile(doc.pdf);response.writeHead(200,{'Content-Type':'application/pdf','Content-Length':content.length,'Content-Disposition':`${url.searchParams.has('download')?'attachment':'inline'}; filename="folio-${doc.id}.pdf"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});return response.end(content);
        }
        if(url.searchParams.get('download')==='1'){
          if(!doc.text)return json(response,404,{error:'Texte extrait indisponible.'});
          const content=await fs.readFile(doc.text,'utf8');
          response.writeHead(200,{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename="folio-${doc.id}.md"`,'X-Content-Type-Options':'nosniff'});return response.end(content);
        }
        const payload=await store.documentPayload(doc.id);
        const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, max-age=300','ETag':payload.etag,'X-Content-Type-Options':'nosniff'};
        if(request.headers['if-none-match']===payload.etag){response.writeHead(304,headers);return response.end();}
        response.writeHead(200,{...headers,'Content-Length':payload.body.length});return response.end(payload.body);
      }
      if(request.method==='POST'&&url.pathname==='/api/threads')return json(response,201,await store.createThread(await body(request)));
      const match=url.pathname.match(/^\/api\/threads\/([a-zA-Z0-9-]+)(?:\/(messages|memory|context|plan|rag-context|run)(?:\/([a-zA-Z0-9-]+))?)?$/);
      if(match){
        const [,id,action,itemId]=match;
        if(!action&&request.method==='GET')return json(response,200,store.getThread(id));
        if(!action&&request.method==='PATCH')return json(response,200,await store.updateThread(id,await body(request)));
        if(!action&&request.method==='DELETE'){await connector.cancel(id);return json(response,200,await store.deleteThread(id));}
        if(action==='run'&&!itemId&&request.method==='POST')return json(response,202,await connector.start(id,await body(request),{actor:auth.session(request).user}));
        if(action==='run'&&!itemId&&request.method==='GET')return json(response,200,connector.latest(id));
        if(action==='run'&&!itemId&&request.method==='DELETE')return json(response,200,await connector.cancel(id));
        if(action==='messages'&&!itemId&&request.method==='POST')return json(response,201,await store.addMessage(id,(await body(request)).content));
        if(action==='plan'&&!itemId&&request.method==='GET')return json(response,200,store.plan(id));
        if(action==='rag-context'&&!itemId&&request.method==='POST')return json(response,200,await store.prepareRag(id,(await body(request)).question));
        if(action==='context'&&!itemId&&request.method==='GET')return json(response,200,store.context(id));
        if(action==='memory'&&!itemId&&request.method==='POST')return json(response,201,await store.addMemory(id,await body(request)));
        if(action==='memory'&&itemId&&request.method==='PATCH')return json(response,200,await store.updateMemory(id,itemId,await body(request)));
        if(action==='memory'&&itemId&&request.method==='DELETE')return json(response,200,await store.deleteMemory(id,itemId));
      }
      return json(response,404,{error:'Route introuvable.'});
    }
    if(development)return vite.middlewares(request,response,()=>{response.writeHead(404);response.end('Introuvable');});
    if(!['GET','HEAD'].includes(request.method)){response.writeHead(405);return response.end();}
    const dist=path.join(root,'dist'),relative=decodeURIComponent(url.pathname).replace(/^\/+/, '');
    let target=path.resolve(dist,relative||'index.html');
    if(target!==dist&&!target.startsWith(dist+path.sep)){response.writeHead(403);return response.end();}
    try{if(!(await fs.stat(target)).isFile())target=path.join(dist,'index.html');}catch{if(path.extname(relative)&&path.extname(relative)!=='.html'){response.writeHead(404);return response.end('Introuvable');}target=path.join(dist,'index.html');}
    const content=await fs.readFile(target);
    response.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':path.extname(target)==='.html'?'no-cache':'public, max-age=3600','X-Content-Type-Options':'nosniff'});return response.end(request.method==='HEAD'?undefined:content);
  }catch(error){if(!response.headersSent)json(response,error.status||500,{...(error.status&&error.code?{code:error.code}:{}),error:error.status?error.message:'Une erreur est survenue côté serveur.'});else response.end();if(!error.status)console.error('Une opération du serveur a échoué.');}
});
if(development){const {createServer:createViteServer}=await import('vite');vite=await createViteServer({root,configFile:path.join(root,'vite.config.js'),server:{middlewareMode:true,hmr:{server}},appType:'spa'});}
const port=Number(process.env.PORT||5173);
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Le port ${port} est déjà utilisé. Ouvrez http://127.0.0.1:${port} ou choisissez PORT.`:error.message);process.exitCode=1;});
const host=process.env.FOLIO_HOST||'127.0.0.1';
server.listen(port,host,()=>{console.log(`\n  Folio — http://${host==='0.0.0.0'?'127.0.0.1':host}:${server.address().port}\n  Bibliothèque · Conversations · Résumés thématiques\n`);store.warm().catch(()=>{});});
let closing=false;
async function close(){if(closing)return;closing=true;await connector.close();await metrics.close();await store.close();await auth.close();await vite?.close();server.close(()=>process.exit(0));server.closeIdleConnections();}
process.on('SIGINT',close);process.on('SIGTERM',close);
