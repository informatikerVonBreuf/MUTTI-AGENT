import {createServer} from 'node:http';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createAppStore,parseDocumentAcl} from './app-store.mjs';
import {createAuthService} from './auth-service.mjs';
import {parseEnv} from 'node:util';
import {loadBackendConfig} from './backend-config.mjs';
import {createAIConnector,userReference} from './ai-connector.mjs';
import {createMetricsLog,createLatencyRecorder,routeKey,aggregateRuns,priceFor,FOOTPRINT,PRICING} from './run-metrics.mjs';
import {createAuditLog} from './audit-log.mjs';
import {createCsrfGuard,createRateLimiter,AI_LIMITS,IP_LIMITS,validateBody,SCHEMAS,SECURITY_HEADERS,cookieValue} from './request-guards.mjs';
import {CLASSIFIER} from './injection-screen.mjs';
import {createHumanCheck} from './human-check.mjs';
import {createMcpGateway,findMcpCommand} from './mcp-gateway.mjs';
import {securityOverview,sandbox} from './security-overview.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const development=process.argv.includes('--dev');
const projectRoot=path.resolve(root,'..'),storageDirectory=process.env.FOLIO_DATA_DIR||path.join(root,'.runtime');
const config=await loadBackendConfig({projectRoot,storageDirectory});
let environmentValues={};try{environmentValues=parseEnv(await fs.readFile(config.environmentFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw new Error('Configuration de connexion illisible.');}
const settings={...environmentValues,...process.env};
// Derrière nginx (FOLIO_TRUST_PROXY=1), l'adresse du client vient de X-Real-IP posé par le proxy ; sinon de la connexion.
const trustProxy=settings.FOLIO_TRUST_PROXY==='1';
const ipOf=request=>{if(trustProxy){const real=String(request.headers['x-real-ip']||'').trim();if(/^[0-9a-f.:]{3,45}$/i.test(real))return real;}return request.socket?.remoteAddress||'local';};
let connector;
const auth=await createAuthService({storageDirectory,values:settings,ipOf});
// ACL documentaire : entreprises autorisées d'un sous-compte, sinon règle statique FOLIO_DOCUMENT_ACL, sinon tout le corpus.
const staticAcl=parseDocumentAcl(settings.FOLIO_DOCUMENT_ACL);
const documentAcl=actor=>actor?.role==='member'?(auth.companiesFor(actor.id)||[]):staticAcl?(staticAcl[actor?.id]??staticAcl[actor?.email]??staticAcl['*']??null):null;
// Manifeste du corpus exigé : sans lui, le serveur refuse de démarrer (échec fermé face à un corpus non vérifié).
const store=await createAppStore({projectRoot,storageDirectory,backendState:()=>connector?.status()||{connected:false,citationsEnabled:false},documentAcl,requireManifest:true});
const human=await createHumanCheck({storageDirectory,enabled:settings.FOLIO_HUMAN_CHECK!=='off'});
const metrics=await createMetricsLog({storageDirectory}),latency=createLatencyRecorder();
const audit=await createAuditLog({storageDirectory});
if(!audit.startupCheck.valid)console.error(`Journal d’audit rompu à la ligne ${audit.startupCheck.brokenAt} : vérifiez scripts/verify-audit.mjs.`);
const csrf=await createCsrfGuard({storageDirectory,secure:settings.FOLIO_SECURE_COOKIES==='1'}),rateLimit=createRateLimiter();
// Passerelle MCP des résumés thématiques : processus unique, démarré en arrière-plan (45 à 130 s sous Windows).
const mcp=createMcpGateway({command:config.mcp.command||findMcpCommand(),storageDirectory,enabled:config.mcp.enabled&&!config.disabled});
connector=await createAIConnector({store,config,metrics,audit,mcp});
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
const json=(response,status,data)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});response.end(JSON.stringify(data));};
async function body(request,schema){let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>65536){const error=new Error('La demande est trop volumineuse.');error.status=413;throw error;}chunks.push(chunk);}let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{const error=new Error('Données JSON invalides.');error.status=400;throw error;}if(!data||Array.isArray(data)||typeof data!=='object'){const error=new Error('Un objet JSON est requis.');error.status=400;throw error;}return schema?validateBody(data,schema):data;}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
const sessionToken=cookie=>String(cookie||'').match(/^folio_session=([^;]*)/)?.[1]||'';
const audited=(action,fields)=>{try{audit.append(action,fields);}catch{}};
// Connexion, création, récupération : chaque issue est auditée (sans adresse ni mot de passe).
async function authAction(kind,response,action){
  try{
    const result=await action();
    if(result.mfaRequired){audited('auth',{actor:'anonymous',decision:'allowed',reason:kind+':mfa_challenge'});return result;}
    const token=sessionToken(result.cookie);response.setHeader('Set-Cookie',token?[result.cookie,csrf.cookie(token)]:[result.cookie]);audited('auth',{actor:userReference(result.session?.user),decision:'allowed',reason:kind});return result;
  }catch(error){audited('auth',{actor:'anonymous',decision:'blocked',reason:(kind+':'+(error.code||'error')).slice(0,120)});throw error;}
}
// Vérification anti-robot avant tout calcul coûteux (scrypt) : défi signé, preuve de travail, champ piège.
function requireHuman(fields,kind){
  const problem=human.verify(fields.human);
  if(problem){audited('security',{actor:'anonymous',decision:'blocked',reason:'human_check:'+kind+':'+problem});throw Object.assign(new Error('La vérification « je ne suis pas un robot » a échoué ou expiré. Recommencez-la.'),{status:400,code:'HUMAN_CHECK_FAILED'});}
  const {human:ignored,...rest}=fields;return rest;
}
const tooMany=(response,decision,message='Trop de demandes rapprochées.')=>{response.setHeader('Retry-After',String(decision.retryAfter));return json(response,429,{code:'RATE_LIMITED',error:`${message} Réessayez dans ${decision.retryAfter} s.`});};
const accountAudit=(actor,reason)=>audited('auth',{actor:userReference(actor),decision:'allowed',reason});
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
      // Déni de service : débit par adresse IP sur toute l'API (santé exceptée), plus strict pour les routes de connexion.
      if(url.pathname!=='/api/health'){
        const ip=ipOf(request),authRoute=url.pathname.startsWith('/api/auth/')&&(request.method==='POST'||url.pathname==='/api/auth/challenge');
        const decision=rateLimit('ip '+ip,IP_LIMITS.api);if(!decision.allowed){request.resume();return tooMany(response,decision);}
        if(authRoute){const strict=rateLimit('auth '+ip,IP_LIMITS.auth);if(!strict.allowed){request.resume();audited('security',{actor:'anonymous',decision:'blocked',reason:'rate_limited:auth'});return tooMany(response,strict,'Trop de tentatives de connexion.');}}
      }
      if(request.method==='GET'&&url.pathname==='/api/health')return json(response,200,{status:'ok',version:'rag-v8',backendConnected:connector.status().connected});
      if(request.method==='GET'&&url.pathname==='/api/auth/status')return json(response,200,{...auth.status(),humanCheck:human.enabled?'proof_of_work':'off'});
      if(request.method==='GET'&&url.pathname==='/api/auth/challenge')return json(response,200,human.issue());
      if(request.method==='GET'&&url.pathname==='/api/auth/session'){const session=auth.session(request);if(session.authenticated)response.setHeader('Set-Cookie',csrf.cookie(cookieValue(request,'folio_session')));return json(response,200,session);}
      if(request.method==='POST'&&url.pathname==='/api/auth/setup'){const fields=requireHuman(await body(request,SCHEMAS.setup),'setup');const result=await authAction('setup',response,()=>auth.setup(fields,request));return json(response,201,{accepted:true,recoveryCode:result.recoveryCode});}
      if(request.method==='POST'&&url.pathname==='/api/auth/login'){const fields=requireHuman(await body(request,SCHEMAS.login),'login');const result=await authAction('login',response,()=>auth.login(fields,request));return json(response,200,result.mfaRequired?{accepted:false,mfaRequired:true,challenge:result.challenge,expiresIn:result.expiresIn}:{accepted:true});}
      if(request.method==='POST'&&url.pathname==='/api/auth/mfa'){const fields=await body(request,SCHEMAS.mfa);await authAction('mfa',response,()=>auth.verifyMfa(fields,request));return json(response,200,{accepted:true});}
      if(request.method==='POST'&&url.pathname==='/api/auth/reset'){const fields=requireHuman(await body(request,SCHEMAS.reset),'reset');const result=await authAction('reset',response,()=>auth.reset(fields,request));return json(response,200,{accepted:true,recoveryCode:result.recoveryCode});}
      if(request.method==='POST'&&url.pathname==='/api/auth/logout'){
        request.resume();const session=auth.session(request);
        if(session.authenticated&&!csrf.valid(request)){response.setHeader('Set-Cookie',csrf.cookie(cookieValue(request,'folio_session')));return json(response,403,{code:'CSRF_INVALID',error:'Jeton de sécurité manquant ou périmé. Réessayez.'});}
        const result=await auth.logout(request);response.setHeader('Set-Cookie',[result.cookie,csrf.clearCookie()]);audited('auth',{actor:userReference(session.user),decision:'allowed',reason:'logout'});return json(response,200,{accepted:true,logoutUrl:result.logoutUrl});
      }
      if(request.method==='POST'&&url.pathname==='/api/auth/recovery'){request.resume();return json(response,409,{code:'RECOVERY_METHOD_REQUIRED',error:'Utilisez le code de récupération local ou le parcours AWS indiqué sur la page.'});}
      if(request.method==='GET'&&url.pathname==='/api/auth/redirect'){const result=await auth.oauthStart(request);if(result.cookie)response.setHeader('Set-Cookie',result.cookie);response.writeHead(303,{Location:result.location,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});return response.end();}
      if(oauthCallback){try{const result=await auth.oauthCallback(request,url);const token=sessionToken(result.cookie);response.setHeader('Set-Cookie',[result.cookie,result.stateCookie,...(token?[csrf.cookie(token)]:[])]);audited('auth',{actor:userReference(result.session?.user),decision:'allowed',reason:'cognito'});response.writeHead(303,{Location:result.location,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});}catch{audited('auth',{actor:'anonymous',decision:'blocked',reason:'cognito'});response.writeHead(303,{Location:'/?auth=failed#login','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});}return response.end();}
      const session=auth.session(request);
      if(!session.authenticated)return json(response,401,{code:'SESSION_EXPIRED',error:'Connectez-vous pour accéder à votre atelier.'});
      const actor=session.user;
      // CSRF : toute modification authentifiée porte le jeton lié à la session.
      if(!['GET','HEAD'].includes(request.method)&&!csrf.valid(request)){request.resume();response.setHeader('Set-Cookie',csrf.cookie(cookieValue(request,'folio_session')));audited('security',{actor:userReference(actor),decision:'blocked',reason:'csrf_invalid'});return json(response,403,{code:'CSRF_INVALID',error:'Jeton de sécurité manquant ou périmé. Réessayez.'});}
      // Limitation de débit des routes IA, par utilisateur.
      const limitKey=routeKey(request.method,url.pathname),limit=AI_LIMITS[limitKey];
      if(limit){const decision=rateLimit(actor.id+' '+limitKey,limit);if(!decision.allowed){request.resume();response.setHeader('Retry-After',String(decision.retryAfter));audited('security',{actor:userReference(actor),decision:'blocked',reason:'rate_limited:'+limitKey.replace(/[^A-Za-z0-9_.:-]/g,'_').slice(0,90)});return json(response,429,{code:'RATE_LIMITED',error:`Trop de demandes rapprochées. Réessayez dans ${decision.retryAfter} s.`});}}
      // Mon compte : sessions, mot de passe, double authentification.
      if(request.method==='GET'&&url.pathname==='/api/account')return json(response,200,auth.accountInfo(actor));
      if(request.method==='GET'&&url.pathname==='/api/account/sessions')return json(response,200,{sessions:auth.listSessions(actor,request)});
      if(request.method==='POST'&&url.pathname==='/api/account/sessions/revoke-others'){await body(request,SCHEMAS.empty);const result=await auth.revokeOtherSessions(actor,request);accountAudit(actor,'sessions_revoked');return json(response,200,result);}
      if(request.method==='POST'&&url.pathname==='/api/account/password'){const result=await auth.changePassword(actor,await body(request,SCHEMAS.passwordChange),request);accountAudit(actor,'password_changed');return json(response,200,result);}
      if(request.method==='POST'&&url.pathname==='/api/account/mfa/setup'){await body(request,SCHEMAS.empty);return json(response,200,auth.mfaSetup(actor));}
      if(request.method==='POST'&&url.pathname==='/api/account/mfa/enable'){const result=await auth.mfaEnable(actor,await body(request,SCHEMAS.mfaConfirm),request);accountAudit(actor,'mfa_enabled');return json(response,200,result);}
      if(request.method==='POST'&&url.pathname==='/api/account/mfa/disable'){const result=await auth.mfaDisable(actor,await body(request,SCHEMAS.mfaConfirm),request);accountAudit(actor,'mfa_disabled');return json(response,200,result);}
      // Un sous-compte invité doit d'abord remplacer son code d'invitation par son propre mot de passe.
      if(actor.mustChangePassword){request.resume();return json(response,403,{code:'PASSWORD_CHANGE_REQUIRED',error:'Choisissez votre mot de passe personnel pour accéder à l’atelier.'});}
      // Sous-comptes : réservés au propriétaire.
      const memberMatch=url.pathname.match(/^\/api\/accounts(?:\/([-a-f0-9]{36}))?$/);
      if(memberMatch){
        if(request.method==='GET'&&!memberMatch[1])return json(response,200,{members:auth.listMembers(actor)});
        if(request.method==='POST'&&!memberMatch[1]){const result=await auth.createMember(actor,await body(request,SCHEMAS.memberCreate));accountAudit(actor,'member_created');return json(response,201,result);}
        if(request.method==='PATCH'&&memberMatch[1]){const result=await auth.updateMember(actor,memberMatch[1],await body(request,SCHEMAS.memberUpdate));accountAudit(actor,'member_updated');return json(response,200,result);}
        if(request.method==='DELETE'&&memberMatch[1]){request.resume();const result=await auth.deleteMember(actor,memberMatch[1]);accountAudit(actor,'member_deleted');return json(response,200,result);}
      }
      const ownerOnly=['/api/metrics','/api/audit/verify','/api/security/overview','/api/security/sandbox'].includes(url.pathname);
      // Liste d'autorisation : le propriétaire local, ou l'unique compte Cognito admis (l'adresse du propriétaire, voir cognito-login.mjs).
      const isOwner=actor.role==='owner'||(actor.provider==='cognito'&&!actor.role);
      if(ownerOnly&&!isOwner){request.resume();return json(response,403,{code:'FORBIDDEN',error:'Réservé au propriétaire de l’atelier.'});}
      if(request.method==='GET'&&url.pathname==='/api/backend/status')return json(response,200,connector.status());
      if(request.method==='POST'&&url.pathname==='/api/backend/probe'){request.resume();return json(response,200,await connector.probe());}
      if(request.method==='GET'&&url.pathname==='/api/workspace')return json(response,200,store.overview(actor));
      if(request.method==='GET'&&url.pathname==='/api/metrics')return json(response,200,metricsReport());
      if(request.method==='GET'&&url.pathname==='/api/audit/verify'){const result=await audit.verify();return json(response,200,{...result,startup:audit.startupCheck,classifier:CLASSIFIER});}
      // Page Sécurité : architecture par couche, intégrité du corpus, résultats des attaques, bac à sable déterministe.
      if(request.method==='GET'&&url.pathname==='/api/security/overview')return json(response,200,await securityOverview({projectRoot,store,metricsReport,audit,mcp}));
      if(request.method==='POST'&&url.pathname==='/api/security/sandbox')return json(response,200,sandbox(await body(request,SCHEMAS.sandbox)));
      const documentMatch=url.pathname.match(/^\/api\/documents\/([a-f0-9]{18})(?:\/(pdf))?$/);
      if(documentMatch&&request.method==='GET'){
        const doc=store.document(documentMatch[1]);if(!doc||!store.canReadDocument(doc.id,actor))return json(response,404,{error:'Document introuvable.'});
        if(documentMatch[2]==='pdf'){
          if(!doc.pdf)return json(response,404,{error:'Le PDF original n’est pas disponible.'});
          // Intégrité : les octets envoyés sont ceux dont l'empreinte vient d'être vérifiée contre le manifeste.
          const content=await store.readVerified(doc.id,'pdf');
          if(!content)return json(response,409,{code:'CORPUS_ALTERED',error:'Ce rapport a été modifié depuis sa vérification : il n’est plus servi.'});response.writeHead(200,{'Content-Type':'application/pdf','Content-Length':content.length,'Content-Disposition':`${url.searchParams.has('download')?'attachment':'inline'}; filename="folio-${doc.id}.pdf"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});return response.end(content);
        }
        if(url.searchParams.get('download')==='1'){
          if(!doc.text)return json(response,404,{error:'Texte extrait indisponible.'});
          const bytes=await store.readVerified(doc.id,'text');
          if(!bytes)return json(response,409,{code:'CORPUS_ALTERED',error:'Ce rapport a été modifié depuis sa vérification : il n’est plus servi.'});
          const content=bytes.toString('utf8');
          response.writeHead(200,{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename="folio-${doc.id}.md"`,'X-Content-Type-Options':'nosniff'});return response.end(content);
        }
        const payload=await store.documentPayload(doc.id);
        if(!payload)return json(response,409,{code:'CORPUS_ALTERED',error:'Ce rapport a été modifié depuis sa vérification : il n’est plus servi.'});
        const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, max-age=300','ETag':payload.etag,'Vary':'Accept-Encoding','X-Content-Type-Options':'nosniff'};
        if(request.headers['if-none-match']===payload.etag){response.writeHead(304,headers);return response.end();}
        // Texte du rapport compressé une seule fois à la mise en cache : 4 à 5 fois moins d'octets à transmettre.
        const gzipped=/\bgzip\b/.test(String(request.headers['accept-encoding']||''))&&payload.gzip;
        const bytes=gzipped?payload.gzip:payload.body;
        response.writeHead(200,{...headers,...(gzipped?{'Content-Encoding':'gzip'}:{}),'Content-Length':bytes.length});return response.end(bytes);
      }
      if(request.method==='POST'&&url.pathname==='/api/threads')return json(response,201,await store.createThread(await body(request,SCHEMAS.createThread),actor));
      const match=url.pathname.match(/^\/api\/threads\/([a-zA-Z0-9-]+)(?:\/(messages|memory|context|plan|rag-context|run|audit)(?:\/([a-zA-Z0-9-]+))?)?$/);
      if(match){
        const [,id,action,itemId]=match;
        // Isolation : la conversation d'un autre compte est introuvable, y compris par appel direct.
        if(!store.canAccess(id,actor)){request.resume();return json(response,404,{error:'Conversation introuvable.'});}
        if(!action&&request.method==='GET')return json(response,200,store.getThread(id));
        if(!action&&request.method==='PATCH')return json(response,200,await store.updateThread(id,await body(request,SCHEMAS.updateThread)));
        if(!action&&request.method==='DELETE'){await connector.cancel(id);return json(response,200,await store.deleteThread(id));}
        if(action==='run'&&!itemId&&request.method==='POST')return json(response,202,await connector.start(id,await body(request,SCHEMAS.run),{actor}));
        if(action==='run'&&!itemId&&request.method==='GET')return json(response,200,connector.latest(id));
        if(action==='run'&&!itemId&&request.method==='DELETE')return json(response,200,await connector.cancel(id));
        if(action==='audit'&&!itemId&&request.method==='GET'){const runId=connector.latest(id)?.id;return json(response,200,{runId:runId||null,entries:runId?audit.forRun(runId):[],chain:await audit.verify()});}
        if(action==='messages'&&!itemId&&request.method==='POST')return json(response,201,await store.addMessage(id,(await body(request,SCHEMAS.message)).content));
        if(action==='plan'&&!itemId&&request.method==='GET')return json(response,200,store.plan(id));
        if(action==='rag-context'&&!itemId&&request.method==='POST')return json(response,200,await store.prepareRag(id,(await body(request,SCHEMAS.ragContext)).question,{actor}));
        if(action==='context'&&!itemId&&request.method==='GET')return json(response,200,store.context(id));
        if(action==='memory'&&!itemId&&request.method==='POST')return json(response,201,await store.addMemory(id,await body(request,SCHEMAS.memory)));
        if(action==='memory'&&itemId&&request.method==='PATCH')return json(response,200,await store.updateMemory(id,itemId,await body(request,SCHEMAS.memoryEdit)));
        if(action==='memory'&&itemId&&request.method==='DELETE')return json(response,200,await store.deleteMemory(id,itemId));
      }
      return json(response,404,{error:'Route introuvable.'});
    }
    if(development)return vite.middlewares(request,response,()=>{response.writeHead(404);response.end('Introuvable');});
    if(!['GET','HEAD'].includes(request.method)){response.writeHead(405);return response.end();}
    const dist=process.env.FOLIO_DIST_DIR?path.resolve(process.env.FOLIO_DIST_DIR):path.join(root,'dist'),relative=decodeURIComponent(url.pathname).replace(/^\/+/, '');
    let target=path.resolve(dist,relative||'index.html');
    if(target!==dist&&!target.startsWith(dist+path.sep)){response.writeHead(403);return response.end();}
    try{if(!(await fs.stat(target)).isFile())target=path.join(dist,'index.html');}catch{if(path.extname(relative)&&path.extname(relative)!=='.html'){response.writeHead(404);return response.end('Introuvable');}target=path.join(dist,'index.html');}
    const content=await fs.readFile(target);
    response.writeHead(200,{...SECURITY_HEADERS,'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':path.extname(target)==='.html'?'no-cache':'public, max-age=3600'});return response.end(request.method==='HEAD'?undefined:content);
  }catch(error){if(!response.headersSent)json(response,error.status||500,{...(error.status&&error.code?{code:error.code}:{}),error:error.status?error.message:'Une erreur est survenue côté serveur.'});else response.end();if(!error.status)console.error('Une opération du serveur a échoué.');}
});
if(development){const {createServer:createViteServer}=await import('vite');vite=await createViteServer({root,configFile:path.join(root,'vite.config.js'),server:{middlewareMode:true,hmr:{server}},appType:'spa'});}
// Déni de service : connexions lentes coupées (en-têtes, corps), connexions simultanées bornées.
server.headersTimeout=20000;server.requestTimeout=30000;server.keepAliveTimeout=5000;server.maxHeadersCount=60;
server.maxConnections=Number(settings.FOLIO_MAX_CONNECTIONS)||256;
const port=Number(process.env.PORT||5173);
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Le port ${port} est déjà utilisé. Ouvrez http://127.0.0.1:${port} ou choisissez PORT.`:error.message);process.exitCode=1;});
const host=process.env.FOLIO_HOST||'127.0.0.1';
server.listen(port,host,()=>{console.log(`\n  Folio — http://${host==='0.0.0.0'?'127.0.0.1':host}:${server.address().port}\n  Bibliothèque · Conversations · Résumés thématiques\n`);store.warm().then(()=>store.corpusReport()).then(report=>audited('security',{actor:'system',decision:report.summary.altered||report.summary.unlisted||report.summary.missing?'blocked':'allowed',reason:'corpus_verified',count:report.summary.verified})).catch(()=>{});connector.prewarm();void mcp.start();});
let closing=false;
async function close(){if(closing)return;closing=true;await mcp.close();await connector.close();await metrics.close();await audit.close();await store.close();await auth.close();await vite?.close();server.close(()=>process.exit(0));server.closeIdleConnections();}
process.on('SIGINT',close);process.on('SIGTERM',close);
