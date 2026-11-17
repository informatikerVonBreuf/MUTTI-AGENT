// Protection des comptes : double authentification TOTP (RFC 6238), règle de mot de passe, verrous progressifs.
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';

const ALPHABET='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buffer){let bits=0,value=0,out='';for(const byte of buffer){value=(value<<8)|byte;bits+=8;while(bits>=5){out+=ALPHABET[(value>>>(bits-5))&31];bits-=5;}}if(bits>0)out+=ALPHABET[(value<<(5-bits))&31];return out;}
export function base32Decode(text){const clean=String(text).toUpperCase().replace(/[\s=-]/g,'');let bits=0,value=0;const out=[];for(const char of clean){const index=ALPHABET.indexOf(char);if(index<0)throw new Error('Clé TOTP invalide.');value=(value<<5)|index;bits+=5;if(bits>=8){out.push((value>>>(bits-8))&255);bits-=8;}}return Buffer.from(out);}
export const newTotpSecret=()=>base32Encode(randomBytes(20));

// Code à 6 chiffres pour un pas de 30 s (HMAC-SHA1, compatible avec les applications d'authentification usuelles).
export function totpCode(secret,step){
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(step));
  const mac=createHmac('sha1',base32Decode(secret)).update(counter).digest();const offset=mac[mac.length-1]&15;
  return String(((mac.readUInt32BE(offset)&0x7fffffff)%1_000_000)).padStart(6,'0');
}
// Vérifie un code dans une fenêtre de ±1 pas ; refuse un pas déjà utilisé (anti-rejeu). Renvoie le pas accepté ou null.
export function verifyTotp(secret,code,{now=Date.now(),lastStep=-1,window=1}={}){
  if(typeof code!=='string'||!/^\d{6}$/.test(code.trim()))return null;
  const current=Math.floor(now/30000);
  for(let delta=-window;delta<=window;delta++){
    const step=current+delta;if(step<=lastStep)continue;
    const expected=Buffer.from(totpCode(secret,step)),given=Buffer.from(code.trim());
    if(timingSafeEqual(expected,given))return step;
  }
  return null;
}
export const otpauthUrl=(secret,email,issuer='Folio')=>`otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

// Règle de mot de passe (approche NIST SP 800-63B) : longueur, pas de mot de passe courant, pas l'adresse elle-même.
const COMMON=new Set(['password','motdepasse','azerty','qwerty','123456','12345678','123456789','1234567890','000000','111111','iloveyou','admin','welcome','bienvenue','soleil','doudou','loulou','chouchou','football','princesse','dragon','monkey','letmein','abc123','passw0rd','p@ssw0rd','password123','motdepasse123','azertyuiop','qwertyuiop','folio','archivevivante']);
export function passwordProblems(password,email=''){
  const problems=[];
  if(typeof password!=='string'||password.length<12)problems.push('au moins 12 caractères');
  if(typeof password==='string'&&password.length>1024)problems.push('au plus 1 024 caractères');
  const simple=String(password||'').toLowerCase().replace(/[^a-z0-9@]/g,'');
  const core=simple.replace(/\d+$/,'').replace(/^\d+/,'');
  if(COMMON.has(simple)||COMMON.has(core)||/^(.)\1+$/.test(simple)||/^(0123456789|1234567890|abcdefghij)/.test(simple))problems.push('pas un mot de passe courant ou répétitif');
  const address=String(email).toLowerCase(),local=address.split('@')[0].replace(/[^a-z0-9]/g,'');
  if(address&&(String(password||'').toLowerCase().includes(address)||(local.length>=3&&core===local)))problems.push('ne pas reprendre votre adresse e-mail');
  if(new Set(String(password||'')).size<5)problems.push('au moins 5 caractères différents');
  return problems;
}

// Verrou par compte, progressif : 5 échecs → 15 min, puis 30 min, 1 h… jusqu'à 24 h. Indépendant de l'adresse IP.
export function createAccountLocks({now=Date.now,threshold=5,base=15*60*1000,max=24*60*60*1000}={}){
  const entries=new Map();
  return {
    lockedUntil(key){const entry=entries.get(key);return entry&&entry.until>now()?entry.until:0;},
    failure(key){
      const entry=entries.get(key)||{count:0,locks:0,until:0};
      if(entry.until&&entry.until<=now()){entry.count=0;entry.until=0;}
      entry.count++;
      if(entry.count>=threshold){entry.locks++;entry.until=now()+Math.min(max,base*2**(entry.locks-1));entry.count=0;}
      entries.set(key,entry);if(entries.size>5000)for(const [name,item] of entries)if(item.until<=now()&&item.count===0)entries.delete(name);
      return entry.until>now()?entry.until:0;
    },
    success(key){const entry=entries.get(key);if(entry){entry.count=0;entry.until=0;}},
  };
}
