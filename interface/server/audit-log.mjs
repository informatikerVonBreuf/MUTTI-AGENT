// Journal d'audit append-only, chaîné par empreintes : chaque ligne contient l'empreinte de la précédente.
// Contenu : qui (empreinte), quel agent, quel outil, quels documents, quelle décision, durée, résultat.
// Jamais de secret, de mot de passe, de mémoire brute, de question, de passage ni de raisonnement.
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {canonical} from './agent-envelopes.mjs';

export const GENESIS='0'.repeat(64);
const ACTIONS=new Set(['auth','run_start','run_end','tool_call','model_call','handoff','security','policy']);
const SAFE=/^[A-Za-z0-9_.:@+-]{1,120}$/;
const hashEntry=entry=>createHash('sha256').update(canonical(entry),'utf8').digest('hex');

// Ne conserve que des champs attendus, courts, sans texte libre.
export function sanitize(fields){
  const out={};
  for(const key of ['actor','runId','threadId','agent','tool','decision','reason','outcome','role','from','to','trust']){
    const value=fields[key];if(value===undefined||value===null)continue;
    if(typeof value!=='string'||!SAFE.test(value))throw new Error('Champ d’audit invalide : '+key);
    out[key]=value;
  }
  if(fields.documents!==undefined){if(!Array.isArray(fields.documents)||fields.documents.length>40||fields.documents.some(id=>typeof id!=='string'||!SAFE.test(id)))throw new Error('Documents d’audit invalides.');out.documents=[...new Set(fields.documents)];}
  for(const key of ['durationMs','handoffSeq','count','inputTokens','outputTokens']){const value=fields[key];if(value===undefined)continue;if(!Number.isFinite(value)||value<0)throw new Error('Nombre d’audit invalide : '+key);out[key]=Math.round(value);}
  if(fields.costUsd!==undefined&&fields.costUsd!==null){if(!Number.isFinite(fields.costUsd)||fields.costUsd<0)throw new Error('Coût d’audit invalide.');out.costUsd=Math.round(fields.costUsd*1e8)/1e8;}
  if(fields.signals!==undefined){if(!Array.isArray(fields.signals)||fields.signals.some(s=>typeof s!=='string'||!SAFE.test(s)))throw new Error('Signaux d’audit invalides.');out.signals=fields.signals.slice(0,10);}
  return out;
}

export function verifyChain(lines){
  let previous=GENESIS,index=0;
  for(const line of lines){
    index++;let entry;try{entry=JSON.parse(line);}catch{return {valid:false,entries:index-1,brokenAt:index,reason:'json_invalide'};}
    const {hash,...rest}=entry;
    if(rest.prevHash!==previous)return {valid:false,entries:index-1,brokenAt:index,reason:'chainage_rompu'};
    if(rest.seq!==index)return {valid:false,entries:index-1,brokenAt:index,reason:'sequence_rompue'};
    if(hashEntry(rest)!==hash)return {valid:false,entries:index-1,brokenAt:index,reason:'empreinte_modifiee'};
    previous=hash;
  }
  return {valid:true,entries:index,lastHash:previous};
}

export async function createAuditLog({storageDirectory,now=()=>new Date()}){
  const directory=path.join(storageDirectory,'audit'),file=path.join(directory,'audit.jsonl');
  await fs.mkdir(directory,{recursive:true});
  let lines=[];
  try{lines=(await fs.readFile(file,'utf8')).split('\n').filter(Boolean);}catch(error){if(error.code!=='ENOENT')throw error;}
  const check=verifyChain(lines);
  // Une chaîne déjà rompue n'est pas réécrite : la rupture reste visible et l'ajout continue à partir de la dernière ligne lisible.
  let seq=lines.length,previous=GENESIS;
  if(lines.length){try{previous=JSON.parse(lines.at(-1)).hash||GENESIS;}catch{previous=GENESIS;}}
  const recent=lines.slice(-2000).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
  let writes=Promise.resolve();
  return {
    startupCheck:check,
    append(action,fields={}){
      if(!ACTIONS.has(action))throw new Error('Action d’audit inconnue.');
      // Numéro de ligne, date, action et chaînage posés après les champs : aucun champ ne peut les remplacer.
      const entry={...sanitize(fields),seq:++seq,at:now().toISOString(),action,prevHash:previous};
      const hash=hashEntry(entry);previous=hash;const record={...entry,hash};
      recent.push(record);if(recent.length>2000)recent.shift();
      writes=writes.catch(()=>{}).then(()=>fs.appendFile(file,JSON.stringify(record)+'\n',{mode:0o600}));
      return record;
    },
    forRun(runId){return recent.filter(entry=>entry.runId===runId);},
    recent(limit=100){return recent.slice(-limit).reverse();},
    async verify(){await writes.catch(()=>{});let content='';try{content=await fs.readFile(file,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}return verifyChain(content.split('\n').filter(Boolean));},
    file,
    async close(){await writes.catch(()=>{});},
  };
}
