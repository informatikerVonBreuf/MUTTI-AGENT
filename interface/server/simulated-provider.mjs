// Fournisseur simulé pour les tests de charge et les démonstrations hors ligne.
// Activé seulement par FOLIO_PROVIDER=simulated ; l'interface l'affiche comme tel.
// Il n'appelle aucun service et ne prétend pas produire une analyse : chaque affirmation
// est un extrait littéral du passage, préfixé « [Simulé] ».
import {BackendError} from './python-bridge.mjs';

const wait=(ms,signal)=>new Promise((resolve,reject)=>{
  if(signal?.aborted)return reject(new BackendError('CANCELLED'));
  const timer=setTimeout(resolve,ms);
  signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(new BackendError('CANCELLED'));},{once:true});
});
const firstSentence=text=>{const match=String(text).match(/[^.!?\n]{20,220}[.!?]/);return match?match[0].trim():String(text).slice(0,160).trim();};
const tokens=value=>Math.ceil(JSON.stringify(value??'').length/4);

export async function callSimulated(config,request,{signal,onUsage}={}){
  const operation=request.operation||'generate';
  if(operation==='probe')return {connected:true,model:'simulated'};
  if(operation!=='generate'||!request.schema||typeof request.schema!=='object')throw new BackendError('INVALID_OUTPUT');
  const started=performance.now();
  await wait(Number.isFinite(config.simulatedDelayMs)?config.simulatedDelayMs:350,signal);
  const fields=request.schema.properties||{},payload=request.payload||{};
  let result;
  if(fields.axes){
    const question=String(payload.question||'Question'),words=new Set(question.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().match(/[a-z0-9]+/g)||[]);
    const tickers=Object.entries({AMZN:['amazon','amzn','aws'],AAPL:['apple','aapl'],GOOGL:['google','alphabet','googl','goog'],META:['meta','facebook']}).filter(([,names])=>names.some(name=>words.has(name))).map(([ticker])=>ticker);
    result={axes:[question.slice(0,200)],...(fields.marketTickers?{marketTickers:tickers}:{})};
  }
  else if(fields.approvedIndices)result={approvedIndices:(payload.claims||[]).map((_,index)=>index)};
  else if(fields.selectedIndices)result={selectedIndices:(payload.approvedClaims||[]).map((_,index)=>index)};
  else if(fields.claims){
    const passages=Array.isArray(payload.documentData)?payload.documentData.slice(0,2):[];
    // Chat RAG : documentData porte evidenceId ; résumés : id. Le schéma du chat demande aussi answerable.
    result={claims:passages.filter(p=>typeof p?.text==='string').map(p=>{const quote=firstSentence(p.text);return {claim:'[Simulé] Le passage indique : « '+quote.slice(0,300)+' »',evidenceId:p.evidenceId||p.id,quote,sourceYear:String(p.year||'')};})};
    if(fields.answerable)result={answerable:result.claims.length>0,...result};
  }else throw new BackendError('INVALID_OUTPUT');
  try{onUsage?.({inputTokens:tokens(payload)+tokens(request.system),outputTokens:tokens(result),thoughtTokens:0,cachedTokens:0},performance.now()-started);}catch{}
  return result;
}
