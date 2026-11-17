// Enveloppes inter-agents signées (HMAC-SHA256) — vérification côté serveur.
// Chaque transfert entre rôles porte {run_id, from_role, to_role, seq, payload_hash, trust_level, ts}.
// La clé est tirée au hasard pour chaque exécution, transmise au worker par stdin et jamais au modèle.
// Ce mécanisme garantit l'intégrité et l'ordre des transferts d'une exécution et applique la matrice
// des transitions autorisées ; il ne protège pas d'un worker compromis, qui détient la clé.
import {createHmac,createHash,randomBytes,timingSafeEqual} from 'node:crypto';

export const TRANSITIONS=new Set(['server>planner','server>researcher','planner>researcher','researcher>verifier','verifier>writer','verifier>server','writer>server']);
export const EMITTED_TRUST={server:'trusted_instruction',planner:'model_plan',researcher:'untrusted_evidence',verifier:'verified_evidence',writer:'verified_summary'};
export const ACCEPTED_TRUST={planner:['trusted_instruction'],researcher:['trusted_instruction','model_plan'],verifier:['untrusted_evidence'],writer:['verified_evidence'],server:['verified_evidence','verified_summary']};
const FIELDS=['run_id','from_role','to_role','seq','payload_hash','trust_level','ts'];

// JSON canonique identique à json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False) côté Python.
export function canonical(value){
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
}
export const payloadHash=payload=>createHash('sha256').update(canonical(payload),'utf8').digest('hex');
export const newEnvelopeKey=()=>randomBytes(32).toString('hex');
const sign=(key,envelope)=>createHmac('sha256',Buffer.from(key,'hex')).update(canonical(Object.fromEntries(FIELDS.map(field=>[field,envelope[field]]))),'utf8').digest('hex');

export class EnvelopeError extends Error{constructor(reason){super('Transfert entre agents refusé : '+reason);this.reason=reason;this.code='INTEGRITY_VIOLATION';}}

export function sealEnvelope(key,{runId,from,to,seq,payload,ts=Date.now()}){
  if(!TRANSITIONS.has(from+'>'+to))throw new EnvelopeError('transition_denied');
  const envelope={run_id:runId,from_role:from,to_role:to,seq,payload_hash:payloadHash(payload),trust_level:EMITTED_TRUST[from],ts};
  return {...envelope,sig:sign(key,envelope)};
}

// Vérifie une chaîne d'enveloppes au fil de l'eau : signature, exécution, ordre strict (anti-rejeu),
// transition autorisée, niveau de confiance accepté par le destinataire.
export function createEnvelopeVerifier(key,runId){
  let lastSeq=0;const accepted=[];
  return {
    verify(envelope,{payload}={}){
      if(!envelope||typeof envelope!=='object'||FIELDS.some(field=>!(field in envelope))||typeof envelope.sig!=='string'||!/^[a-f0-9]{64}$/.test(envelope.sig))throw new EnvelopeError('malformed');
      const expected=Buffer.from(sign(key,envelope),'hex');
      if(!timingSafeEqual(expected,Buffer.from(envelope.sig,'hex')))throw new EnvelopeError('bad_signature');
      if(envelope.run_id!==runId)throw new EnvelopeError('foreign_run');
      if(!Number.isInteger(envelope.seq)||envelope.seq!==lastSeq+1)throw new EnvelopeError(envelope.seq<=lastSeq?'replay':'gap');
      if(!TRANSITIONS.has(envelope.from_role+'>'+envelope.to_role))throw new EnvelopeError('transition_denied');
      if(envelope.trust_level!==EMITTED_TRUST[envelope.from_role]||!ACCEPTED_TRUST[envelope.to_role]?.includes(envelope.trust_level))throw new EnvelopeError('trust_denied');
      if(payload!==undefined&&payloadHash(payload)!==envelope.payload_hash)throw new EnvelopeError('payload_mismatch');
      const previous=accepted.at(-1);
      if(previous&&previous.to_role!==envelope.from_role)throw new EnvelopeError('broken_chain');
      lastSeq=envelope.seq;accepted.push(envelope);
      return envelope;
    },
    accepted(){return accepted.slice();},
    get lastSeq(){return lastSeq;},
  };
}
