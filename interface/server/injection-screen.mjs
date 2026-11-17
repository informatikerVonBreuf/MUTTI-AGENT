// Détection d'instructions dans les données non fiables (passages, notes de mémoire, sorties d'outils).
// Niveau 1 : règles déterministes après normalisation (invisibles, homoglyphes, leet, base64/hex/URL décodés).
// Niveau 2 : classifieur statistique local (régression logistique sur mots et n-grammes, fenêtres glissantes),
// entraîné sur injection-training.json, jeu distinct de la suite red team. Aucun appel externe.
// Ce filtre réduit le risque ; il ne garantit pas l'immunité contre un attaquant adaptatif.
import {readFileSync} from 'node:fs';

const INVISIBLE=/[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]|\uDB40[\uDC00-\uDC7F]/g;
const CONFUSABLES={'а':'a','е':'e','о':'o','р':'p','с':'c','у':'y','х':'x','і':'i','ј':'j','ѕ':'s','ԁ':'d','ɡ':'g','ν':'v','ο':'o','α':'a','ε':'e','ι':'i','κ':'k','τ':'t','υ':'u','ρ':'p','В':'b','Н':'h','К':'k','М':'m','Т':'t'};
const LEET={'0':'o','1':'i','3':'e','4':'a','5':'s','7':'t','@':'a','$':'s','!':'i','|':'l'};

export function normalizeUntrusted(text){
  return String(text).normalize('NFKC').replace(INVISIBLE,'').replace(/./gu,ch=>CONFUSABLES[ch]||ch)
    .normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\s+/g,' ');
}
const deleet=text=>text.replace(/[013457@$!|]/g,ch=>LEET[ch]).replace(/(?<=\w)[._*-](?=\w)/g,'');

