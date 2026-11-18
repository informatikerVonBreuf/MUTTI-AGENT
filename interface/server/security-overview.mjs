// Page Sécurité : architecture du RAG documentaire par couche, avec des compteurs réels, résultats de la suite
// d'attaques (rapports écrits par scripts/redteam.mjs) et bac à sable déterministe (aucun appel au modèle).
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {screenQuestion,guardClaims} from './rag-guards.mjs';
import {screenUntrustedText,CLASSIFIER} from './injection-screen.mjs';
import {RAG_POLICY} from './agent-policies.mjs';

export const LAYERS=[
  {id:'corpus',stage:null,label:'Corpus vérifié',defends:['corpus_poisoning','document_tampering'],how:'Manifeste SHA-256 des rapports, doublons exclus, filtre d’ingestion avant indexation, contrôle d’empreinte à l’exécution.'},
  {id:'input_guard',stage:'input_guard',label:'Filtre d’entrée',defends:['prompt_injection','jailbreak','system_prompt_extraction','secret_request','exfiltration_request'],how:'Normalisation (invisibles, homoglyphes, encodages), règles en 8 langues, classifieur local, instruction fragmentée, hors périmètre, données personnelles masquées.'},
  {id:'retrieval',stage:'retrieval',label:'Recherche bornée',defends:['data_leakage','context_flooding'],how:`Index BM25 local, droits par entreprise avant la recherche, ${RAG_POLICY.maxPassages} passages et ${RAG_POLICY.maxContextChars} caractères au plus.`},
  {id:'passage_screen',stage:'passage_screen',label:'Contrôle des passages',defends:['indirect_injection','memory_poisoning'],how:'Second filtre serveur et filtre Python indépendant sur chaque passage ; notes de mémoire examinées seules et ensemble ; abstention sans appel si rien ne reste.'},
  {id:'generation',stage:'generation',label:'Génération encadrée',defends:['prompt_injection','instruction_data_confusion'],how:'Consignes fixes séparées des données, jeton témoin par question, schéma JSON strict, historique jamais transmis, un seul appel.'},
  {id:'output_guard',stage:'output_guard',label:'Contrôle de sortie',defends:['hallucination','drift','exfiltration','secret_leak','system_prompt_leak'],how:'Citation mot pour mot, année du passage, montants recopiés, entreprise de la question, ni lien, ni contact, ni secret, ni balisage actif, ni instruction.'},
  {id:'correction',stage:'correction',label:'Correction déterministe',defends:['hallucination','drift'],how:'Affirmations fautives retirées une à une ; une seule nouvelle demande si toutes sont réparables ; sinon abstention explicite.'},
  {id:'answer',stage:'answer',label:'Réponse assemblée',defends:['output_tampering','canary_leak'],how:'Second contrôle de sortie par le serveur (implémentation distincte), réponse et citations construites par le code, journal d’audit chaîné.'},
];

// Rapports de la suite d'attaques relus quand leur date de modification change.
const cache=new Map();
async function report(file){
  try{const stat=await fs.stat(file);const hit=cache.get(file);if(hit&&hit.mtimeMs===stat.mtimeMs)return hit.data;const data=JSON.parse(await fs.readFile(file,'utf8'));cache.set(file,{mtimeMs:stat.mtimeMs,data});return data;}
  catch{return null;}
}
const trimRows=data=>data&&{...data,rows:(data.rows||[]).slice(0,600).map(({id,category,label,blocked,layer,score,target})=>({id,category,label,blocked,layer,score,target}))};

export async function securityOverview({projectRoot,store,metricsReport,audit,mcp}){
  const corpus=await store.corpusReport(),runs=metricsReport().runs,stages=runs.stages||{};
  const results=path.join(projectRoot,'scripts/redteam/results');
  const [offline,live]=await Promise.all([report(path.join(results,'report.json')),report(path.join(results,'report-live.json'))]);
  const counters={
    corpus:{documents:corpus.documents,verified:corpus.summary.verified,excluded:corpus.excluded.length,quarantinedChunks:corpus.ingestion.quarantined,reviewedFalsePositives:corpus.reviewedFalsePositives},
  };
  for(const layer of LAYERS)if(layer.stage)counters[layer.id]={completed:stages[layer.stage]?.duration?.count??0,blocked:stages[layer.stage]?.blocked??0};
  const recent=(audit?.recent?.(400)||[]).filter(entry=>entry.action==='security').slice(0,30).map(({seq,at,decision,reason,count,signals,agent})=>({seq,at,decision,reason,count,signals,agent}));
  return {generatedAt:new Date().toISOString(),layers:LAYERS.map(layer=>({...layer,counters:counters[layer.id]||{}})),corpus,classifier:CLASSIFIER,mcp:mcp?mcp.status():{state:'disabled'},
    chatRuns:runs.byKind?.chat||null,redteam:{offline:trimRows(offline),live:trimRows(live)},recent};
}

// Bac à sable : même code que la production, sans appel au modèle ni écriture.
export function sandbox({mode,text,passage}){
  if(mode==='question'){const result=screenQuestion(text);return {mode,decision:result.decision==='block'?'blocked':'allowed',layer:'input_guard',reasons:result.reasons,signals:result.signals,score:result.score,pii:result.pii};}
  if(mode==='passage'){const result=screenUntrustedText(text);return {mode,decision:result.disposition==='quarantine'?'blocked':'allowed',layer:'passage_screen',reasons:result.signals.length?['indirect_injection']:[],signals:result.signals,score:result.score,pii:[]};}
  // Réponse du modèle : sans passage, seuls les filtres de sécurité s'appliquent ; avec un passage, aussi les citations et les montants.
  const source=passage&&passage.trim()?passage:text;
  const result=guardClaims([{claim:text,evidenceId:'sandbox',quote:source.slice(0,1800),sourceYear:''}],[{id:'sandbox',text:source,year:''}],{canary:'FOLIO-CANARY-5a4db0c5a4db0c00',max:6,companies:Boolean(passage)});
  const reasons=result.fatal?[result.fatal]:result.rejected.flatMap(item=>item.reasons);
  return {mode,decision:reasons.length?'blocked':'allowed',layer:result.fatal?'output_guard_fatal':'output_guard',reasons,signals:[],score:null,pii:[],fatal:Boolean(result.fatal)};
}
