import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
const messages={MISSING_KEY:'La clé du modèle IA n’est pas configurée.',MODEL_AUTH:'La clé du modèle IA est refusée.',MODEL_QUOTA:'Le quota du modèle IA est atteint. Réessayez plus tard.',MODEL_UNAVAILABLE:'Le modèle IA est indisponible ou le réseau est inaccessible.',INVALID_OUTPUT:'La réponse du modèle ne respecte pas le contrat attendu.',NO_EVIDENCE:'Aucun passage suffisamment pertinent n’a été trouvé.',AGENT_FAILURE:'Le traitement des agents a échoué.',TIMEOUT:'Le délai maximal du traitement est atteint.',CANCELLED:'Le traitement a été arrêté.'};
messages.AI_DISABLED='Les appels au modèle sont désactivés pour cette session.';
messages.MODEL_NOT_FOUND='Le modèle IA configuré n’est pas accessible avec cette clé. Vérifiez le modèle choisi.';
messages.MODEL_REQUEST='Le service IA a refusé les paramètres de la requête.';
Object.assign(messages,{
  BUDGET_EXHAUSTED:'Le budget de cette analyse (appels, tokens, coût ou durée) est épuisé : elle a été arrêtée.',
  INTEGRITY_VIOLATION:'Un transfert entre agents n’a pas passé le contrôle d’intégrité : l’analyse a été arrêtée.',
  TOOL_DENIED:'Un agent a demandé un outil qui ne lui est pas autorisé : l’analyse a été arrêtée.',
  DELEGATION_DENIED:'Une délégation entre agents non autorisée a été refusée.',
  STATE_WRITE_DENIED:'Un agent a tenté d’écrire hors de son périmètre : l’analyse a été arrêtée.',
  OUTPUT_REJECTED:'La sortie du modèle contenait des éléments interdits (lien sortant ou instruction) : elle a été refusée.',
  POLICY_INVALID:'La politique de l’analyse est invalide.',
});
export class BackendError extends Error{constructor(code){super(messages[code]||messages.AGENT_FAILURE);this.code=code;}}

// Le worker ne reçoit que les variables nécessaires à Python, jamais tout l'environnement du serveur.
const INHERITED=['PATH','PATHEXT','SYSTEMROOT','SystemRoot','WINDIR','COMSPEC','TEMP','TMP','TMPDIR','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','PROGRAMDATA','LANG','LC_ALL','SSL_CERT_FILE','SSL_CERT_DIR','REQUESTS_CA_BUNDLE','PYTHONPATH','PYTHONHOME','VIRTUAL_ENV','PYTHONDONTWRITEBYTECODE','HTTPS_PROXY','HTTP_PROXY','NO_PROXY'];
export function workerEnvironment(config,{bridgeModel=false,source=process.env}={}){
  const env={};for(const name of INHERITED)if(typeof source[name]==='string')env[name]=source[name];
  Object.assign(env,{PYTHONIOENCODING:'utf-8',PYTHONUTF8:'1',FOLIO_GEMINI_MODEL:config.model||'',FOLIO_MODEL_BRIDGE:bridgeModel?'1':'0',LANGCHAIN_TRACING_V2:'false',LANGSMITH_TRACING:'false'});
  if(!bridgeModel&&config.apiKey)env.GOOGLE_API_KEY=config.apiKey;
  const tracing=config.tracing;
  if(tracing?.enabled&&tracing.apiKey){
    // Le SDK lit LANGCHAIN_TRACING_V2 avant LANGSMITH_TRACING : les deux doivent être cohérents.
    Object.assign(env,{LANGSMITH_TRACING:'true',LANGCHAIN_TRACING_V2:'true',LANGSMITH_API_KEY:tracing.apiKey,LANGSMITH_PROJECT:tracing.project||'folio-dev',LANGSMITH_HIDE_INPUTS:'true',LANGSMITH_HIDE_OUTPUTS:'true',FOLIO_TRACING:'on'});
    if(tracing.endpoint)env.LANGSMITH_ENDPOINT=tracing.endpoint;
  }
  return env;
}