// Segments encodés : base64, hexadécimal, %xx et \uXXXX, décodés seulement s'ils donnent du texte lisible.
export function decodedSegments(text){
  const out=[];const printable=value=>value.length>=8&&/^[\x20-\x7E -ɏ\s]+$/.test(value)&&/[a-z]{3}/i.test(value);
  for(const token of String(text).match(/[A-Za-z0-9+/_-]{20,}={0,2}/g)||[]){try{const value=Buffer.from(token.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8');if(printable(value))out.push(value);}catch{}}
  for(const token of String(text).match(/(?:[0-9a-f]{2}){12,}/gi)||[]){const value=Buffer.from(token,'hex').toString('utf8');if(printable(value))out.push(value);}
  if(/%[0-9a-f]{2}/i.test(text)){try{const value=decodeURIComponent(String(text).replace(/\+/g,' '));if(value!==text)out.push(value);}catch{}}
  if(/\\u[0-9a-f]{4}/i.test(text)){const value=String(text).replace(/\\u([0-9a-f]{4})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16)));if(value!==text)out.push(value);}
  return out;
}

const RULES=[
  ['instruction_override',/(?:ignore|disregard|forget|override|bypass|oublie|ignore[rz]?|ignorez|ne tiens pas compte|ignora|olvida|ignoriere|vergiss|ignorar|esquece)\b.{0,80}\b(?:previous|prior|above|earlier|system|developer|instructions?|rules?|guidelines?|consignes?|instructions? precedentes?|regles?|instrucciones|anweisungen|regeln|istruzioni|instrucoes)/s],
  ['instruction_override',/(?:new|updated|nouvelles?|nuevas?|neue)\s+(?:system\s+)?(?:instructions?|consignes?|instrucciones|anweisungen)\s*[:：]/],
  ['role_spoofing',/<\/?(?:system|developer|assistant|tool)>|\[\/?(?:inst|system)\]|<\|im_(?:start|end)\|>|(?:^|\s)(?:system|developer)\s*(?:prompt|message)?\s*[:：]\s*(?:you|tu|vous|du)\b|\byou are now\b|\btu es (?:desormais|maintenant)\b|\bvous etes (?:desormais|maintenant)\b|\bact as (?:an?|the) (?:admin|developer|system)/],
  ['secret_exfiltration',/(?:send|upload|transmit|post|leak|share|email|envoie|envoyer|transmets|divulgue|revele|reveal|print|affiche|show|montre|exfiltrat)\w*.{0,100}(?:api.?key|secret|token|password|mot de passe|cle(?: d.acces| api)|credential|identifiant|cookie|system prompt|prompt systeme|\.env)/s],
  ['tool_execution',/(?:run|execute|exec|lance|lancer|executer?|call|appelle|invoke)\w*.{0,60}(?:subprocess|powershell|bash|shell|terminal|cmd\.exe|curl\s|wget\s|os\.system|eval\(|rm -rf|delegate_task|retrieve_passages|compose_summary)/s],
  ['url_exfiltration',/!\[[^\]]{0,80}\]\(\s*https?:\/\/|https?:\/\/[^\s)]+[?&][a-z_]{1,20}=\{|(?:visit|ouvre|open|charge|load|fetch|navigate to|rends-toi sur)\s+https?:\/\//],
  ['memory_poisoning',/(?:remember|retiens|souviens-toi|memorise|from now on|a partir de maintenant|desormais|always|toujours)\b.{0,60}\b(?:answer|reponds|repondre|say|dire|recommend|recommander?|tell|dis)\b.{0,30}\b(?:that|que|qu|buy|achat|acheter|sell|vendre)\b/s],
  ['hidden_instruction',/<!--[^>]{0,400}(?:instruction|ignore|assistant|system|prompt|reponds|answer)[^>]{0,400}-->|display\s*:\s*none|font-size\s*:\s*0|color\s*:\s*(?:#fff(?:fff)?|white)\b.{0,40}(?:instruction|ignore|assistant)/s],
];

export function ruleSignals(text){
  const base=normalizeUntrusted(text),variants=[base,deleet(base),...decodedSegments(text).map(normalizeUntrusted)];
  const signals=new Set();
  for(const variant of variants)for(const [id,pattern] of RULES)if(pattern.test(variant))signals.add(id);
  if(variants.length>2&&signals.size)signals.add('encoded_payload');
  if(/[​-‏⁠-⁯﻿]|\uDB40[\uDC00-\uDC7F]/.test(String(text))&&signals.size)signals.add('invisible_characters');
  return [...signals];
}

// Régression logistique L2 sur caractéristiques hachées : mots, paires de mots et 4-grammes de caractères,
// vecteur normalisé, classes pondérées. Entraînement déterministe au chargement (moins d'une seconde).
const DIM=1<<18;
function hash(value){let h=2166136261;for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0)%DIM;}
function features(text){
  const value=normalizeUntrusted(text),words=value.match(/[a-z0-9]+/g)||[],map=new Map();const add=key=>{const index=hash(key);map.set(index,(map.get(index)||0)+1);};
  for(const word of words)add('w:'+word);for(let i=0;i+1<words.length;i++)add('b:'+words[i]+'_'+words[i+1]);
  const padded=' '+value+' ';for(let i=0;i+4<=padded.length;i++)add('c:'+padded.slice(i,i+4));
  let norm=0;for(const v of map.values())norm+=v*v;norm=Math.sqrt(norm)||1;for(const [k,v] of map)map.set(k,v/norm);return map;
}
export function trainClassifier(examples,{epochs=60,rate=0.5,l2=1e-4}={}){
  const weights=new Float64Array(DIM);let bias=0;const rows=examples.map(e=>[features(e.text),e.label==='attack'?1:0]);
  const positives=rows.filter(row=>row[1]).length,wp=rows.length/(2*positives),wn=rows.length/(2*(rows.length-positives));
  for(let epoch=0;epoch<epochs;epoch++)for(const [f,y] of rows){let z=bias;for(const [k,v] of f)z+=weights[k]*v;const g=(1/(1+Math.exp(-z))-y)*(y?wp:wn);for(const [k,v] of f)weights[k]-=rate*(g*v+l2*weights[k]);bias-=rate*g;}
  return text=>{let z=bias;for(const [k,v] of features(text))z+=weights[k]*v;return 1/(1+Math.exp(-z));};
}
const training=JSON.parse(readFileSync(new URL('./injection-training.json',import.meta.url),'utf8'));
let trained=null;
export const warmClassifier=()=>{trained||=trainClassifier(training.examples);return trained;};
const score=text=>warmClassifier()(text);
export const CLASSIFIER={threshold:training.threshold,model:'logistic_regression_hashed_words_char4',examples:training.examples.length,version:training.version};

// Fenêtres de phrases : une instruction courte noyée dans un long passage reste détectable.
export function classifierScore(text){
  const sentences=String(text).split(/(?<=[.!?\n])\s+/).filter(sentence=>sentence.trim().length>=12);
  if(!sentences.length)return score(text);
  let best=0;for(let i=0;i<sentences.length;i++){const window=sentences.slice(i,i+2).join(' ').slice(0,400);best=Math.max(best,score(window));}
  return best;
}

export function screenUntrustedText(text){
  const signals=ruleSignals(text);
  const probability=classifierScore(text);
  if(probability>=CLASSIFIER.threshold)signals.push('statistical_classifier');
  return {disposition:signals.length?'quarantine':'eligible',signals,score:Math.round(probability*1000)/1000,detector:'rules_then_logistic_regression',assurance:'not_a_complete_prompt_injection_defense'};
}
