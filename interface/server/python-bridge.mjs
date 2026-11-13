import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
const messages={MISSING_KEY:'La clé du modèle IA n’est pas configurée.',MODEL_AUTH:'La clé du modèle IA est refusée.',MODEL_QUOTA:'Le quota du modèle IA est atteint. Réessayez plus tard.',MODEL_UNAVAILABLE:'Le modèle IA est indisponible ou le réseau est inaccessible.',INVALID_OUTPUT:'La réponse du modèle ne respecte pas le contrat attendu.',NO_EVIDENCE:'Aucun passage suffisamment pertinent n’a été trouvé.',AGENT_FAILURE:'Le traitement des agents a échoué.',TIMEOUT:'Le délai maximal du traitement est atteint.',CANCELLED:'Le traitement a été arrêté.'};
messages.AI_DISABLED='Les appels au modèle sont désactivés pour cette session.';
export class BackendError extends Error{constructor(code){super(messages[code]||messages.AGENT_FAILURE);this.code=code;}}
export function runPython(config,job,{onEvent=()=>{},onRetrieve,onModel,signal}={}){
  if(!config.apiKey)return Promise.reject(new BackendError('MISSING_KEY'));
  return new Promise((resolve,reject)=>{
    const child=spawn(config.python,['-u','-m','scripts.folio_worker'],{cwd:config.projectRoot,env:{...process.env,GOOGLE_API_KEY:config.apiKey,FOLIO_GEMINI_MODEL:config.model,PYTHONIOENCODING:'utf-8',LANGCHAIN_TRACING_V2:'false',LANGSMITH_TRACING:'false',FOLIO_MODEL_BRIDGE:onModel?'1':'0'},stdio:['pipe','pipe','pipe'],windowsHide:true});
    let settled=false,result,bytes=0,toolChain=Promise.resolve();const lines=createInterface({input:child.stdout});
    const timer=setTimeout(()=>finish(new BackendError('TIMEOUT')),job.mode==='probe'?45000:config.timeoutMs);timer.unref?.();
    const abort=()=>finish(new BackendError('CANCELLED'));
    function finish(error){if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);lines.close();if(child.exitCode===null)child.kill();error?reject(error):resolve(result);}
    child.on('error',()=>finish(new BackendError('AGENT_FAILURE')));child.stdin.on('error',()=>{});child.stderr.on('data',()=>{});
    lines.on('line',line=>{bytes+=Buffer.byteLength(line);if(bytes>1_000_000)return finish(new BackendError('INVALID_OUTPUT'));let packet;try{packet=JSON.parse(line);}catch{return finish(new BackendError('INVALID_OUTPUT'));}
      if(packet.type==='event'){try{onEvent({agent:packet.agent,status:packet.status,tool:packet.tool||null});}catch{finish(new BackendError('INVALID_OUTPUT'));}}
      else if(packet.type==='retrieve'){toolChain=toolChain.then(async()=>{if(settled||!onRetrieve)throw new BackendError('INVALID_OUTPUT');const data=await onRetrieve(packet);if(!settled)child.stdin.write(JSON.stringify({id:packet.id,packet:data})+'\n');}).catch(error=>finish(error instanceof BackendError?error:new BackendError('AGENT_FAILURE')));}
      else if(packet.type==='model'){toolChain=toolChain.then(async()=>{if(settled||!onModel||typeof packet.id!=='string')throw new BackendError('INVALID_OUTPUT');const data=await onModel(packet);if(!settled)child.stdin.write(JSON.stringify({id:packet.id,result:data})+'\n');}).catch(error=>finish(error instanceof BackendError?error:new BackendError('AGENT_FAILURE')));}
      else if(packet.type==='result')result=packet.result;
      else if(packet.type==='error'){const error=new BackendError(packet.code);if(typeof packet.diagnostic==='string'&&/^[A-Za-z0-9_]{1,60}$/.test(packet.diagnostic))error.diagnostic=packet.diagnostic;finish(error);}
    });
    child.on('close',code=>{if(settled)return;if(code!==0||!result)return finish(new BackendError('AGENT_FAILURE'));finish();});
    if(signal?.aborted)return abort();signal?.addEventListener('abort',abort,{once:true});child.stdin.write(JSON.stringify(job)+'\n');
  });
}
