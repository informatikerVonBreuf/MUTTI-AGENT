// Détection d'instructions dans les données non fiables (passages, notes de mémoire, sorties d'outils).
// Niveau 1 : règles déterministes après normalisation (invisibles, homoglyphes, leet, base64/hex/URL décodés).
// Niveau 2 : classifieur statistique local (régression logistique sur mots et n-grammes, fenêtres glissantes),
// entraîné sur injection-training.json, jeu distinct de la suite red team. Aucun appel externe.
// Ce filtre réduit le risque ; il ne garantit pas l'immunité contre un attaquant adaptatif.
import {readFileSync} from 'node:fs';

const INVISIBLE=/[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]|\uDB40[\uDC00-\uDC7F]/g;
const CONFUSABLES={'а':'a','е':'e','о':'o','р':'p','с':'c','у':'y','х':'x','і':'i','ј':'j','ѕ':'s','ԁ':'d','ɡ':'g','ν':'v','ο':'o','α':'a','ε':'e','ι':'i','κ':'k','τ':'t','υ':'u','ρ':'p','В':'b','Н':'h','К':'k','М':'m','Т':'t'};
const LEET={'0':'o','1':'i','3':'e','4':'a','5':'s','7':'t','@':'a','$':'s','!':'i','|':'l'};

