// Garde-fous déterministes du chat RAG documentaire (aucun agent, aucun appel modèle) :
// filtre d'entrée sur la question, masquage des données personnelles, jeton témoin et contrôle de sortie des affirmations.
// Le worker Python applique les mêmes règles de sortie avec une implémentation distincte : deux contrôles indépendants.
import {randomBytes} from 'node:crypto';
import {normalizeUntrusted,ruleSignals,classifierScore,CLASSIFIER} from './injection-screen.mjs';
import {COMPANY_ALIASES} from './retrieval.mjs';
export {COMPANY_ALIASES};

const plain=text=>String(text).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
export function companiesIn(text){const words=new Set(plain(text).match(/[a-z0-9]+/g)||[]);return Object.entries(COMPANY_ALIASES).filter(([,names])=>names.some(name=>words.has(name))).map(([company])=>company);}

// Termes financiers (français et anglais) : une question sans entreprise ni terme financier est hors du périmètre du corpus.
const FINANCE=/\b(?:chiffres? d.affaires|revenus?|recettes|resultats?|benefices?|pertes?|marges?|ventes?|publicit\w*|tresorerie|dettes?|risques?|effectifs?|salaries|employes|dividendes?|rachats?|investissements?|depenses?|couts?|charges?|croissance|segments?|cloud|bilan|actifs?|passifs?|capitaux|flux|exploitation|operationnel\w*|annuel\w*|trimestr\w*|exercice|rapports?|10-[kq]|8-k|bpa|action(?:s|naires)?|capitalisation|valorisation|perspectives?|previsions?|strategie|concurren\w*|litiges?|reglementation|impots?|fiscal\w*|r&d|recherche et developpement|abonnements?|utilisateurs|clients|publicitaires|abonnes|revenue|sales|income|earnings|profit|loss|margin|cash|debt|liabilit\w*|assets?|equity|segments?|guidance|outlook|risks?|employees|headcount|dividends?|buybacks?|repurchases?|capex|capital expenditures?|expenses?|costs?|growth|eps|shares?|stock|operating|net|gross|fiscal|quarter\w*|annual|advertising|subscriptions?|users|customers|tax\w*|litigation|regulat\w*|competition|research|strategy|financial\w*|financier\w*|finances?|chiffres?|donnees|montants?)\b/;
export const FINANCE_TERMS=FINANCE;

const INPUT_REASONS={instruction_override:'prompt_injection',role_spoofing:'prompt_injection',hidden_instruction:'prompt_injection',memory_poisoning:'prompt_injection',tool_execution:'prompt_injection',statistical_classifier:'prompt_injection',
  process_override:'prompt_injection',fragmented_instruction:'fragmented_instruction',jailbreak:'jailbreak',system_prompt_extraction:'system_prompt_extraction',secret_exfiltration:'secret_request',secret_request:'secret_request',url_exfiltration:'exfiltration_request',exfiltration_request:'exfiltration_request',encoded_payload:'encoded_payload'};
export const INPUT_REASON_LABELS={prompt_injection:'injection d’instructions',jailbreak:'tentative de contournement (jailbreak)',system_prompt_extraction:'demande des consignes internes',secret_request:'demande de secret',exfiltration_request:'envoi vers une adresse externe',encoded_payload:'contenu encodé',fragmented_instruction:'instruction fragmentée sur plusieurs messages',out_of_scope:'hors du périmètre des rapports',too_long:'question trop longue'};
const QUESTION_LIMIT=4000;

