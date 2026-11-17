import {randomUUID,createHash} from 'node:crypto';
import {callGemini} from './gemini-provider.mjs';
import {callSimulated} from './simulated-provider.mjs';
import {runPython,BackendError,prewarmWorker,stopPrewarmedWorker} from './python-bridge.mjs';
import {authorizeToolCall,verifyEvidenceClaims,AGENT_ROLES} from './agent-policies.mjs';
import {screenUntrustedText} from './injection-screen.mjs';
import {createUsageLedger,costOf} from './run-metrics.mjs';
import {newEnvelopeKey,sealEnvelope,createEnvelopeVerifier,payloadHash} from './agent-envelopes.mjs';
const labels={planner:'Planification',researcher:'Recherche documentaire',verifier:'Vérification des références',writer:'Rédaction'};
// Rôles autorisés à appeler le modèle selon le parcours.
const modelRoles={chat:['researcher','verifier'],thematic:['planner','researcher','verifier','writer']};
// Chaîne de transferts attendue : le résultat final n'est accepté que s'il arrive par ce chemin signé.
const expectedChain={chat:['server>researcher','researcher>verifier','verifier>server'],thematic:['server>planner','planner>researcher','researcher>verifier','verifier>writer','writer>server']};
// Plafonds imposés par le serveur à chaque exécution ; le worker ne peut que les respecter.
export const RUN_POLICY={tool_budget:12,model_calls:6,delegation_depth:1,max_tokens:200000,max_cost_usd:0.25,deadline_ms:180000};
const cleanError=error=>({code:error instanceof BackendError?error.code:'AGENT_FAILURE',message:error instanceof BackendError?error.message:'Le traitement n’a pas pu être terminé.'});
const audited=(audit,action,fields)=>{try{audit?.append(action,fields);}catch{}};
// Identifiant pseudonyme pour les traces et l'audit : jamais l'adresse e-mail elle-même.
export const userReference=actor=>actor?.id?createHash('sha256').update('folio-user:'+actor.id).digest('hex').slice(0,16):'anonymous';
export async function createAIConnector({store,config,runner=runPython,modelRequest=config.simulated?callSimulated:callGemini,metrics=null,audit=null,policy=RUN_POLICY}){
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
    const kind=thread.kind==='thematic'?'thematic':'chat',startedAt=new Date(),userRef=userReference(actor);
    const ledger=createUsageLedger({model:config.model,simulated:Boolean(config.simulated),at:startedAt,priceOverride:config.priceOverride});
    const run={id:randomUUID(),threadId,messageId,kind:thread.kind,status:'running',startedAt:startedAt.toISOString(),finishedAt:null,tasks:AGENT_ROLES.map(role=>({agent:role.id,status:thread.kind==='chat'&&!['researcher','verifier'].includes(role.id)?'not_used':'pending'})),events:[],retrievals:[],handoffs:[],security:[],quarantined:{passages:0,memory:0},evidenceCount:0,verifiedClaimCount:0,usage:ledger.snapshot(),policy:{...policy},error:null};
    const controller=new AbortController();let writes=Promise.resolve();
    const base={actor:userRef,runId:run.id,threadId};
    function save(){const snapshot=JSON.parse(JSON.stringify(run));writes=writes.then(()=>store.setRun(threadId,snapshot));return writes;}
    function event({agent,status,tool=null}){if(!labels[agent]||!['running','completed'].includes(status))throw new BackendError('INVALID_OUTPUT');const now=new Date().toISOString(),task=run.tasks.find(task=>task.agent===agent);task.status=status;task.tool=tool;task[status==='running'?'startedAt':'finishedAt']=now;if(task.startedAt&&task.finishedAt)task.durationMs=Date.parse(task.finishedAt)-Date.parse(task.startedAt);run.events.push({agent,status,tool,at:now,label:labels[agent]});save().catch(()=>{});}
    function securityDecision({kind:what,agent=null,decision='blocked',reason='',count=null,signals=[]}){
      const entry={at:new Date().toISOString(),kind:String(what).slice(0,40),agent:labels[agent]?agent:null,decision:decision==='allowed'?'allowed':'blocked',reason:String(reason||'').replace(/[^A-Za-z0-9_.:-]/g,'').slice(0,60),count:Number.isInteger(count)?count:null,signals:(Array.isArray(signals)?signals:[]).filter(s=>typeof s==='string'&&/^[a-z_]{1,40}$/.test(s)).slice(0,6)};
      if(run.security.length<60)run.security.push(entry);
      audited(audit,'security',{...base,agent:entry.agent||undefined,decision:entry.decision,reason:(entry.kind+(entry.reason?':'+entry.reason:'')).slice(0,120),count:entry.count??undefined,signals:entry.signals});
      save().catch(()=>{});
    }
    const handle={run,controller,done:null};starting=true;try{await save();active.set(threadId,handle);}finally{starting=false;}
    audited(audit,'run_start',{...base,outcome:kind});
    handle.done=(async()=>{
      const evidence=new Map();let remainingCalls=policy.tool_budget,modelCalls=0;
      try{
        if(config.disabled)throw new BackendError('AI_DISABLED');
        if(!config.apiKey&&!config.simulated)throw new BackendError('MISSING_KEY');
        const context=store.context(threadId),memoryCount=context.memory.length;
        context.memory=context.memory.filter(note=>screenUntrustedText(note.text).disposition!=='quarantine');run.quarantined.memory=memoryCount-context.memory.length;
        if(run.quarantined.memory)securityDecision({kind:'memory_quarantine',reason:'instruction_in_memory',count:run.quarantined.memory});
        // Canal signé de l'exécution : la clé est tirée au hasard, transmise au worker par stdin, jamais au modèle.
        const key=newEnvelopeKey(),verifier=createEnvelopeVerifier(key,run.id),first=kind==='thematic'?'planner':'researcher';
        const opening=sealEnvelope(key,{runId:run.id,from:'server',to:first,seq:1,payload:{question:message.content}});
        verifier.verify(opening,{payload:{question:message.content}});
        const recordHandoff=envelope=>{run.handoffs.push({seq:envelope.seq,from:envelope.from_role,to:envelope.to_role,trust:envelope.trust_level,at:new Date(envelope.ts).toISOString(),payloadHash:envelope.payload_hash.slice(0,12),verified:true});audited(audit,'handoff',{...base,from:envelope.from_role,to:envelope.to_role,seq:envelope.seq,trust:envelope.trust_level});save().catch(()=>{});};
        recordHandoff(opening);
        const trace={runId:run.id,threadId,kind:thread.kind,userRef};
        const job={mode:kind,question:message.content,context,trace,policy:{...policy,runId:run.id,userRef},envelopeKey:key,envelope:opening};
        const result=await runner(config,job,{signal:controller.signal,onEvent:event,
          onHandoff:envelope=>{try{verifier.verify(envelope);}catch(error){securityDecision({kind:'handoff_rejected',reason:error.reason||'invalid'});throw new BackendError('INTEGRITY_VIOLATION');}recordHandoff(envelope);},
          onSecurity:packet=>securityDecision(packet),
          onModel:async(request,{reportUsage}={})=>{
            modelCalls++;if(modelCalls>policy.model_calls||request.operation!=='generate'){securityDecision({kind:'model_call',agent:request.agent,reason:'budget_or_operation'});throw new BackendError(modelCalls>policy.model_calls?'BUDGET_EXHAUSTED':'INVALID_OUTPUT');}
            const agent=request.agent;if(!modelRoles[kind].includes(agent)){securityDecision({kind:'model_call',agent,reason:'role_not_allowed'});throw new BackendError('INVALID_OUTPUT');}
            const result=await modelRequest(config,request,{signal:controller.signal,onUsage:(usage,ms)=>{
              ledger.record(agent,usage,ms);run.usage=ledger.snapshot();const cost=costOf(usage,run.usage.pricing);
              reportUsage?.({...usage,modelMs:Math.round(ms),costUsd:cost});
              audited(audit,'model_call',{...base,agent,decision:'allowed',durationMs:ms,inputTokens:usage.inputTokens||0,outputTokens:(usage.outputTokens||0)+(usage.thoughtTokens||0),costUsd:cost});
              save().catch(()=>{});
            }});
            const total=run.usage.total;
            if(total.inputTokens+total.outputTokens+total.thoughtTokens>policy.max_tokens||(total.costUsd??0)>policy.max_cost_usd){securityDecision({kind:'budget',agent,reason:'tokens_or_cost'});throw new BackendError('BUDGET_EXHAUSTED');}
            return result;
          },onRetrieve:async request=>{
            if(request.agent!=='researcher'||request.tool!=='retrieve_passages'||typeof request.id!=='string'||typeof request.query!=='string'){securityDecision({kind:'tool_call',agent:request.agent,reason:'tool_not_allowed'});throw new BackendError('INVALID_OUTPUT');}
            const documentIds=store.documentScope(threadId,actor);
            let allowed;
            try{allowed=authorizeToolCall({agent:'researcher',tool:'retrieve_passages',args:{documentIds,query:request.query}},{documentIds,remainingCalls});}
            catch(error){securityDecision({kind:'tool_call',agent:'researcher',reason:'denied'});throw new BackendError('TOOL_DENIED');}
            remainingCalls=allowed.remainingCalls;
            const startedRetrieval=performance.now();
            const packet=await store.prepareRag(threadId,request.query,{actor});if(controller.signal.aborted)throw new BackendError('CANCELLED');for(const p of packet.passages){if(evidence.size>=32&&!evidence.has(p.id))continue;evidence.set(p.id,p);}run.evidenceCount=evidence.size;
            const quarantined=packet.quarantined?.length||0;run.quarantined.passages+=quarantined;
            if(quarantined)securityDecision({kind:'passage_quarantine',agent:'researcher',reason:'instruction_in_document',count:quarantined,signals:[...new Set(packet.quarantined.flatMap(item=>item.signals||[]))]});
            // Vue « ce que l'agent consulte » : références et court extrait, jamais le passage complet.
            run.retrievals.push({agent:'researcher',tool:'retrieve_passages',at:new Date().toISOString(),durationMs:Math.round(performance.now()-startedRetrieval),query:request.query.slice(0,300),
              passages:packet.passages.map(p=>({id:p.id,documentId:p.documentId,name:p.name,page:p.page??null,year:p.year,excerpt:p.text.slice(0,280)})),quarantined});
            audited(audit,'tool_call',{...base,agent:'researcher',tool:'retrieve_passages',decision:'allowed',documents:[...new Set(packet.passages.map(p=>p.documentId))],count:packet.passages.length,durationMs:performance.now()-startedRetrieval});
            await save();return packet;
          }});
        if(controller.signal.aborted)throw new BackendError('CANCELLED');
        if(!Array.isArray(result.claims)||!result.claims.length||result.claims.length>24)throw new BackendError('NO_EVIDENCE');
        // Le résultat doit arriver par la chaîne signée attendue et correspondre au dernier transfert.
        const chain=verifier.accepted(),final=chain.at(-1);
        if(chain.map(e=>e.from_role+'>'+e.to_role).join(',')!==expectedChain[kind].join(',')||final.payload_hash!==payloadHash({claims:result.claims})){securityDecision({kind:'handoff_rejected',reason:'final_result_mismatch'});throw new BackendError('INTEGRITY_VIOLATION');}
        const claims=result.claims.map(claim=>({...claim,year:claim.sourceYear}));
        const checks=verifyEvidenceClaims(claims,[...evidence.values()]);
        const admitted=claims.filter((claim,index)=>checks[index].status==='evidence_linked'&&typeof claim.claim==='string'&&claim.claim.trim()&&claim.claim.length<=800&&claim.sourceYear===String(evidence.get(claim.evidenceId)?.year||''));
        if(admitted.length<claims.length)securityDecision({kind:'citation_check',agent:'verifier',reason:'claims_rejected',count:claims.length-admitted.length});
        if(!admitted.length)throw new BackendError('NO_EVIDENCE');
        const documentIds=store.documentScope(threadId,actor),evidenceIds=[...new Set(admitted.map(c=>c.evidenceId))];
        if(thread.kind==='thematic')authorizeToolCall({agent:'writer',tool:'compose_summary',args:{verifiedEvidenceIds:evidenceIds,theme:thread.theme}},{documentIds,evidenceIds,remainingCalls});
        const citations=[],numbers=new Map(),paragraphs=[];let axis='';
        for(const claim of admitted){const passage=evidence.get(claim.evidenceId);if(!numbers.has(passage.id)){numbers.set(passage.id,citations.length+1);citations.push({documentId:passage.documentId,title:passage.name,page:passage.page,quote:claim.quote,evidenceId:passage.id,verification:'exact_quote_and_source_match',truthVerified:false});}if(thread.kind==='thematic'&&claim.axis!==axis){axis=typeof claim.axis==='string'?claim.axis.slice(0,240):'';if(axis)paragraphs.push('### '+axis);}paragraphs.push(claim.claim.trim()+' ['+numbers.get(passage.id)+']');}
        const content=paragraphs.join('\n\n');await store.addAssistantMessage(threadId,{content,citations,runId:run.id,sourceMessageId:messageId,simulated:Boolean(config.simulated)});
        run.status='completed';run.verifiedClaimCount=admitted.length;provider={...provider,connected:true,state:'ready',error:null};
      }catch(error){run.status=controller.signal.aborted?'cancelled':'failed';run.error=cleanError(controller.signal.aborted?new BackendError('CANCELLED'):error);if(['MODEL_AUTH','MODEL_QUOTA','MODEL_UNAVAILABLE','MODEL_NOT_FOUND','MODEL_REQUEST'].includes(run.error.code))provider={...provider,connected:false,state:'unavailable',error:run.error};for(const task of run.tasks)if(task.status==='running')task.status=run.status;}
      finally{run.finishedAt=new Date().toISOString();run.durationMs=Date.parse(run.finishedAt)-Date.parse(run.startedAt);run.usage=ledger.snapshot();
        audited(audit,'run_end',{...base,outcome:run.status,reason:run.error?.code||undefined,durationMs:run.durationMs,costUsd:run.usage.total.costUsd??undefined});
        try{await save();await writes;await metrics?.append(run).catch(()=>{});}finally{active.delete(threadId);}}
    })();handle.done.catch(()=>{});return {...run};
  }
  async function cancel(threadId){const handle=active.get(threadId);if(handle){handle.controller.abort();await handle.done;}return latest(threadId);}
  async function close(){stopPrewarmedWorker();for(const handle of active.values())handle.controller.abort();await Promise.allSettled([...active.values()].map(handle=>handle.done));}
  // Prépare le worker de la prochaine analyse (imports anticipés), seulement avec le vrai exécuteur.
  function prewarm(){if(runner===runPython)prewarmWorker(config);}
  return {status,probe,start,latest,cancel,close,prewarm};
}
