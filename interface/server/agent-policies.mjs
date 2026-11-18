import {ruleSignals} from './injection-screen.mjs';
export const AGENT_ROLES=[
  {id:'planner',name:'Planificateur',task:'Définir les axes du thème et répartir les questions.',tools:['delegate_task'],outputs:['plan'],canReadDocuments:false},
  {id:'researcher',name:'Chercheur documentaire',task:'Rechercher des passages dans les PDF autorisés, compléter par les données de marché (MCP Yahoo Finance) et conserver leur provenance.',tools:['retrieve_passages','market_data'],outputs:['evidence'],canReadDocuments:true},
  {id:'verifier',name:'Vérificateur',task:'Contrôler les références, les citations, les périodes et les points non établis.',tools:['inspect_evidence'],outputs:['verification'],canReadDocuments:true},
  {id:'writer',name:'Rédacteur',task:'Rédiger le résumé par thématique à partir des éléments admis, avec leurs limites.',tools:['compose_summary'],outputs:['summary'],canReadDocuments:false},
];
export const MARKET_TICKERS=['AMZN','AAPL','GOOGL','META'];
export const MARKET_DATASETS=['stock_info','income_stmt'];
export const RAG_POLICY={version:'folio-rag-v1',maxDocuments:8,maxPassages:8,maxPassageChars:1800,maxContextChars:12000,maxQuestionChars:4000,readOnly:true,externalNetwork:false,toolBudget:12,delegationDepth:1};
export function authorizeToolCall({agent,tool,args={}},{documentIds=[],evidenceIds=[],remainingCalls=RAG_POLICY.toolBudget,depth=0}={}){
  const role=AGENT_ROLES.find(role=>role.id===agent);
  if(!role||!role.tools.includes(tool))throw new Error('Outil interdit pour ce rôle.');
  if(!Number.isInteger(remainingCalls)||remainingCalls<=0)throw new Error('Budget d’outils épuisé.');
  if(depth>RAG_POLICY.delegationDepth)throw new Error('Profondeur de délégation dépassée.');
  if(!args||typeof args!=='object'||Array.isArray(args))throw new Error('Arguments invalides.');
  const keys={delegate_task:['target','task'],retrieve_passages:['documentIds','query'],market_data:['ticker','dataset'],inspect_evidence:['documentIds','evidenceIds'],compose_summary:['verifiedEvidenceIds','theme']}[tool];
  if(Object.keys(args).some(key=>!keys.includes(key)))throw new Error('Argument hors contrat.');
  if(tool==='delegate_task'&&(!['researcher','verifier','writer'].includes(args.target)||typeof args.task!=='string'||!args.task.trim()||args.task.length>1000))throw new Error('Délégation invalide.');
  // Données de marché : uniquement les tickers des entreprises du corpus et deux jeux de données en lecture seule.
  if(tool==='market_data'&&(!MARKET_TICKERS.includes(args.ticker)||!MARKET_DATASETS.includes(args.dataset)))throw new Error('Données de marché hors contrat.');
  if(role.canReadDocuments&&tool!=='market_data'&&(!Array.isArray(args.documentIds)||!args.documentIds.length||args.documentIds.some(id=>!documentIds.includes(id))))throw new Error('Document hors périmètre.');
  if(tool==='retrieve_passages'&&(typeof args.query!=='string'||!args.query.trim()||args.query.length>RAG_POLICY.maxQuestionChars))throw new Error('Question de recherche invalide.');
  if(tool==='inspect_evidence'&&(!Array.isArray(args.evidenceIds)||args.evidenceIds.some(id=>typeof id!=='string'||!evidenceIds.includes(id))))throw new Error('Références invalides.');
  if(tool==='compose_summary'&&(!Array.isArray(args.verifiedEvidenceIds)||args.verifiedEvidenceIds.some(id=>typeof id!=='string'||!evidenceIds.includes(id))||typeof args.theme!=='string'||args.theme.length>120))throw new Error('Synthèse hors contrat.');
  return {allowed:true,agent,tool,remainingCalls:remainingCalls-1};
}
export function buildAgentPlan(thread){return {
  version:'folio-agents-v1',status:thread.lastRun?.status||'prepared_not_executed',backendConnected:thread.lastRun?.status==='completed',theme:thread.theme||thread.title,
  tasks:AGENT_ROLES.map((role,index)=>({...role,order:index+1,status:thread.lastRun?.tasks?.find(task=>task.agent===role.id)?.status||'awaiting_backend',durationMs:thread.lastRun?.tasks?.find(task=>task.agent===role.id)?.durationMs,dependsOn:index?[AGENT_ROLES[index-1].id]:[]})),
  observability:{shown:['task','agent','status','tool','duration','evidence_ids','validation_outcome'],excluded:['private_reasoning','api_keys','raw_memory_in_logs']},
  policies:{...RAG_POLICY,automaticExecution:false},events:thread.lastRun?.events||[],runId:thread.lastRun?.id||null,error:thread.lastRun?.error||null,
};}
// Niveau 1 seul (règles déterministes après normalisation). Le filtrage complet, avec le classifieur
// statistique de second niveau, est screenUntrustedText dans injection-screen.mjs.
export function inspectUntrustedText(text){
  const signals=ruleSignals(text);
  return {disposition:signals.length?'quarantine':'eligible',signals,detector:'heuristic_rules',assurance:'not_a_complete_prompt_injection_defense'};
}
export function verifyEvidenceClaims(claims,passages){
  if(!Array.isArray(claims)||!Array.isArray(passages))throw new Error('Contrat de vérification invalide.');
  const evidence=new Map(passages.map(passage=>[passage.id,passage]));
  return claims.map(claim=>{
    const source=evidence.get(claim?.evidenceId),errors=[];
    if(!source)errors.push('unknown_evidence');
    if(typeof claim?.quote!=='string'||!claim.quote.trim()||!(typeof source?.text==='string'&&source.text.includes(claim.quote)))errors.push('quote_not_found');
    if(claim?.year&&source?.year&&String(claim.year)!==String(source.year))errors.push('period_mismatch');
    return {claim:typeof claim?.claim==='string'?claim.claim:'',evidenceId:claim?.evidenceId||null,status:errors.length?'rejected':'evidence_linked',errors,truthVerified:false,semanticVerification:'requires_backend_and_domain_checks'};
  });
}
