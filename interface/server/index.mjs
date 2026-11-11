import {createServer} from 'node:http';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createAppStore} from './app-store.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const development=process.argv.includes('--dev');
const store=await createAppStore({projectRoot:path.resolve(root,'..'),storageDirectory:process.env.FOLIO_DATA_DIR||path.join(root,'.runtime')});
const json=(response,status,data)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(JSON.stringify(data));};
async function body(request){let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>65536){const error=new Error('La demande est trop volumineuse.');error.status=413;throw error;}chunks.push(chunk);}let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{const error=new Error('Données JSON invalides.');error.status=400;throw error;}if(!data||Array.isArray(data)||typeof data!=='object'){const error=new Error('Un objet JSON est requis.');error.status=400;throw error;}return data;}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
let vite;
const server=createServer(async(request,response)=>{
  try{
    const url=new URL(request.url,`http://${request.headers.host}`);
    if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))return json(response,403,{error:'Hôte non autorisé.'});
    if(url.pathname.startsWith('/api/')){
      if(request.headers.origin&&request.headers.origin!==url.origin)return json(response,403,{error:'Origine non autorisée.'});
      if(request.method==='GET'&&url.pathname==='/api/health')return json(response,200,{status:'ok',version:'sessions-v1',backendConnected:false});
      if(request.method==='GET'&&url.pathname==='/api/workspace')return json(response,200,store.overview());
      const documentMatch=url.pathname.match(/^\/api\/documents\/([a-f0-9]{18})(?:\/(pdf))?$/);
      if(documentMatch&&request.method==='GET'){
        const doc=store.document(documentMatch[1]);if(!doc)return json(response,404,{error:'Document introuvable.'});
        if(documentMatch[2]==='pdf'){
          if(!doc.pdf)return json(response,404,{error:'Le PDF original n’est pas disponible.'});
          const content=await fs.readFile(doc.pdf);response.writeHead(200,{'Content-Type':'application/pdf','Content-Length':content.length,'Content-Disposition':`${url.searchParams.has('download')?'attachment':'inline'}; filename="folio-${doc.id}.pdf"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});return response.end(content);
        }
        const content=doc.text?await fs.readFile(doc.text,'utf8'):'';
        if(url.searchParams.get('download')==='1'){
          if(!doc.text)return json(response,404,{error:'Texte extrait indisponible.'});
          response.writeHead(200,{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename="folio-${doc.id}.md"`,'X-Content-Type-Options':'nosniff'});return response.end(content);
        }
        return json(response,200,{id:doc.id,name:doc.name,company:doc.company,hasPdf:Boolean(doc.pdf),hasText:Boolean(doc.text),content});
      }
      if(request.method==='POST'&&url.pathname==='/api/threads')return json(response,201,await store.createThread(await body(request)));
      const match=url.pathname.match(/^\/api\/threads\/([a-zA-Z0-9-]+)(?:\/(messages|memory|context)(?:\/([a-zA-Z0-9-]+))?)?$/);
      if(match){
        const [,id,action,itemId]=match;
        if(!action&&request.method==='GET')return json(response,200,store.getThread(id));
        if(!action&&request.method==='PATCH')return json(response,200,await store.updateThread(id,await body(request)));
        if(!action&&request.method==='DELETE')return json(response,200,await store.deleteThread(id));
        if(action==='messages'&&!itemId&&request.method==='POST')return json(response,201,await store.addMessage(id,(await body(request)).content));
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
  }catch(error){if(!response.headersSent)json(response,error.status||500,{error:error.status?error.message:'Une erreur est survenue côté serveur.'});else response.end();console.error(error.message);}
});
if(development){const {createServer:createViteServer}=await import('vite');vite=await createViteServer({root,configFile:path.join(root,'vite.config.js'),server:{middlewareMode:true,hmr:{server}},appType:'spa'});}
const port=Number(process.env.PORT||5173);
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Le port ${port} est déjà utilisé. Ouvrez http://127.0.0.1:${port} ou choisissez PORT.`:error.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`\n  Folio — http://127.0.0.1:${server.address().port}\n  Bibliothèque · Conversations · Résumés thématiques\n`));
let closing=false;
async function close(){if(closing)return;closing=true;await store.close();await vite?.close();server.close(()=>process.exit(0));server.closeIdleConnections();}
process.on('SIGINT',close);process.on('SIGTERM',close);
