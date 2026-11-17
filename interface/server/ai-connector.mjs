import {randomUUID,createHash} from 'node:crypto';
import {callGemini} from './gemini-provider.mjs';
import {callSimulated} from './simulated-provider.mjs';
import {runPython,BackendError} from './python-bridge.mjs';
import {authorizeToolCall,verifyEvidenceClaims,AGENT_ROLES,inspectUntrustedText} from './agent-policies.mjs';
import {createUsageLedger,costOf} from './run-metrics.mjs';
const labels={planner:'Planification',researcher:'Recherche documentaire',verifier:'Vérification des références',writer:'Rédaction'};
// Rôles autorisés à appeler le modèle selon le parcours.
const modelRoles={chat:['researcher','verifier'],thematic:['planner','researcher','verifier','writer']};
const cleanError=error=>({code:error instanceof BackendError?error.code:'AGENT_FAILURE',message:error instanceof BackendError?error.message:'Le traitement n’a pas pu être terminé.'});
// Identifiant pseudonyme pour les traces : jamais l'adresse e-mail elle-même.
export const userReference=actor=>actor?.id?createHash('sha256').update('folio-user:'+actor.id).digest('hex').slice(0,16):'anonymous';
export async function createAIConnector({store,config,runner=runPython,modelRequest=config.simulated?callSimulated:callGemini,metrics=null}){
  const ready=config.apiKey||config.simulated;
  let provider={connected:false,configured:Boolean(ready),state:ready?'checking':'missing_configuration',model:config.model,error:ready?null:{code:'MISSING_KEY',message:'La clé du modèle IA n’est pas configurée.'}};
  let vector={reachable:false,used:false},probePromise=null,lastProbe=0,starting=false;const active=new Map();
  await store.recoverRuns();
  function status(){return {...provider,...(config.disabled?{connected:false,state:'disabled',error:{code:'AI_DISABLED',message:'Les appels au modèle sont désactivés pour cette session.'}}:{}),provider:config.simulated?'simulated':'gemini',simulated:Boolean(config.simulated),citationsEnabled:provider.connected&&!config.disabled,retrieval:'local_corpus_bm25',automaticSources:true,agentsEngine:'python_langgraph',vector:{...vector},tracing:{enabled:Boolean(config.tracing?.enabled),requested:Boolean(config.tracing?.requested),project:config.tracing?.enabled?config.tracing.project:null,contentHidden:true}};}
  async function probe(){
    if(probePromise)return probePromise;if(Date.now()-lastProbe<10000)return status();lastProbe=Date.now();provider={...provider,state:ready?'checking':'missing_configuration'};
    probePromise=(async()=>{try{const result=await runner(config,{mode:'probe'},{onModel:request=>modelRequest(config,request)});provider={...provider,connected:result.connected===true,state:result.connected?'ready':'unavailable',error:null};}catch(error){provider={...provider,connected:false,state:ready?'unavailable':'missing_configuration',error:cleanError(error)};}
      try{const parsed=new URL(config.qdrantUrl);if(!['http:','https:'].includes(parsed.protocol))throw new Error();const response=await fetch(new URL('/healthz',parsed),{signal:AbortSignal.timeout(2500)});vector={reachable:response.ok,used:false};}catch{vector={reachable:false,used:false};}return status();})();
    try{return await probePromise;}finally{probePromise=null;}
  }
  function latest(threadId){return store.getThread(threadId).lastRun||null;}
  async function start(threadId,{messageId}={},{actor=null}={}){
    const thread=store.getThread(threadId),message=thread.messages.find(message=>message.id===messageId&&message.role==='user');
    if(!message){const error=new Error('Message utilisateur introuvable.');error.status=404;throw error;}
    if(message.content.length>4000){const error=new Error('La question doit contenir au plus 4 000 caractères.');error.status=400;throw error;}
    if(thread.lastRun?.messageId===messageId&&['running','completed'].includes(thread.lastRun.status))return thread.lastRun;
    if(active.size||starting){const error=new Error('Une analyse est déjà en cours. Attendez sa fin ou arrêtez-la.');error.status=409;throw error;}
    const startedAt=new Date(),ledger=createUsageLedger({model:config.model,simulated:Boolean(config.simulated),at:startedAt,priceOverride:config.priceOverride});
    const run={id:randomUUID(),threadId,messageId,kind:thread.kind,status:'running',startedAt:startedAt.toISOString(),finishedAt:null,tasks:AGENT_ROLES.map(role=>({agent:role.id,status:thread.kind==='chat'&&!['researcher','verifier'].includes(role.id)?'not_used':'pending'})),events:[],retrievals:[],quarantined:{passages:0,memory:0},evidenceCount:0,verifiedClaimCount:0,usage:ledger.snapshot(),error:null};
    const controller=new AbortController();let writes=Promise.resolve();
    function save(){const snapshot=JSON.parse(JSON.stringify(run));writes=writes.then(()=>store.setRun(threadId,snapshot));return writes;}
    function event({agent,status,tool=null}){if(!labels[agent]||!['running','completed'].includes(status))throw new BackendError('INVALID_OUTPUT');const now=new Date().toISOString(),task=run.tasks.find(task=>task.agent===agent);task.status=status;task.tool=tool;task[status==='running'?'startedAt':'finishedAt']=now;if(task.startedAt&&task.finishedAt)task.durationMs=Date.parse(task.finishedAt)-Date.parse(task.startedAt);run.events.push({agent,status,tool,at:now,label:labels[agent]});save().catch(()=>{});}
    const handle={run,controller,done:null};starting=true;try{await save();active.set(threadId,handle);}finally{starting=false;}
    handle.done=(async()=>{
      const evidence=new Map();let remainingCalls=12,modelCalls=0;
      try{
        if(config.disabled)throw new BackendError('AI_DISABLED');
        if(!config.apiKey&&!config.simulated)throw new BackendError('MISSING_KEY');
        const context=store.context(threadId),memoryCount=context.memory.length;context.memory=context.memory.filter(note=>inspectUntrustedText(note.text).disposition!=='quarantine');run.quarantined.memory=memoryCount-context.memory.length;
        const trace={runId:run.id,threadId,kind:thread.kind,userRef:userReference(actor)};
        const result=await runner(config,{mode:thread.kind==='thematic'?'thematic':'chat',question:message.content,context,trace},{signal:controller.signal,onEvent:event,onModel:async(request,{reportUsage}={})=>{
          modelCalls++;if(modelCalls>6||request.operation!=='generate')throw new BackendError('INVALID_OUTPUT');
          const agent=request.agent;if(!modelRoles[thread.kind==='thematic'?'thematic':'chat'].includes(agent))throw new BackendError('INVALID_OUTPUT');
          return modelRequest(config,request,{signal:controller.signal,onUsage:(usage,ms)=>{ledger.record(agent,usage,ms);run.usage=ledger.snapshot();reportUsage?.({...usage,modelMs:Math.round(ms),costUsd:costOf(usage,run.usage.pricing)});save().catch(()=>{});}});
        },onRetrieve:async request=>{
          if(request.agent!=='researcher'||request.tool!=='retrieve_passages'||typeof request.id!=='string'||typeof request.query!=='string')throw new BackendError('INVALID_OUTPUT');
          const documentIds=store.documentScope(threadId);
          const allowed=authorizeToolCall({agent:'researcher',tool:'retrieve_passages',args:{documentIds,query:request.query}},{documentIds,remainingCalls});remainingCalls=allowed.remainingCalls;
          const startedRetrieval=performance.now();
          const packet=await store.prepareRag(threadId,request.query);if(controller.signal.aborted)throw new BackendError('CANCELLED');for(const p of packet.passages){if(evidence.size>=32&&!evidence.has(p.id))continue;evidence.set(p.id,p);}run.evidenceCount=evidence.size;
          run.quarantined.passages+=packet.quarantined?.length||0;
          // Vue « ce que l'agent consulte » : références et court extrait, jamais le passage complet.
          run.retrievals.push({agent:'researcher',tool:'retrieve_passages',at:new Date().toISOString(),durationMs:Math.round(performance.now()-startedRetrieval),query:request.query.slice(0,300),
            passages:packet.passages.map(p=>({id:p.id,documentId:p.documentId,name:p.name,page:p.page??null,year:p.year,excerpt:p.text.slice(0,280)})),quarantined:packet.quarantined?.length||0});
          await save();return packet;
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
        const content=paragraphs.join('\n\n');await store.addAssistantMessage(threadId,{content,citations,runId:run.id,sourceMessageId:messageId,simulated:Boolean(config.simulated)});
        run.status='completed';run.verifiedClaimCount=admitted.length;provider={...provider,connected:true,state:'ready',error:null};
      }catch(error){run.status=controller.signal.aborted?'cancelled':'failed';run.error=cleanError(controller.signal.aborted?new BackendError('CANCELLED'):error);if(['MODEL_AUTH','MODEL_QUOTA','MODEL_UNAVAILABLE','MODEL_NOT_FOUND','MODEL_REQUEST'].includes(run.error.code))provider={...provider,connected:false,state:'unavailable',error:run.error};for(const task of run.tasks)if(task.status==='running')task.status=run.status;}
      finally{run.finishedAt=new Date().toISOString();run.durationMs=Date.parse(run.finishedAt)-Date.parse(run.startedAt);run.usage=ledger.snapshot();try{await save();await writes;await metrics?.append(run).catch(()=>{});}finally{active.delete(threadId);}}
    })();handle.done.catch(()=>{});return {...run};
  }
  async function cancel(threadId){const handle=active.get(threadId);if(handle){handle.controller.abort();await handle.done;}return latest(threadId);}
  async function close(){for(const handle of active.values())handle.controller.abort();await Promise.allSettled([...active.values()].map(handle=>handle.done));}
  return {status,probe,start,latest,cancel,close};
}
