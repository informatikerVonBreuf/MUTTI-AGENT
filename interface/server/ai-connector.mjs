import {randomUUID} from 'node:crypto';
import {callGemini} from './gemini-provider.mjs';
import {runPython,BackendError} from './python-bridge.mjs';
import {authorizeToolCall,verifyEvidenceClaims,AGENT_ROLES,inspectUntrustedText} from './agent-policies.mjs';
const labels={planner:'Planification',researcher:'Recherche documentaire',verifier:'Vérification des références',writer:'Rédaction'};
const cleanError=error=>({code:error instanceof BackendError?error.code:'AGENT_FAILURE',message:error instanceof BackendError?error.message:'Le traitement n’a pas pu être terminé.'});
export async function createAIConnector({store,config,runner=runPython,modelRequest=callGemini}){
  let provider={connected:false,configured:Boolean(config.apiKey),state:config.apiKey?'checking':'missing_configuration',model:config.model,error:config.apiKey?null:{code:'MISSING_KEY',message:'La clé du modèle IA n’est pas configurée.'}};
  let vector={reachable:false,used:false},probePromise=null,lastProbe=0,starting=false;const active=new Map();
  await store.recoverRuns();
  function status(){return {...provider,...(config.disabled?{connected:false,state:'disabled',error:{code:'AI_DISABLED',message:'Les appels au modèle sont désactivés pour cette session.'}}:{}),citationsEnabled:provider.connected&&!config.disabled,retrieval:'local_corpus_bm25',automaticSources:true,agentsEngine:'python_langgraph',vector:{...vector}};}
  async function probe(){
    if(probePromise)return probePromise;if(Date.now()-lastProbe<10000)return status();lastProbe=Date.now();provider={...provider,state:config.apiKey?'checking':'missing_configuration'};
    probePromise=(async()=>{try{const result=await runner(config,{mode:'probe'},{onModel:request=>modelRequest(config,request)});provider={...provider,connected:result.connected===true,state:result.connected?'ready':'unavailable',error:null};}catch(error){provider={...provider,connected:false,state:config.apiKey?'unavailable':'missing_configuration',error:cleanError(error)};}
      try{const parsed=new URL(config.qdrantUrl);if(!['http:','https:'].includes(parsed.protocol))throw new Error();const response=await fetch(new URL('/healthz',parsed),{signal:AbortSignal.timeout(2500)});vector={reachable:response.ok,used:false};}catch{vector={reachable:false,used:false};}return status();})();
    try{return await probePromise;}finally{probePromise=null;}
  }
  function latest(threadId){return store.getThread(threadId).lastRun||null;}
  async function start(threadId,{messageId}={}){
    const thread=store.getThread(threadId),message=thread.messages.find(message=>message.id===messageId&&message.role==='user');
    if(!message){const error=new Error('Message utilisateur introuvable.');error.status=404;throw error;}
    if(message.content.length>4000){const error=new Error('La question doit contenir au plus 4 000 caractères.');error.status=400;throw error;}
    if(thread.lastRun?.messageId===messageId&&['running','completed'].includes(thread.lastRun.status))return thread.lastRun;
    if(active.size||starting){const error=new Error('Une analyse est déjà en cours. Attendez sa fin ou arrêtez-la.');error.status=409;throw error;}
    const run={id:randomUUID(),threadId,messageId,kind:thread.kind,status:'running',startedAt:new Date().toISOString(),finishedAt:null,tasks:AGENT_ROLES.map(role=>({agent:role.id,status:thread.kind==='chat'&&!['researcher','verifier'].includes(role.id)?'not_used':'pending'})),events:[],evidenceCount:0,verifiedClaimCount:0,error:null};
    const controller=new AbortController();let writes=Promise.resolve();
    function save(){const snapshot=JSON.parse(JSON.stringify(run));writes=writes.then(()=>store.setRun(threadId,snapshot));return writes;}
    function event({agent,status,tool=null}){if(!labels[agent]||!['running','completed'].includes(status))throw new BackendError('INVALID_OUTPUT');const now=new Date().toISOString(),task=run.tasks.find(task=>task.agent===agent);task.status=status;task.tool=tool;task[status==='running'?'startedAt':'finishedAt']=now;if(task.startedAt&&task.finishedAt)task.durationMs=Date.parse(task.finishedAt)-Date.parse(task.startedAt);run.events.push({agent,status,tool,at:now,label:labels[agent]});save().catch(()=>{});}
    const handle={run,controller,done:null};starting=true;try{await save();active.set(threadId,handle);}finally{starting=false;}
    handle.done=(async()=>{
      const evidence=new Map();let remainingCalls=12,modelCalls=0;
      try{
        if(config.disabled)throw new BackendError('AI_DISABLED');
        if(!config.apiKey)throw new BackendError('MISSING_KEY');
        const context=store.context(threadId);context.memory=context.memory.filter(note=>inspectUntrustedText(note.text).disposition!=='quarantine');
        const result=await runner(config,{mode:thread.kind==='thematic'?'thematic':'chat',question:message.content,context},{signal:controller.signal,onEvent:event,onModel:async request=>{modelCalls++;if(modelCalls>6||request.operation!=='generate')throw new BackendError('INVALID_OUTPUT');return modelRequest(config,request,{signal:controller.signal});},onRetrieve:async request=>{
          if(request.agent!=='researcher'||request.tool!=='retrieve_passages'||typeof request.id!=='string'||typeof request.query!=='string')throw new BackendError('INVALID_OUTPUT');
          const documentIds=store.documentScope(threadId);
          const allowed=authorizeToolCall({agent:'researcher',tool:'retrieve_passages',args:{documentIds,query:request.query}},{documentIds,remainingCalls});remainingCalls=allowed.remainingCalls;
          const packet=await store.prepareRag(threadId,request.query);if(controller.signal.aborted)throw new BackendError('CANCELLED');for(const p of packet.passages){if(evidence.size>=32&&!evidence.has(p.id))continue;evidence.set(p.id,p);}run.evidenceCount=evidence.size;await save();return packet;
        }});
        if(controller.signal.aborted)throw new BackendError('CANCELLED');
        if(!Array.isArray(result.claims)||!result.claims.length||result.claims.length>24)throw new BackendError('NO_EVIDENCE');
        const claims=result.claims.map(claim=>({...claim,year:claim.sourceYear}));
        const checks=verifyEvidenceClaims(claims,[...evidence.values()]);
        const admitted=claims.filter((claim,index)=>checks[index].status==='evidence_linked'&&typeof claim.claim==='string'&&claim.claim.trim()&&claim.claim.length<=800&&claim.sourceYear===String(evidence.get(claim.evidenceId)?.year||''));
        if(!admitted.length)throw new BackendError('NO_EVIDENCE');
        const documentIds=store.documentScope(threadId),evidenceIds=[...new Set(admitted.map(c=>c.evidenceId))];
        if(thread.kind==='thematic')authorizeToolCall({agent:'writer',tool:'compose_summary',args:{verifiedEvidenceIds:evidenceIds,theme:thread.theme}},{documentIds,evidenceIds,remainingCalls});
        const citations=[],numbers=new Map(),paragraphs=[];let axis='';
        for(const claim of admitted){const passage=evidence.get(claim.evidenceId);if(!numbers.has(passage.id)){numbers.set(passage.id,citations.length+1);citations.push({documentId:passage.documentId,title:passage.name,page:passage.page,quote:claim.quote,evidenceId:passage.id,verification:'exact_quote_and_source_match',truthVerified:false});}if(thread.kind==='thematic'&&claim.axis!==axis){axis=typeof claim.axis==='string'?claim.axis.slice(0,240):'';if(axis)paragraphs.push('### '+axis);}paragraphs.push(claim.claim.trim()+' ['+numbers.get(passage.id)+']');}
        const content=paragraphs.join('\n\n');await store.addAssistantMessage(threadId,{content,citations,runId:run.id,sourceMessageId:messageId});
        run.status='completed';run.verifiedClaimCount=admitted.length;provider={...provider,connected:true,state:'ready',error:null};
      }catch(error){run.status=controller.signal.aborted?'cancelled':'failed';run.error=cleanError(controller.signal.aborted?new BackendError('CANCELLED'):error);for(const task of run.tasks)if(task.status==='running')task.status=run.status;}
      finally{run.finishedAt=new Date().toISOString();try{await save();await writes;}finally{active.delete(threadId);}}
    })();handle.done.catch(()=>{});return {...run};
  }
  async function cancel(threadId){const handle=active.get(threadId);if(handle){handle.controller.abort();await handle.done;}return latest(threadId);}
  async function close(){for(const handle of active.values())handle.controller.abort();await Promise.allSettled([...active.values()].map(handle=>handle.done));}
  return {status,probe,start,latest,cancel,close};
}