// Données personnelles masquées avant tout envoi au modèle : courriel, téléphone, IBAN, carte (Luhn).
const luhn=digits=>{let sum=0;for(let i=0;i<digits.length;i++){let d=Number(digits[digits.length-1-i]);if(i%2){d*=2;if(d>9)d-=9;}sum+=d;}return sum%10===0;};
export function redactPii(text){
  const kinds=new Set();let value=String(text);
  value=value.replace(/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g,()=>{kinds.add('email');return '[courriel masqué]';});
  value=value.replace(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g,match=>{kinds.add('iban');return '[IBAN masqué]';});
  value=value.replace(/\b(?:\d[ -]?){12,18}\d\b/g,match=>{const digits=match.replace(/\D/g,'');if(digits.length<13||digits.length>19||!luhn(digits))return match;kinds.add('card');return '[carte masquée]';});
  value=value.replace(/(?:\+\d{1,3}[ .-]?\(?\d{1,4}\)?(?:[ .-]?\d{2,4}){2,4}|\b0[1-9](?:[ .-]?\d{2}){4}\b|\(\d{3}\)[ .-]?\d{3}[ .-]\d{4}\b|\b\d{3}[.-]\d{3}[.-]\d{4}\b)/g,()=>{kinds.add('phone');return '[téléphone masqué]';});
  return {text:value,kinds:[...kinds]};
}
const PHONE=/(?:\+\d{1,3}[ .-]?\(?\d{1,4}\)?(?:[ .-]?\d{2,4}){2,4}|\b0[1-9](?:[ .-]?\d{2}){4}\b|\(\d{3}\)[ .-]?\d{3}[ .-]\d{4}\b|\b\d{3}[.-]\d{3}[.-]\d{4}\b)/;
const EMAIL=/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/;

// Le classifieur a été entraîné sur des passages et des notes : sur une question très courte (« Et pour l’année précédente ? »)
// il confond le vocabulaire des relances avec celui des attaques. Il ne compte donc qu'à partir de 8 mots ; les règles, elles, s'appliquent toujours.
const CLASSIFIER_MIN_WORDS=8;
function inputReasons(text){
  const signals=ruleSignals(text),score=classifierScore(text),words=(normalizeUntrusted(text).match(/[\p{L}\p{N}]+/gu)||[]).length;
  if(score>=CLASSIFIER.threshold&&words>=CLASSIFIER_MIN_WORDS)signals.push('statistical_classifier');
  return {signals,score,reasons:[...new Set(signals.map(signal=>INPUT_REASONS[signal]).filter(Boolean))]};
}

// Filtre d'entrée : bloque avant tout appel modèle. `recentUserMessages` sert à repérer une instruction découpée en plusieurs messages.
export function screenQuestion(question,{recentUserMessages=[],hasCompanyContext=false}={}){
  const text=String(question??'');const pii=redactPii(text);
  if(text.length>QUESTION_LIMIT)return {decision:'block',reasons:['too_long'],signals:[],score:0,redacted:pii.text,pii:pii.kinds};
  const own=inputReasons(text);const reasons=[...own.reasons],signals=[...own.signals];
  if(!reasons.length){
    // Assemblage examiné par les règles seules : le classifieur, sur des relances bénignes mises bout à bout, crée des faux positifs.
    const previous=recentUserMessages.filter(item=>typeof item==='string'&&item.trim()).slice(-3);
    if(previous.length){
      const joined=ruleSignals([...previous,text].join('\n'));
      if(joined.length&&[...previous,text].every(item=>!ruleSignals(item).length)){reasons.push('fragmented_instruction');signals.push('fragmented_instruction',...joined);}
    }
  }
  if(!reasons.length&&!hasCompanyContext&&!companiesIn(text).length&&!FINANCE.test(plain(text)))reasons.push('out_of_scope');
  return {decision:reasons.length?'block':'allow',reasons,signals:[...new Set(signals)],score:Math.round(own.score*1000)/1000,redacted:pii.text,pii:pii.kinds};
}
export const inputRejection=reasons=>`Question refusée par le filtre d’entrée (${reasons.map(reason=>INPUT_REASON_LABELS[reason]||reason).join(', ')}). Posez une question sur les rapports de Meta, Google, Apple ou Amazon.`;

export const makeCanary=()=>'FOLIO-CANARY-'+randomBytes(8).toString('hex');

