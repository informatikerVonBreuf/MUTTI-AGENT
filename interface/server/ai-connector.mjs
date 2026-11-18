import {randomUUID,createHash} from 'node:crypto';
import {callGemini} from './gemini-provider.mjs';
import {callSimulated} from './simulated-provider.mjs';
import {runPython,BackendError,prewarmWorker,stopPrewarmedWorker} from './python-bridge.mjs';
import {authorizeToolCall,verifyEvidenceClaims,AGENT_ROLES} from './agent-policies.mjs';
import {screenUntrustedText} from './injection-screen.mjs';
import {createUsageLedger,costOf,RAG_STAGES} from './run-metrics.mjs';
import {newEnvelopeKey,sealEnvelope,createEnvelopeVerifier,payloadHash} from './agent-envelopes.mjs';
import {screenQuestion,inputRejection,makeCanary,guardClaims,redactPii,companiesIn} from './rag-guards.mjs';
const labels={planner:'Planification',researcher:'Recherche documentaire',verifier:'Vérification des références',writer:'Rédaction'};
const stageLabels={input_guard:'Filtre d’entrée',query:'Préparation de la requête',retrieval:'Recherche',passage_screen:'Contrôle des passages',generation:'Génération',output_guard:'Contrôle de sortie',correction:'Correction ou abstention',answer:'Réponse assemblée'};
// Étapes exécutées par le worker Python ; input_guard et answer restent au serveur.
const WORKER_STAGES=['query','retrieval','passage_screen','generation','output_guard','correction'];
const STAGE_STATUS=['running','completed','blocked','skipped','failed'];
// Rôles autorisés à appeler le modèle dans les résumés thématiques (seul parcours à agents).
const modelRoles=['planner','researcher','verifier','writer'];
// Chaîne de transferts attendue : le résumé n'est accepté que s'il arrive par ce chemin signé.
const expectedChain=['server>planner','planner>researcher','researcher>verifier','verifier>writer','writer>server'];
// Plafonds imposés par le serveur ; le worker ne peut que les respecter.
export const RUN_POLICY={tool_budget:12,model_calls:6,delegation_depth:1,max_tokens:200000,max_cost_usd:0.25,deadline_ms:180000};
// Chat RAG : une recherche, un appel modèle (deux avec la règle de correction), budget réduit.
// Échéance de 120 s : une première question posée pendant le préchauffage de l'index (≈ 30 s à froid) reste dans le délai.
export const CHAT_POLICY={model_calls:2,retrievals:1,max_tokens:60000,max_cost_usd:0.05,deadline_ms:120000};
const DATASET_TOOL={stock_info:'get_stock_info',income_stmt:'get_financial_statement'};
const cleanError=error=>({code:error instanceof BackendError?error.code:'AGENT_FAILURE',message:error instanceof BackendError?error.message:'Le traitement n’a pas pu être terminé.'});
const audited=(audit,action,fields)=>{try{audit?.append(action,fields);}catch{}};
// Détail d'une étape : entiers, codes courts ou listes de codes, rien d'autre (aucun contenu).
const cleanDetail=detail=>Object.fromEntries(Object.entries(detail&&typeof detail==='object'&&!Array.isArray(detail)?detail:{}).filter(([key])=>/^[a-z_]{1,30}$/.test(key)).slice(0,10).flatMap(([key,value])=>Number.isInteger(value)&&Math.abs(value)<1e9?[[key,value]]:typeof value==='string'&&/^[a-z_]{1,40}$/.test(value)?[[key,value]]:Array.isArray(value)?[[key,value.filter(item=>typeof item==='string'&&/^[a-z_]{1,40}$/.test(item)).slice(0,10)]]:[]));
// Identifiant pseudonyme pour les traces et l'audit : jamais l'adresse e-mail elle-même.
export const userReference=actor=>actor?.id?createHash('sha256').update('folio-user:'+actor.id).digest('hex').slice(0,16):'anonymous';
// `guards` et `mcp` ne se règlent que par code (tests, suite red team), jamais par une requête HTTP.
export async function createAIConnector({store,config,runner=runPython,modelRequest=config.simulated?callSimulated:callGemini,metrics=null,audit=null,policy=RUN_POLICY,chatPolicy=CHAT_POLICY,guards={},mcp=null}){
  const ready=config.apiKey||config.simulated,checks={input:guards.input!==false,passages:guards.passages!==false};
  let provider={connected:false,configured:Boolean(ready),state:ready?'checking':'missing_configuration',model:config.model,error:ready?null:{code:'MISSING_KEY',message:'La clé du modèle IA n’est pas configurée.'}};
  let vector={reachable:false,used:false},probePromise=null,lastProbe=0,starting=false;const active=new Map();
  await store.recoverRuns();
  function status(){return {...provider,...(config.disabled?{connected:false,state:'disabled',error:{code:'AI_DISABLED',message:'Les appels au modèle sont désactivés pour cette session.'}}:{}),provider:config.simulated?'simulated':'gemini',simulated:Boolean(config.simulated),citationsEnabled:provider.connected&&!config.disabled,retrieval:'local_corpus_bm25',automaticSources:true,chatEngine:'deterministic_rag',agentsEngine:'python_langgraph',mcp:mcp?mcp.status():{state:'disabled'},vector:{...vector},tracing:{enabled:Boolean(config.tracing?.enabled),requested:Boolean(config.tracing?.requested),project:config.tracing?.enabled?config.tracing.project:null,contentHidden:true}};}
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
    const common={id:randomUUID(),threadId,messageId,kind,status:'running',startedAt:startedAt.toISOString(),finishedAt:null,retrievals:[],security:[],quarantined:{passages:0,memory:0},evidenceCount:0,verifiedClaimCount:0,usage:ledger.snapshot(),error:null};
    const run=kind==='chat'
      ?{...common,pipeline:'deterministic_rag',stages:RAG_STAGES.map(stage=>({stage,label:stageLabels[stage],status:'pending',startedAt:null,finishedAt:null,durationMs:null,detail:{}})),rejectedClaims:[],attempts:0,policy:{...chatPolicy}}
      :{...common,tasks:AGENT_ROLES.map(role=>({agent:role.id,status:'pending'})),events:[],handoffs:[],toolCalls:[],policy:{...policy}};
    const controller=new AbortController();let writes=Promise.resolve();
    const base={actor:userRef,runId:run.id,threadId};
    function save(){const snapshot=JSON.parse(JSON.stringify(run));writes=writes.then(()=>store.setRun(threadId,snapshot));return writes;}
    function event({agent,status,tool=null}){if(kind!=='thematic'||!labels[agent]||!['running','completed'].includes(status))throw new BackendError('INVALID_OUTPUT');const now=new Date().toISOString(),task=run.tasks.find(task=>task.agent===agent);task.status=status;task.tool=tool;task[status==='running'?'startedAt':'finishedAt']=now;if(task.startedAt&&task.finishedAt)task.durationMs=Date.parse(task.finishedAt)-Date.parse(task.startedAt);run.events.push({agent,status,tool,at:now,label:labels[agent]});save().catch(()=>{});}
    function setStage(stage,status,detail){
      const entry=run.stages?.find(item=>item.stage===stage);if(!entry||!STAGE_STATUS.includes(status))throw new BackendError('INVALID_OUTPUT');
      const now=new Date().toISOString();if(status==='running'){entry.startedAt=now;}else{entry.startedAt||=now;entry.finishedAt=now;entry.durationMs=Date.parse(entry.finishedAt)-Date.parse(entry.startedAt);}
      entry.status=status;entry.detail={...entry.detail,...cleanDetail(detail)};save().catch(()=>{});
    }
    function securityDecision({kind:what,agent=null,stage=null,decision='blocked',reason='',count=null,signals=[]}){
      const entry={at:new Date().toISOString(),kind:String(what).slice(0,40),agent:labels[agent]?agent:null,stage:stageLabels[stage]?stage:null,decision:decision==='allowed'?'allowed':'blocked',reason:String(reason||'').replace(/[^A-Za-z0-9_.:+-]/g,'').slice(0,60),count:Number.isInteger(count)?count:null,signals:(Array.isArray(signals)?signals:[]).filter(s=>typeof s==='string'&&/^[a-z_]{1,40}$/.test(s)).slice(0,6)};
      if(run.security.length<60)run.security.push(entry);
      audited(audit,'security',{...base,agent:entry.agent||entry.stage||undefined,decision:entry.decision,reason:(entry.kind+(entry.reason?':'+entry.reason:'')).slice(0,120),count:entry.count??undefined,signals:entry.signals});
      save().catch(()=>{});
    }
    const handle={run,controller,done:null};starting=true;try{await save();active.set(threadId,handle);}finally{starting=false;}
    audited(audit,'run_start',{...base,outcome:kind});
    handle.done=(async()=>{
      const evidence=new Map();let remainingCalls=policy.tool_budget,modelCalls=0,retrievals=0;
      // Recherche commune aux deux parcours : périmètre, intégrité, passages consultés, audit.
      async function retrieve(request,owner){
        const documentIds=store.documentScope(threadId,actor);
        let allowed;
        try{allowed=authorizeToolCall({agent:'researcher',tool:'retrieve_passages',args:{documentIds,query:request.query}},{documentIds,remainingCalls});}
        catch{securityDecision({kind:'tool_call',...owner,reason:'denied'});throw new BackendError('TOOL_DENIED');}
        remainingCalls=allowed.remainingCalls;
        const startedRetrieval=performance.now();
        const packet=await store.prepareRag(threadId,request.query,{actor,guards:{passages:checks.passages}});if(controller.signal.aborted)throw new BackendError('CANCELLED');for(const p of packet.passages){if(evidence.size>=32&&!evidence.has(p.id))continue;evidence.set(p.id,p);}run.evidenceCount=evidence.size;
        const quarantined=packet.quarantined?.length||0;run.quarantined.passages+=quarantined;
        if(quarantined)securityDecision({kind:'passage_quarantine',...owner,reason:'instruction_in_document',count:quarantined,signals:[...new Set(packet.quarantined.flatMap(item=>item.signals||[]))]});
        const dropped=packet.integrity?.dropped?.length||0;if(dropped)securityDecision({kind:'corpus_integrity',...owner,reason:'altered',count:dropped});
        if(packet.quarantinedMemory?.length){run.quarantined.memory=Math.max(run.quarantined.memory,packet.quarantinedMemory.length);}
        // Vue « ce qui est consulté » : références et court extrait, jamais le passage complet.
        run.retrievals.push({...owner,tool:'retrieve_passages',at:new Date().toISOString(),durationMs:Math.round(performance.now()-startedRetrieval),query:request.query.slice(0,300),
          passages:packet.passages.map(p=>({id:p.id,documentId:p.documentId,name:p.name,page:p.page??null,year:p.year,excerpt:p.text.slice(0,280)})),quarantined});
        audited(audit,'tool_call',{...base,agent:owner.agent||owner.stage,tool:'retrieve_passages',decision:'allowed',documents:[...new Set(packet.passages.map(p=>p.documentId))],count:packet.passages.length,durationMs:performance.now()-startedRetrieval});
        await save();return packet;
      }
      async function callModel(request,{reportUsage}={},owner,limit){
        modelCalls++;if(modelCalls>limit.model_calls||request.operation!=='generate'){securityDecision({kind:'model_call',...owner,reason:'budget_or_operation'});throw new BackendError(modelCalls>limit.model_calls?'BUDGET_EXHAUSTED':'INVALID_OUTPUT');}
        const label=owner.agent||owner.stage;
        const result=await modelRequest(config,request,{signal:controller.signal,onUsage:(usage,ms)=>{
          ledger.record(label,usage,ms);run.usage=ledger.snapshot();const cost=costOf(usage,run.usage.pricing);
          reportUsage?.({...usage,modelMs:Math.round(ms),costUsd:cost});
          audited(audit,'model_call',{...base,agent:label,decision:'allowed',durationMs:ms,inputTokens:usage.inputTokens||0,outputTokens:(usage.outputTokens||0)+(usage.thoughtTokens||0),costUsd:cost});
          save().catch(()=>{});
        }});
        const total=run.usage.total;
        if(total.inputTokens+total.outputTokens+total.thoughtTokens>limit.max_tokens||(total.costUsd??0)>limit.max_cost_usd){securityDecision({kind:'budget',...owner,reason:'tokens_or_cost'});throw new BackendError('BUDGET_EXHAUSTED');}
        return result;
      }
      // Citations numérotées par passage ; une donnée de marché (MCP) est citée comme source externe, sans lien vers un PDF.
      function citationsFor(claims,{headings=false}={}){
        const citations=[],numbers=new Map(),paragraphs=[];let axis='';
        for(const claim of claims){
          const passage=evidence.get(claim.evidenceId);
          if(!numbers.has(passage.id)){numbers.set(passage.id,citations.length+1);citations.push(passage.source==='yahoo_finance_mcp'
            ?{source:'market',title:passage.name,ticker:passage.ticker,tool:passage.tool,retrievedAt:passage.retrievedAt,quote:claim.quote,evidenceId:passage.id,verification:'exact_quote_and_source_match',truthVerified:false}
            :{documentId:passage.documentId,title:passage.name,page:passage.page,quote:claim.quote,evidenceId:passage.id,verification:'exact_quote_and_source_match',truthVerified:false});}
          if(headings&&claim.axis!==axis){axis=typeof claim.axis==='string'?claim.axis.slice(0,240):'';if(axis)paragraphs.push('### '+axis);}
          paragraphs.push(claim.claim.trim()+' ['+numbers.get(passage.id)+']');
        }
        return {citations,content:paragraphs.join('\n\n')};
      }
      try{
        if(config.disabled)throw new BackendError('AI_DISABLED');
        if(!config.apiKey&&!config.simulated)throw new BackendError('MISSING_KEY');
        const context=store.context(threadId),memoryCount=context.memory.length;
        context.memory=context.memory.filter(note=>screenUntrustedText(note.text).disposition!=='quarantine');run.quarantined.memory=memoryCount-context.memory.length;
        if(run.quarantined.memory)securityDecision({kind:'memory_quarantine',stage:kind==='chat'?'passage_screen':null,reason:'instruction_in_memory',count:run.quarantined.memory});
        const trace={runId:run.id,threadId,kind:thread.kind,userRef};
        if(kind==='chat'){
          // 1. Filtre d'entrée : avant tout processus Python et tout appel modèle.
          setStage('input_guard','running');
          const previous=context.recentMessages.filter(item=>item.role==='user').map(item=>item.content);if(previous.at(-1)===message.content)previous.pop();
          const hasCompanyContext=Boolean(thread.documentIds?.length)||previous.some(text=>companiesIn(text).length>0);
          const screen=checks.input?screenQuestion(message.content,{recentUserMessages:previous,hasCompanyContext}):{decision:'allow',reasons:[],signals:[],...(({text,kinds})=>({redacted:text,pii:kinds}))(redactPii(message.content))};
          if(screen.decision==='block'){
            securityDecision({kind:'input_guard',stage:'input_guard',reason:screen.reasons.join('+'),signals:screen.signals});
            setStage('input_guard','blocked',{reasons:screen.reasons});
            const error=new BackendError('INPUT_REJECTED');error.message=inputRejection(screen.reasons);throw error;
          }
          if(screen.pii.length)securityDecision({kind:'input_guard',stage:'input_guard',decision:'allowed',reason:'pii_redacted',signals:screen.pii.map(item=>'pii_'+item)});
          setStage('input_guard','completed',{pii:screen.pii.length,...(checks.input?{}:{disabled:1})});
          // Les questions précédentes servent seulement à compléter une relance (recherche) ; celles que le filtre d'entrée refuse
          // en sont retirées, et les données personnelles des autres sont masquées. Les réponses ne sont jamais transmises.
          const recentMessages=context.recentMessages.filter(item=>item.role==='user'&&(!checks.input||screenQuestion(item.content,{hasCompanyContext:true}).decision==='allow')).map(item=>({...item,content:redactPii(item.content).text}));
          const dropped=context.recentMessages.filter(item=>item.role==='user').length-recentMessages.length;
          if(dropped)securityDecision({kind:'input_guard',stage:'query',reason:'previous_question_dropped',count:dropped});
          const canary=makeCanary();
          const memory=context.memory.map(note=>({...note,text:redactPii(note.text).text}));let systemPrompt='';
          const job={mode:'chat',question:screen.redacted,context:{memory,recentMessages},trace,canary,policy:{...chatPolicy,runId:run.id,userRef},guards:{passages:checks.passages}};
          const result=await runner(config,job,{signal:controller.signal,
            onEvent:()=>{throw new BackendError('INVALID_OUTPUT');},onHandoff:()=>{throw new BackendError('INVALID_OUTPUT');},onTool:async()=>{securityDecision({kind:'tool_call',stage:'retrieval',reason:'tool_not_allowed_in_chat'});throw new BackendError('INVALID_OUTPUT');},
            onStage:({stage,status,detail})=>{if(!WORKER_STAGES.includes(stage))throw new BackendError('INVALID_OUTPUT');setStage(stage,status,detail);},
            onSecurity:packet=>securityDecision({...packet,agent:null,stage:WORKER_STAGES.includes(packet.stage)?packet.stage:null}),
            onModel:async(request,options)=>{if(!['generation','correction'].includes(request.stage)){securityDecision({kind:'model_call',stage:'generation',reason:'stage_not_allowed'});throw new BackendError('INVALID_OUTPUT');}if(typeof request.system==='string')systemPrompt=request.system;return callModel(request,options,{stage:request.stage},chatPolicy);},
            onRetrieve:async request=>{retrievals++;if(request.stage!=='retrieval'||request.tool!=='retrieve_passages'||typeof request.id!=='string'||typeof request.query!=='string'||retrievals>chatPolicy.retrievals){securityDecision({kind:'tool_call',stage:'retrieval',reason:'retrieval_not_allowed'});throw new BackendError('INVALID_OUTPUT');}return retrieve(request,{stage:'retrieval'});}});
          if(controller.signal.aborted)throw new BackendError('CANCELLED');
          if(result?.engine!=='deterministic_rag'||!Array.isArray(result.claims))throw new BackendError('INVALID_OUTPUT');
          run.attempts=Number.isInteger(result.attempts)?result.attempts:1;
          run.rejectedClaims=(Array.isArray(result.rejected)?result.rejected:[]).slice(0,12).map(item=>({index:Number.isInteger(item?.index)?item.index:null,by:'worker',reasons:(Array.isArray(item?.reasons)?item.reasons:[]).filter(r=>typeof r==='string'&&/^[a-z_]{1,40}$/.test(r)).slice(0,6)}));
          // 8. Réponse assemblée par le serveur après un second contrôle indépendant (même règles, autre implémentation).
          setStage('answer','running');
          const guarded=guardClaims(result.claims,[...evidence.values()],{question:message.content,canary,max:6,system:systemPrompt});
          if(guarded.fatal){securityDecision({kind:'output_guard',stage:'answer',reason:guarded.fatal,signals:[guarded.fatal]});setStage('answer','blocked',{fatal:guarded.fatal});throw new BackendError('OUTPUT_REJECTED');}
          if(guarded.rejected.length){securityDecision({kind:'output_guard',stage:'answer',reason:'server_dropped',count:guarded.rejected.length,signals:[...new Set(guarded.rejected.flatMap(item=>item.reasons))]});run.rejectedClaims.push(...guarded.rejected.map(item=>({...item,by:'server'})));}
          if(!guarded.kept.length){setStage('answer','blocked',{kept:0});throw new BackendError('NO_EVIDENCE');}
          const {citations,content}=citationsFor(guarded.kept);
          await store.addAssistantMessage(threadId,{content,citations,runId:run.id,sourceMessageId:messageId,simulated:Boolean(config.simulated)});
          setStage('answer','completed',{claims:guarded.kept.length,citations:citations.length,server_dropped:guarded.rejected.length});
          run.verifiedClaimCount=guarded.kept.length;
        }else{
          // Résumés thématiques : agents LangGraph, transferts signés, données de marché par la passerelle MCP.
          const key=newEnvelopeKey(),verifier=createEnvelopeVerifier(key,run.id);
          const opening=sealEnvelope(key,{runId:run.id,from:'server',to:'planner',seq:1,payload:{question:message.content}});
          verifier.verify(opening,{payload:{question:message.content}});
          const recordHandoff=envelope=>{run.handoffs.push({seq:envelope.seq,from:envelope.from_role,to:envelope.to_role,trust:envelope.trust_level,at:new Date(envelope.ts).toISOString(),payloadHash:envelope.payload_hash.slice(0,12),verified:true});audited(audit,'handoff',{...base,from:envelope.from_role,to:envelope.to_role,handoffSeq:envelope.seq,trust:envelope.trust_level});save().catch(()=>{});};
          recordHandoff(opening);
          const job={mode:'thematic',question:message.content,context,trace,policy:{...policy,runId:run.id,userRef},envelopeKey:key,envelope:opening};
          const result=await runner(config,job,{signal:controller.signal,onEvent:event,
            onHandoff:envelope=>{try{verifier.verify(envelope);}catch(error){securityDecision({kind:'handoff_rejected',reason:error.reason||'invalid'});throw new BackendError('INTEGRITY_VIOLATION');}recordHandoff(envelope);},
            onSecurity:packet=>securityDecision({...packet,stage:null}),
            onModel:async(request,options)=>{if(!modelRoles.includes(request.agent)){securityDecision({kind:'model_call',agent:request.agent,reason:'role_not_allowed'});throw new BackendError('INVALID_OUTPUT');}return callModel(request,options,{agent:request.agent},policy);},
            onRetrieve:async request=>{if(request.agent!=='researcher'||request.tool!=='retrieve_passages'||typeof request.id!=='string'||typeof request.query!=='string'){securityDecision({kind:'tool_call',agent:request.agent,reason:'tool_not_allowed'});throw new BackendError('INVALID_OUTPUT');}return retrieve(request,{agent:'researcher'});},
            onTool:async request=>{
              const args=request.args&&typeof request.args==='object'&&!Array.isArray(request.args)?request.args:{};
              let allowed;
              try{if(request.agent!=='researcher'||request.tool!=='market_data')throw new Error();allowed=authorizeToolCall({agent:'researcher',tool:'market_data',args},{remainingCalls});}
              catch{securityDecision({kind:'tool_denied',agent:'researcher',reason:'market_data_outside_contract'});throw new BackendError('TOOL_DENIED');}
              remainingCalls=allowed.remainingCalls;
              const reply=mcp?await mcp.call({ticker:args.ticker,dataset:args.dataset}):{status:'unavailable',passages:[],quarantined:[],durationMs:0,cached:false,reason:'disabled'};
              if(controller.signal.aborted)throw new BackendError('CANCELLED');
              for(const p of reply.passages){if(evidence.size<40)evidence.set(p.id,p);}run.evidenceCount=evidence.size;
              if(reply.status==='quarantined')securityDecision({kind:'tool_output_quarantine',agent:'researcher',reason:'instruction_in_market_data',count:1,signals:reply.quarantined.flatMap(item=>item.signals||[])});
              if(reply.status==='denied')securityDecision({kind:'tool_denied',agent:'researcher',reason:'market_data_outside_allowlist'});
              run.toolCalls.push({agent:'researcher',tool:'market_data',mcpTool:DATASET_TOOL[args.dataset]||null,ticker:args.ticker,dataset:args.dataset,at:new Date().toISOString(),durationMs:reply.durationMs??null,status:reply.status,cached:Boolean(reply.cached),reason:reply.reason||null,
                passages:reply.passages.map(p=>({id:p.id,excerpt:p.text.slice(0,280)})),signals:reply.quarantined.flatMap(item=>item.signals||[]).slice(0,6)});
              audited(audit,'tool_call',{...base,agent:'researcher',tool:'market_data',decision:reply.status==='ok'?'allowed':'blocked',reason:reply.status,count:reply.passages.length,durationMs:reply.durationMs||0});
              await save();return {status:reply.status,passages:reply.passages,quarantined:reply.quarantined};
            }});
          if(controller.signal.aborted)throw new BackendError('CANCELLED');
          if(!Array.isArray(result.claims)||!result.claims.length||result.claims.length>24)throw new BackendError('NO_EVIDENCE');
          const chain=verifier.accepted(),final=chain.at(-1);
          if(chain.map(e=>e.from_role+'>'+e.to_role).join(',')!==expectedChain.join(',')||final.payload_hash!==payloadHash({claims:result.claims})){securityDecision({kind:'handoff_rejected',reason:'final_result_mismatch'});throw new BackendError('INTEGRITY_VIOLATION');}
          const claims=result.claims.map(claim=>({...claim,year:claim.sourceYear}));
          const linked=verifyEvidenceClaims(claims,[...evidence.values()]);
          let admitted=claims.filter((claim,index)=>linked[index].status==='evidence_linked'&&typeof claim.claim==='string'&&claim.claim.trim()&&claim.claim.length<=800&&claim.sourceYear===String(evidence.get(claim.evidenceId)?.year||''));
          if(admitted.length<claims.length)securityDecision({kind:'citation_check',agent:'verifier',reason:'claims_rejected',count:claims.length-admitted.length});
          // Filtre de sortie du serveur aussi sur les résumés : rejet entier si secret, balisage actif ou instruction ; liens et contacts retirés.
          const guarded=guardClaims(admitted.map(({year,...claim})=>claim),[...evidence.values()],{question:thread.theme||message.content,max:24,numbers:false,companies:false});
          if(guarded.fatal){securityDecision({kind:'output_guard',agent:'writer',reason:guarded.fatal,signals:[guarded.fatal]});throw new BackendError('OUTPUT_REJECTED');}
          if(guarded.rejected.length)securityDecision({kind:'output_guard',agent:'writer',reason:'claims_dropped',count:guarded.rejected.length,signals:[...new Set(guarded.rejected.flatMap(item=>item.reasons))]});
          admitted=guarded.kept;
          if(!admitted.length)throw new BackendError('NO_EVIDENCE');
          const documentIds=store.documentScope(threadId,actor),evidenceIds=[...new Set(admitted.map(c=>c.evidenceId))];
          authorizeToolCall({agent:'writer',tool:'compose_summary',args:{verifiedEvidenceIds:evidenceIds,theme:thread.theme}},{documentIds,evidenceIds,remainingCalls});
          const {citations,content}=citationsFor(admitted,{headings:true});
          await store.addAssistantMessage(threadId,{content,citations,runId:run.id,sourceMessageId:messageId,simulated:Boolean(config.simulated)});
          run.verifiedClaimCount=admitted.length;
        }
        run.status='completed';provider={...provider,connected:true,state:'ready',error:null};
      }catch(error){run.status=controller.signal.aborted?'cancelled':'failed';run.error=cleanError(controller.signal.aborted?new BackendError('CANCELLED'):error);if(['MODEL_AUTH','MODEL_QUOTA','MODEL_UNAVAILABLE','MODEL_NOT_FOUND','MODEL_REQUEST'].includes(run.error.code))provider={...provider,connected:false,state:'unavailable',error:run.error};
        for(const task of run.tasks||[])if(task.status==='running')task.status=run.status;
        for(const stage of run.stages||[]){if(stage.status==='running'){stage.status=run.status==='cancelled'?'skipped':'failed';stage.finishedAt=new Date().toISOString();stage.durationMs=Date.parse(stage.finishedAt)-Date.parse(stage.startedAt);}else if(stage.status==='pending')stage.status='skipped';}}
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