// Worker de réserve : le prochain processus est lancé à l'avance et charge LangGraph et LangChain avant de
// recevoir son job. Chaque analyse garde son propre processus, utilisé une seule fois ; seul l'import est anticipé.
let spare=null;
const spawnWorker=(config,{bridgeModel,prewarm=false})=>spawn(config.python,['-u','-m','scripts.folio_worker'],{cwd:config.projectRoot,env:{...workerEnvironment(config,{bridgeModel}),...(prewarm?{FOLIO_PREWARM:'1'}:{})},stdio:['pipe','pipe','pipe'],windowsHide:true});
export function prewarmWorker(config){
  if(!config.prewarm||(!config.apiKey&&!config.simulated))return;
  if(spare&&spare.config===config&&spare.child.exitCode===null&&!spare.child.killed)return;
  const child=spawnWorker(config,{bridgeModel:true,prewarm:true});const entry={child,config};
  child.on('error',()=>{if(spare===entry)spare=null;});child.on('exit',()=>{if(spare===entry)spare=null;});child.stdin.on('error',()=>{});child.stderr.on('data',()=>{});
  spare=entry;
}
export function stopPrewarmedWorker(){if(spare&&spare.child.exitCode===null)spare.child.kill();spare=null;}
function takeWorker(config,{bridgeModel,mode}){
  if(bridgeModel&&mode!=='probe'&&spare&&spare.config===config&&spare.child.exitCode===null&&!spare.child.killed){const {child}=spare;spare=null;child.removeAllListeners('exit');child.removeAllListeners('error');setImmediate(()=>prewarmWorker(config));return child;}
  const child=spawnWorker(config,{bridgeModel});if(bridgeModel&&mode!=='probe')setImmediate(()=>prewarmWorker(config));return child;
}

export function runPython(config,job,{onEvent=()=>{},onRetrieve,onModel,onHandoff=()=>{},onSecurity=()=>{},signal}={}){
  if(!config.apiKey&&!config.simulated)return Promise.reject(new BackendError('MISSING_KEY'));
  return new Promise((resolve,reject)=>{
    const child=takeWorker(config,{bridgeModel:Boolean(onModel),mode:job.mode});
    let settled=false,result,bytes=0,toolChain=Promise.resolve();const lines=createInterface({input:child.stdout});
    const timer=setTimeout(()=>finish(new BackendError('TIMEOUT')),job.mode==='probe'?45000:config.timeoutMs);timer.unref?.();
    const abort=()=>finish(new BackendError('CANCELLED'));
    function finish(error){if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);lines.close();if(child.exitCode===null)child.kill();error?reject(error):resolve(result);}
    child.on('error',()=>finish(new BackendError('AGENT_FAILURE')));child.stdin.on('error',()=>{});child.stderr.on('data',()=>{});
    lines.on('line',line=>{bytes+=Buffer.byteLength(line);if(bytes>1_000_000)return finish(new BackendError('INVALID_OUTPUT'));let packet;try{packet=JSON.parse(line);}catch{return finish(new BackendError('INVALID_OUTPUT'));}
      if(packet.type==='event'){try{onEvent({agent:packet.agent,status:packet.status,tool:packet.tool||null});}catch{finish(new BackendError('INVALID_OUTPUT'));}}
      else if(packet.type==='handoff'){try{onHandoff(packet.envelope);}catch(error){finish(error instanceof BackendError?error:Object.assign(new BackendError('INTEGRITY_VIOLATION'),{reason:error.reason}));}}
      else if(packet.type==='security'){try{onSecurity(packet);}catch{}}
      else if(packet.type==='retrieve'){toolChain=toolChain.then(async()=>{if(settled||!onRetrieve)throw new BackendError('INVALID_OUTPUT');const data=await onRetrieve(packet);if(!settled)child.stdin.write(JSON.stringify({id:packet.id,packet:data})+'\n');}).catch(error=>finish(error instanceof BackendError?error:new BackendError('AGENT_FAILURE')));}
      else if(packet.type==='model'){toolChain=toolChain.then(async()=>{if(settled||!onModel||typeof packet.id!=='string')throw new BackendError('INVALID_OUTPUT');let usage=null;const data=await onModel(packet,{reportUsage:value=>{usage=value;}});if(!settled)child.stdin.write(JSON.stringify({id:packet.id,result:data,...(usage?{usage}:{})})+'\n');}).catch(error=>finish(error instanceof BackendError?error:new BackendError('AGENT_FAILURE')));}
      else if(packet.type==='result')result=packet.result;
      else if(packet.type==='error'){const error=new BackendError(packet.code);if(typeof packet.diagnostic==='string'&&/^[A-Za-z0-9_]{1,60}$/.test(packet.diagnostic))error.diagnostic=packet.diagnostic;finish(error);}
    });
    child.on('close',code=>{if(settled)return;if(code!==0||!result)return finish(new BackendError('AGENT_FAILURE'));finish();});
    if(signal?.aborted)return abort();signal?.addEventListener('abort',abort,{once:true});child.stdin.write(JSON.stringify(job)+'\n');
  });
}