// Homoglyphes remplacés avant ET après la mise en minuscules (une capitale cyrillique « І » devient « i »).
const unconfuse=text=>text.replace(/./gu,ch=>CONFUSABLES[ch]||ch);
export function normalizeUntrusted(text){
  return unconfuse(unconfuse(String(text).normalize('NFKC').replace(INVISIBLE,'')).toLowerCase())
    .normalize('NFD').replace(/[̀-ًͯ-ٰٟ]/g,'').toLowerCase().replace(/\s+/g,' ');
}
// Les règles en cyrillique passent par la même normalisation que le texte (homoglyphes, puis diacritiques retirés : « й » → « и »).
const cyr=source=>new RegExp(unconfuse(source).normalize('NFD').replace(/[̀-ͯ]/g,''),'s');
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
  // « Ignorer les règles » ne suffit pas (« ignorer les règles du DMA » est une vraie question) : il faut viser les consignes
  // de l'assistant (instructions, consignes) ou des règles qualifiées (précédentes, système, tes, your…).
  ['instruction_override',/\b(?:ignore|disregard|forget|override|bypass|oublie|ignorer|ignorez|ne (?:tiens|tenez) (?:pas|plus) compte|ignora|olvida|ignoriere|vergiss|ignorar|esquece)\b.{0,80}?(?:\b(?:previous|prior|above|earlier|system|developer|initial|preceding|all|any|your|tes|vos|ta|ton|votre|toutes?|precedentes?|anterieures?|initiales?)\b(?:\s+\S+){0,2}?\s+(?:instructions?|rules|guidelines|consignes?|regles|directives?|prompts?|instrucciones|anweisungen|regeln|istruzioni|instrucoes)\b|\b(?:instructions?|consignes?|instrucciones|anweisungen|istruzioni|instrucoes)\b|\b(?:rules|regles|guidelines|directives)\s+(?:precedentes?|anterieures?|initiales?|previous|above|du systeme|of the system)\b)|\b(?:ignore|disregard|forget|oublie)\w*\s+(?:everything|all|tout)\s+(?:(?:that|ce qui|ce que)\s+)?(?:above|before|ci-dessus|precede\w*)\b/s],
  ['instruction_override',/(?:new|updated|nouvelles?|nuevas?|neue)\s+(?:system\s+)?(?:instructions?|consignes?|instrucciones|anweisungen)\s*[:：]/],
  ['role_spoofing',/<\/?(?:system|developer|assistant|tool)>|\[\/?(?:inst|system)\]|<\|im_(?:start|end)\|>|(?:^|\s)(?:system|developer)\s*(?:prompt|message)?\s*[:：]\s*(?:you|tu|vous|du)\b|\byou are now\b|\btu es (?:desormais|maintenant)\b|\bvous etes (?:desormais|maintenant)\b|\bact as (?:an?|the) (?:admin|administrator|developer|system)\b|\b(?:agis|agissez|comporte-toi|reponds) (?:comme|en tant que) (?:un |une |l.|le )?(?:admin\w*|developpeur|super-?utilisateur|root|systeme)\b|\bmode (?:admin\w*|root|maintenance)\b/],
  // Bornes de mots : « shares » n'est pas « share », « Secretary » n'est pas « secret » (faux positifs mesurés sur les 10-Q de Google).
  ['secret_exfiltration',/\b(?:send|sends|sending|upload\w*|transmit\w*|post|leak\w*|share|email|envoie\w*|envoyer|transmets|divulgue\w*|revele\w*|reveal\w*|print|affiche\w*|show|montre\w*|exfiltrat\w*)\b.{0,100}(?:api.?key|\bsecrets?\b|\btokens?\b|password|mot de passe|cle(?: d.acces| api)|credentials?\b|identifiants?\b|cookies?\b|system prompt|prompt systeme|\.env\b)/s],
  ['tool_execution',/(?:run|execute|exec|lance|lancer|executer?|call|appelle|invoke)\w*.{0,60}(?:subprocess|powershell|bash|shell|terminal|cmd\.exe|curl\s|wget\s|os\.system|eval\(|rm -rf|delegate_task|retrieve_passages|compose_summary)/s],
  ['url_exfiltration',/!\[[^\]]{0,80}\]\(\s*https?:\/\/|https?:\/\/[^\s)]+[?&][a-z_]{1,20}=\{|(?:visit|ouvre|open|charge|load|fetch|navigate to|rends-toi sur)\s+https?:\/\//],
  // « Toujours » seulement en tête de phrase (impératif) : « Does Apple always say that… » est une vraie question.
  ['memory_poisoning',/(?:\b(?:remember|retiens|souviens-toi|memorise|from now on|a partir de maintenant|desormais)\b.{0,60}|(?:^|[.!?:;]\s*)(?:always|toujours)\s+)\b(?:answer|reponds|repondre|reponde|say|dire|recommend|recommander?|recommande|tell|dis)\b.{0,30}\b(?:that|que|qu|buy|achat|acheter|sell|vendre)\b/s],
  ['hidden_instruction',/<!--[^>]{0,400}(?:instruction|ignore|assistant|system|prompt|reponds|answer)[^>]{0,400}-->|display\s*:\s*none|font-size\s*:\s*0|color\s*:\s*(?:#fff(?:fff)?|white)\b.{0,40}(?:instruction|ignore|assistant)/s],
  // Jailbreak : persona sans limites, « mode développeur », jeu de rôle détourné, grand-mère, hypothèse de contournement.
  ['jailbreak',/\bdo anything now\b|\b(?:you are|tu es|vous etes|act as|play|joue)\s+(?:now\s+)?dan\b|\bdan\s+(?:mode|prompt)\b|\bjailbreak|\b(?:developer|dev|god|debug|unrestricted|unfiltered|unlocked)\s+mode\b|\bmode\s+(?:developpeur|dieu|debug|sans (?:filtre|restriction|limite|censure)s?|non (?:filtre|censure))|\b(?:answer\w*|respond\w*|reply|replies|talk|behave|reponds|repondre|repondez|parle\w*|agis|agissez|comporte-toi|ecris|ecrivez)\b.{0,40}\b(?:without|sans|with no|no)\s+(?:any\s+|aucune?\s+)?(?:restrictions?|limits?|limites?|filtres?|filters?|censure|censorship|rules|regles|garde-fous|guardrails)\b|(?:pretend|fais semblant|faites semblant|imagine que tu es|imagine you are|joue le role|roleplay as|role-play as|act as if)\b.{0,80}\b(?:no rules|sans regles|aucune regle|unrestricted|without (?:rules|restrictions|limits)|evil|malveillant|pirate|hacker|dan)\b|(?:my|ma) (?:grandma|grandmother|grand-?mere)\b.{0,120}\b(?:keys?|cles?|password|mot de passe|instructions?|prompt|secrets?)\b|\bhypothetic\w*\b.{0,80}\b(?:ignore|bypass|contourn\w*|reveal|revele\w*|no rules|sans regles)/s],
  // Extraction des consignes du modèle.
  ['system_prompt_extraction',/\b(?:system|initial|hidden|original|secret)\s+(?:prompt|instructions)\b|\bprompt (?:systeme|initial|cache|secret)\b|\binstructions? (?:initiales?|systeme|cachees?|d.origine|secretes?)\b|\b(?:repeat|print|show|reveal|display|output|dump|write|repete\w*|affiche\w*|montre\w*|revele\w*|recopie\w*|ecri\w*)\b\s+(?:me\s+|moi\s+|-moi\s+)?(?:everything|all|tout|toutes?|the (?:text|words|lines|content)|le texte|les (?:lignes|mots)|what (?:is|was)|ce qui)\b.{0,30}?\b(?:above|ci-dessus|before this|avant ce message|precede\w*|plus haut)\b|\b(?:recopie\w*|repete\w*|repeat|affiche\w*|montre\w*|donne\w*|traduis\w*|translate|resume\w*|summari[sz]e|ecri\w*|write|cite\w*|liste\w*|list|reveal|revele\w*|print|show|output|dump|give)\b(?:\s+\S+){0,3}?\s+(?:ton|ta|tes|vos|votre|your)\s+(?:prompt|instructions?|consignes?|regles|directives?|system message|message systeme|jeton)\b|\b(?:your|tes|vos|ta|votre) (?:rules|instructions|consignes|regles|prompt|directives)\b.{0,40}\b(?:verbatim|mot pour mot|exactly|exactement|en entier|in full)\b|\bwhat (?:are|were) your (?:instructions|rules|directives)\b|\bquelles sont (?:tes|vos) (?:instructions|regles|consignes|directives)\b|\bjeton confidentiel\b|\bconfidential token\b|folio-canary/s],
  // Demande directe d'un secret (clé d'API, mot de passe, fichier .env).
  // « What is Google's policy on passwords » est une vraie question : « quel est / what is » ne vise que des clés nommées.
  ['secret_request',/\b(?:give|tell|share|provide|donne\w*|dis|dites|fournis\w*|communique\w*)\b.{0,40}(?:api.?key|cle (?:d.)?api|cle d.acces|access key|secret key|mot de passe|password|bearer token|jeton d.acces|\.env\b|credentials|identifiants de connexion|google_api_key|langsmith_api_key)|\b(?:what is|what's|quel(?:le)? est)\b.{0,20}?\b(?:your|the|ton|ta|votre|la|le|l)\s+(?:\w+\s+){0,2}?(?:api.?key|cle (?:d.)?api|access key|secret key|bearer token|google_api_key|langsmith_api_key|\.env\b)/s],
  // Envoi vers une adresse externe (URL, courriel, webhook) ou image Markdown distante.
  ['exfiltration_request',/\b(?:send|envoie|envoyez|envoyer|upload|transmets|transmettez|transfere|transferez|exfiltrat\w*)\b.{0,80}(?:https?:\/\/|www\.|\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b|webhook|\bto (?:this|my|the following) (?:url|server|endpoint|address|email)|a (?:cette|mon|l.adresse|l.url) (?:adresse|url|serveur|courriel))/s],
  // Formes chinoises, arabes et russes de « ignore les instructions précédentes » et des demandes de secret.
  ['instruction_override',/(?:忽略|无视|忽视|不要理会|别管|不理会).{0,12}(?:指令|指示|规则|说明|提示|要求)|(?:之前|以上|上面|先前|前面)的(?:所有)?(?:指令|指示|规则)|تجاهل.{0,40}(?:التعليمات|الاوامر|القواعد|التوجيهات|الارشادات)|(?:انس|إنس).{0,30}(?:التعليمات|الاوامر)/s],
  ['instruction_override',cyr('(?:игнорируй|игнорируйте|проигнорируй|забудь|забудьте|не обращай внимания).{0,60}(?:инструкци|правил|указани|предыдущ)')],
  ['system_prompt_extraction',/系统提示|系统指令|(?:موجه|تعليمات|توجيهات) النظام/],
  // Consignes qui visent le contrôle lui-même (« les vérifications sont optionnelles », « ne plus citer les pages »).
  ['process_override',/\b(?:verifications?|controles?|citations?|sources?|references?)\b.{0,30}\b(?:sont|est|deviennent|devient|are|is|become)\s+(?:desormais\s+|now\s+)?(?:optionnel(?:le)?s?|facultati(?:f|ve)s?|inutiles?|optional|unnecessary|not required)\b|\bne (?:plus|jamais|pas) (?:citer|verifier|controler|mentionner|indiquer) (?:les |la |le )?(?:pages?|sources?|citations?|references?|verifications?)\b|\b(?:stop|skip|disable|do not|don't) (?:citing|verifying|checking|quoting) (?:the |any )?(?:pages?|sources?|citations?|evidence)\b/s],
  // Annonce d'une consigne découpée en plusieurs messages ou notes (« la partie 2 de mes consignes suit »).
  // « la partie 2 de mes consignes » oui ; « la partie 2 du 10-K et ses règles fiscales » non.
  ['fragmented_instruction',/\b(?:partie|part|morceau|fragment|piece)\s*\d+\s+(?:de|of|des|du)\s+(?:mes|my|tes|your|vos|ces|these|the|la)\s+(?:consignes?|instructions?|regles|rules)\b|\b(?:mes|my|tes|your|vos)\s+(?:consignes?|instructions?|regles|rules)\b.{0,30}\b(?:partie|part|morceau|fragment)\s*\d+\b/s],
  ['secret_request',/(?:泄露|透露|显示|告诉我|给我).{0,12}(?:密钥|密码|系统提示|令牌)|(?:اكشف|اظهر|اعطني|اعطيني|ارسل).{0,40}(?:المفتاح|كلمة المرور|كلمة السر|مفتاح)/s],
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