// Nombres d'une affirmation : groupes de milliers ramenés aux seuls chiffres. Un même nombre garde un seul séparateur
// (virgule, point ou espace) : « 574,785 637,959 » reste deux montants distincts.
const NUMBER=/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d{1,3}(?:[   ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g;
// Dates (« 31 décembre 2024 », « December 31, 2024 », « 2024-12-31 », « 31/12/2024 ») : le jour n'est pas un montant.
const MONTHS='(?:janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre|january|february|march|april|may|june|july|august|september|october|november|december)';
const DAY_BEFORE=new RegExp('\\b\\d{1,2}(?:er)?\\s+(?='+MONTHS+'\\b)','gi'),DAY_AFTER=new RegExp('\\b('+MONTHS+')\\s+\\d{1,2}(?:st|nd|rd|th)?\\b,?','gi');
const dateless=text=>String(text).normalize('NFKC').replace(DAY_BEFORE,' ').replace(DAY_AFTER,'$1').replace(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,' ').replace(/\b\d{1,2}-[kq]\b/gi,' ').replace(/\b(?:p|pp|page|pages)\.?\s*\d+(?:\s*[-–]\s*\d+)?/gi,' ');
// Montant lu comme valeur (et non comme suite de chiffres) avec son unité : « 3 910,35 » n'est pas « 391,035 »,
// « 391 035 milliards » n'est pas « 391,035 millions », « 9 % » doit figurer dans la citation.
const UNIT=/^\s*(%|pour ?cent|percent|millions?|milliards?|billions?|thousands?|milliers?|mds?|bn|mn|m|k)(?![a-z])/i;
const unitOf=after=>{const match=after.match(UNIT);if(!match)return null;const u=match[1].toLowerCase();return u==='%'||u.includes('cent')?'%':/^(?:milliard|billion|md|bn)/.test(u)?'B':/^(?:million|mn|m)/.test(u)?'M':'K';};
function amountValue(raw){
  if(/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(raw))return Number(raw.replace(/,/g,''));
  if(/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(raw))return Number(raw.replace(/\./g,'').replace(',','.'));
  if(/^\d{1,3}(?:[   ]\d{3})+(?:[.,]\d+)?$/.test(raw))return Number(raw.replace(/[   ]/g,'').replace(',','.'));
  return Number(raw.replace(',','.'));
}
export function amountsIn(text){
  const cleaned=dateless(text),out=[];
  for(const match of cleaned.matchAll(NUMBER)){const raw=match[0],end=match.index+raw.length,unit=unitOf(cleaned.slice(end,end+16));if(raw.replace(/\D/g,'').length<2&&!unit)continue;out.push({raw,value:amountValue(raw),unit,year:/^(?:19|20)\d{2}$/.test(raw)&&!unit});}
  return out;
}
const passageScale=text=>/\(in millions|in millions of|en millions|\bmillions of (?:u\.s\. )?dollars/i.test(text)?'M':/\(in billions|in billions of|en milliards/i.test(text)?'B':null;
// Montants d'une affirmation absents de la citation (valeur), ou d'une unité contraire à la citation ou à l'échelle du passage.
export function missingAmounts(claim,quote,{passageText='',year='',question=''}={}){
  const quoteAmounts=amountsIn(quote),questionYears=new Set(amountsIn(question).filter(a=>a.year).map(a=>a.raw)),scale=passageScale(passageText),missing=[];
  for(const amount of amountsIn(claim)){
    if(amount.year&&(amount.raw===String(year)||questionYears.has(amount.raw)||quoteAmounts.some(q=>q.raw===amount.raw)))continue;
    // Une année de la citation n'est pas un montant : « 2 024 millions » ne s'appuie pas sur « en 2024 ».
    const matches=quoteAmounts.filter(q=>Math.abs(q.value-amount.value)<1e-9&&(!q.year||amount.year));
    if(!matches.length){missing.push(amount.raw);continue;}
    const units=matches.map(q=>q.unit).filter(Boolean);
    if(amount.unit==='%'&&!units.includes('%'))missing.push(amount.raw+' %');
    else if(amount.unit==='B'||amount.unit==='M'){const reference=units.filter(u=>u!=='%').length?units:scale?[scale]:[];
      if((reference.length&&!reference.includes(amount.unit))||(amount.unit==='B'&&amount.value>=1000))missing.push(amount.raw+(amount.unit==='B'?' milliards':' millions'));}
  }
  return missing;
}
export function numbersIn(text){
  const cleaned=dateless(text).replace(/\b(?:p|pp|page|pages)\.?\s*\d+(?:\s*[-–]\s*\d+)?/gi,' ');
  return (cleaned.match(NUMBER)||[]).map(value=>value.replace(/\D/g,'')).filter(value=>value.length>1);
}
const collapse=text=>String(text).replace(/\s+/g,' ').trim();
export function quoteInPassage(quote,text){if(typeof quote!=='string'||typeof text!=='string')return false;return text.includes(quote)||collapse(text).includes(collapse(quote));}
const SECRET=/AIza[0-9A-Za-z_-]{20,}|\bsk-[A-Za-z0-9]{20,}|\blsv2_[A-Za-z0-9_]{20,}|\bghp_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const MARKUP=/!\[|<\s*script|<\s*img|<\s*iframe|javascript\s*:/i;
const canaryForms=canary=>{const value=String(canary||'');if(!value)return [];const tail=value.split('-').pop();return [value.toLowerCase(),value.toLowerCase().replace(/[^a-z0-9]/g,''),tail.length>=12?tail.toLowerCase():null].filter(Boolean);};
// Jeton témoin déguisé : ses caractères dans l'ordre, séparés par au plus trois signes qui n'en font pas partie (« 0z1z2… »).
const canaryPattern=canary=>{const tail=String(canary||'').split('-').pop().toLowerCase();return tail.length>=12?new RegExp(tail.split('').map(ch=>ch.replace(/[^a-z0-9]/g,'')).join('[^0-9a-f]{0,3}'),'i'):null;};
// Familles d'instructions qui rejettent toute la sortie ; les autres (mémoire, contrôles, fragments) retirent l'affirmation seule.
const STRONG_SIGNALS=new Set(['instruction_override','role_spoofing','system_prompt_extraction','secret_exfiltration','secret_request','exfiltration_request','tool_execution','url_exfiltration','jailbreak','hidden_instruction']);
// Nom de domaine sans « http » (« apple-investor-refund.com ») ; « Amazon.com » est le nom de la société.
const DOMAIN=/(?:\/\/|\b(?!amazon\.com\b)[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|fr|co|info|biz|ru|cn|xyz|app|dev|ly|me|tk|top|site|online|link|click|be|de|uk|us|ai|gg|to|cc)\b)/i;
// Autres grandes entreprises : citées seulement si la question, le passage ou la citation les nomme.
const OTHER_COMPANIES=['microsoft','nvidia','tesla','netflix','oracle','ibm','intel','samsung','alibaba','tencent','openai','twitter','uber','walmart','salesforce','adobe','spotify','tiktok','bytedance','sony','baidu','huawei','xiaomi'];
const mentionsIn=text=>{const words=new Set(plain(text).match(/[a-z0-9]+/g)||[]);return [...companiesIn(text),...OTHER_COMPANIES.filter(name=>words.has(name))];};
const REPAIRABLE=new Set(['quote_not_found','quote_too_short','number_mismatch','period_mismatch','unknown_evidence']);
// Suites de 6 mots normalisés des consignes réellement envoyées au modèle : une affirmation qui en reprend une les recopie.
const shingles=(text,size=6)=>{const words=normalizeUntrusted(text).match(/[a-z0-9]+/g)||[];const out=new Set();for(let i=0;i+size<=words.length;i++)out.add(words.slice(i,i+size).join(' '));return out;};
export const isRepairable=reasons=>reasons.length>0&&reasons.every(reason=>REPAIRABLE.has(reason));

// Contrôle de sortie : `fatal` rejette toute la sortie (fuite du jeton, secret, balisage actif, instruction, volume),
// les autres motifs retirent seulement l'affirmation concernée.
// `numbers` et `companies` : règles propres au chat RAG ; les résumés (agents) gardent leur vérificateur et les filtres de sécurité.
export function guardClaims(claims,passages,{question='',canary='',max=24,numbers=true,companies=true,system=''}={}){
  if(!Array.isArray(claims)||claims.some(claim=>!claim||typeof claim!=='object'||Array.isArray(claim)))return {fatal:'invalid_output',kept:[],rejected:[]};
  if(claims.length>max)return {fatal:'too_many_claims',kept:[],rejected:[]};
  const whole=JSON.stringify(claims);const flat=whole.toLowerCase(),squashed=flat.replace(/[^a-z0-9]/g,'');
  const disguised=canaryPattern(canary);
  if(canaryForms(canary).some(form=>flat.includes(form)||squashed.includes(form))||(disguised&&disguised.test(whole.normalize('NFKC'))))return {fatal:'canary_leak',kept:[],rejected:[]};
  if(SECRET.test(whole))return {fatal:'secret_pattern',kept:[],rejected:[]};
  const texts=claims.map(claim=>typeof claim.claim==='string'?claim.claim:'');
  if(system){const prompt=shingles(String(system).split('\n').filter(line=>!line.includes(canary||'\u0000')).join('\n'));if(texts.some(text=>[...shingles(text)].some(item=>prompt.has(item))))return {fatal:'prompt_echo',kept:[],rejected:[]};}
  if(texts.some(text=>MARKUP.test(text)))return {fatal:'unsafe_markup',kept:[],rejected:[]};
  // Règles déterministes : une instruction forte dans la sortie la rejette en entier ; une famille faible ou le classifieur seul ne retirent que l'affirmation.
  const signals=texts.map(text=>text?ruleSignals(text):[]);
  if(signals.some(list=>list.some(signal=>STRONG_SIGNALS.has(signal))))return {fatal:'instruction_in_output',kept:[],rejected:[]};
  const byId=new Map((passages||[]).map(passage=>[passage.id,passage])),questionCompanies=new Set(mentionsIn(question));
  const kept=[],rejected=[],seen=new Set();
  claims.forEach((claim,index)=>{
    const reasons=[];const fields=['claim','evidenceId','quote','sourceYear'];
    if(fields.some(field=>typeof claim[field]!=='string'||(field!=='sourceYear'&&!claim[field].trim())))reasons.push('invalid_shape');
    else{
      if(claim.claim.length>800||claim.quote.length>1800)reasons.push('too_long');
      const passage=byId.get(claim.evidenceId);
      if(!passage)reasons.push('unknown_evidence');
      if(claim.quote.trim().length<12)reasons.push('quote_too_short');
      else if(passage&&!quoteInPassage(claim.quote,passage.text))reasons.push('quote_not_found');
      if(passage&&String(claim.sourceYear)!==String(passage.year??''))reasons.push('period_mismatch');
      if(passage&&numbers&&missingAmounts(claim.claim,claim.quote,{passageText:passage.text,year:passage.year??'',question}).length)reasons.push('number_mismatch');
      if(passage&&companies){
        const allowed=new Set([...questionCompanies,...(passage.company?companiesIn(passage.company):companiesIn(passage.name||'')),...mentionsIn(claim.quote)]);
        if(mentionsIn(claim.claim).some(company=>!allowed.has(company)))reasons.push('company_drift');
      }
      if(/https?:\/\/|\bwww\./i.test(claim.claim)||DOMAIN.test(claim.claim))reasons.push('unsafe_url');
      if(EMAIL.test(claim.claim)||PHONE.test(claim.claim))reasons.push('unsafe_contact');
      if(classifierScore(claim.claim)>=CLASSIFIER.threshold||signals[index].length)reasons.push('suspicious_text');
      const key=claim.evidenceId+'|'+normalizeUntrusted(claim.claim);if(seen.has(key))reasons.push('duplicate_claim');seen.add(key);
    }
    if(reasons.length)rejected.push({index,reasons:[...new Set(reasons)]});else kept.push(claim);
  });
  return {fatal:null,kept,rejected};
}
