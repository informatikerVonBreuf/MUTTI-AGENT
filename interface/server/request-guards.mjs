// Gardes HTTP : jeton CSRF lié à la session, limitation de débit des routes IA, validation des corps JSON.
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHmac,createHash,randomBytes,timingSafeEqual} from 'node:crypto';

export const cookieValue=(request,name)=>{for(const part of String(request.headers.cookie||'').split(';')){const [key,...rest]=part.trim().split('=');if(key===name)return rest.join('=');}return '';};

// CSRF : double soumission signée. Le cookie folio_csrf (lisible par la page) vaut HMAC(secret, empreinte de la session) ;
// toute modification authentifiée doit renvoyer cette valeur dans l'en-tête X-CSRF-Token.
export async function createCsrfGuard({storageDirectory,secure=false}){
  const file=path.join(storageDirectory,'auth','csrf.key');await fs.mkdir(path.dirname(file),{recursive:true});
  let secret;try{secret=Buffer.from((await fs.readFile(file,'utf8')).trim(),'hex');}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!secret||secret.length!==32){secret=randomBytes(32);await fs.writeFile(file,secret.toString('hex'),{mode:0o600});}
  const tokenFor=sessionToken=>createHmac('sha256',secret).update(createHash('sha256').update(sessionToken).digest('hex')).digest('base64url');
  return {
    tokenFor,
    cookie(sessionToken){return `folio_csrf=${tokenFor(sessionToken)}; Path=/; SameSite=Strict; Max-Age=28800${secure?'; Secure':''}`;},
    clearCookie(){return `folio_csrf=; Path=/; SameSite=Strict; Max-Age=0${secure?'; Secure':''}`;},
    valid(request){
      const session=cookieValue(request,'folio_session'),header=String(request.headers['x-csrf-token']||'');
      if(!session||!/^[A-Za-z0-9_-]{43}$/.test(header))return false;
      const expected=Buffer.from(tokenFor(session));const given=Buffer.from(header);
      return expected.length===given.length&&timingSafeEqual(expected,given);
    },
  };
}

// Seau à jetons par clé (utilisateur + route) : capacité, recharge par minute.
export function createRateLimiter({now=()=>Date.now()}={}){
  const buckets=new Map();
  return function take(key,{capacity,perMinute}){
    const time=now();let bucket=buckets.get(key);
    if(!bucket){bucket={tokens:capacity,updated:time};buckets.set(key,bucket);}
    bucket.tokens=Math.min(capacity,bucket.tokens+(time-bucket.updated)/60000*perMinute);bucket.updated=time;
    if(buckets.size>5000)for(const [name,item] of buckets)if(time-item.updated>3600000)buckets.delete(name);
    if(bucket.tokens<1)return {allowed:false,retryAfter:Math.ceil((1-bucket.tokens)/perMinute*60)};
    bucket.tokens-=1;return {allowed:true,remaining:Math.floor(bucket.tokens)};
  };
}
export const AI_LIMITS={
  'POST /api/threads/:id/run':{capacity:6,perMinute:3},
  'POST /api/backend/probe':{capacity:4,perMinute:2},
  'POST /api/threads/:id/rag-context':{capacity:20,perMinute:20},
  'POST /api/threads/:id/messages':{capacity:30,perMinute:30},
};

// Validation stricte : champs connus seulement, types et longueurs bornés.
export class BodyError extends Error{constructor(message){super(message);this.status=400;this.code='INVALID_BODY';}}
const id=/^[a-zA-Z0-9-]{1,80}$/;
const rules={
  string:(value,{min=0,max=Infinity,pattern})=>typeof value==='string'&&value.length>=min&&value.length<=max&&(!pattern||pattern.test(value)),
  boolean:value=>typeof value==='boolean',
  ids:(value,{max=50,pattern=id})=>Array.isArray(value)&&value.length<=max&&value.every(item=>typeof item==='string'&&pattern.test(item)),
  enum:(value,{values})=>values.includes(value),
  // Réponse à la vérification anti-robot : défi signé, nombre trouvé, champ piège.
  human:value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>['challenge','nonce','trap'].includes(key))&&typeof value.challenge==='string'&&value.challenge.length<=1024&&typeof value.nonce==='string'&&value.nonce.length<=12&&(value.trap===undefined||(typeof value.trap==='string'&&value.trap.length<=200)),
};
const human={type:'human',optional:true},company=/^(\*|[a-z0-9-]{1,40})$/;
export const SCHEMAS={
  createThread:{kind:{type:'enum',values:['chat','thematic']},title:{type:'string',max:120,optional:true},theme:{type:'string',max:120,optional:true},sourceThreadIds:{type:'ids',optional:true},documentIds:{type:'ids',max:8,pattern:/^[a-f0-9]{18}$/,optional:true}},
  updateThread:{documentIds:{type:'ids',max:8,pattern:/^[a-f0-9]{18}$/,optional:true},title:{type:'string',max:120,optional:true},priority:{type:'enum',values:['normal','important','essential'],optional:true},pinned:{type:'boolean',optional:true},sourceThreadIds:{type:'ids',optional:true}},
  message:{content:{type:'string',min:1,max:12000}},
  run:{messageId:{type:'string',pattern:id}},
  ragContext:{question:{type:'string',min:1,max:4000}},
  memory:{text:{type:'string',min:1,max:1000},sourceMessageId:{type:'string',pattern:id,optional:true}},
  memoryEdit:{text:{type:'string',min:1,max:1000}},
  login:{email:{type:'string',max:254},password:{type:'string',max:1024},human},
  setup:{email:{type:'string',max:254},password:{type:'string',max:1024},human},
  reset:{email:{type:'string',max:254},recoveryCode:{type:'string',max:200},newPassword:{type:'string',max:1024},human},
  mfa:{challenge:{type:'string',max:80},code:{type:'string',max:10}},
  passwordChange:{currentPassword:{type:'string',max:1024},newPassword:{type:'string',max:1024}},
  mfaConfirm:{code:{type:'string',max:10},password:{type:'string',max:1024}},
  empty:{},
  memberCreate:{email:{type:'string',max:254},companies:{type:'ids',max:20,pattern:company}},
  memberUpdate:{companies:{type:'ids',max:20,pattern:company,optional:true},disabled:{type:'boolean',optional:true},resetInvitation:{type:'boolean',optional:true}},
};

// Protection contre le déni de service applicatif : débit par adresse IP sur toute l'API, plus strict pour la connexion.
export const IP_LIMITS={api:{capacity:300,perMinute:300},auth:{capacity:30,perMinute:10}};
export function validateBody(data,schema){
  for(const key of Object.keys(data))if(!(key in schema))throw new BodyError('Champ non accepté : '+key.slice(0,40)+'.');
  for(const [key,rule] of Object.entries(schema)){
    if(!(key in data)||data[key]===undefined){if(rule.optional)continue;throw new BodyError('Champ requis : '+key+'.');}
    if(!rules[rule.type](data[key],rule))throw new BodyError('Champ invalide : '+key+'.');
  }
  return data;
}

// En-têtes de sécurité du serveur Node (hors conteneur, nginx les ajoute aussi).
export const SECURITY_HEADERS={
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; worker-src 'self' blob:; base-uri 'none'; form-action 'self'; frame-ancestors 'self'",
  'X-Frame-Options':'SAMEORIGIN','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=(), usb=()','Cross-Origin-Opener-Policy':'same-origin',
};
