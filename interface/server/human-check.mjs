// Vérification « je ne suis pas un robot », sans service tiers ni suivi :
// - preuve de travail : le navigateur cherche un nombre dont l'empreinte SHA-256 commence par N bits à zéro ;
// - défi signé (HMAC), à usage unique, valable 5 minutes, avec un délai minimal de remplissage ;
// - champ piège invisible pour les humains.
// Cela ralentit les automates et rend les attaques massives coûteuses ; ce n'est pas une preuve absolue d'humanité.
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';

export const HUMAN_CHECK={difficulty:15,ttlMs:5*60*1000,minMs:800};

export const leadingZeroBits=hex=>{let bits=0;for(const char of hex){const value=parseInt(char,16);if(value===0){bits+=4;continue;}return bits+Math.clz32(value)-28;}return bits;};
export const powHash=(salt,nonce)=>createHash('sha256').update(salt+':'+nonce).digest('hex');
// Solveur de référence (scripts de test et de charge) : même calcul que le navigateur.
export function solveChallenge(challenge,difficulty){const [encoded]=challenge.split('.');const {salt}=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'));for(let nonce=0;;nonce++)if(leadingZeroBits(powHash(salt,nonce))>=difficulty)return String(nonce);}

export async function createHumanCheck({storageDirectory,now=Date.now,difficulty=HUMAN_CHECK.difficulty,enabled=true}){
  const file=path.join(storageDirectory,'auth','human.key');await fs.mkdir(path.dirname(file),{recursive:true});
  let key;try{key=Buffer.from((await fs.readFile(file,'utf8')).trim(),'hex');}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!key||key.length!==32){key=randomBytes(32);await fs.writeFile(file,key.toString('hex'),{mode:0o600});}
  const used=new Map();
  const sign=encoded=>createHmac('sha256',key).update(encoded).digest('base64url');
  return {
    enabled,
    issue(){
      const payload={salt:randomBytes(16).toString('hex'),difficulty,issuedAt:now(),expiresAt:now()+HUMAN_CHECK.ttlMs};
      const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');
      return {challenge:encoded+'.'+sign(encoded),difficulty,expiresAt:payload.expiresAt,algorithm:'sha256-leading-zero-bits'};
    },
    // Renvoie un code d'erreur ou null. Le champ piège rempli est traité comme un échec silencieux.
    verify(human){
      if(!enabled)return null;
      if(!human||typeof human!=='object')return 'missing';
      if(typeof human.trap==='string'&&human.trap.length)return 'trap';
      const [encoded,signature]=String(human.challenge||'').split('.');
      if(!encoded||!signature)return 'malformed';
      const expected=Buffer.from(sign(encoded)),given=Buffer.from(signature);
      if(expected.length!==given.length||!timingSafeEqual(expected,given))return 'bad_signature';
      let payload;try{payload=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'));}catch{return 'malformed';}
      if(payload.expiresAt<now())return 'expired';
      if(now()-payload.issuedAt<HUMAN_CHECK.minMs)return 'too_fast';
      if(used.has(payload.salt))return 'replayed';
      if(typeof human.nonce!=='string'||!/^\d{1,12}$/.test(human.nonce)||leadingZeroBits(powHash(payload.salt,human.nonce))<payload.difficulty)return 'unsolved';
      used.set(payload.salt,payload.expiresAt);
      if(used.size>10000)for(const [salt,expires] of used)if(expires<now())used.delete(salt);
      return null;
    },
  };
}
