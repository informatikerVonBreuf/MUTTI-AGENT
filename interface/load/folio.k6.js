// Scénarios de charge Folio (k6). À lancer contre la pile de test :
//   docker compose -f docker-compose.yml -f docker-compose.load.yml up -d --build
//   docker compose -f docker-compose.yml -f docker-compose.load.yml run --rm k6
// Le backend de test utilise le fournisseur simulé (aucun appel facturé) et un volume dédié :
// le compte créé ici n'est jamais celui de l'atelier réel.
import http from 'k6/http';
import crypto from 'k6/crypto';
import encoding from 'k6/encoding';
import {check,sleep,fail} from 'k6';
import {Trend,Counter} from 'k6/metrics';

const BASE=__ENV.BASE_URL||'http://frontend:8080';
const ORIGIN=__ENV.PUBLIC_ORIGIN||'http://localhost:8088';
const HOST=ORIGIN.replace(/^https?:\/\//,'');
const EMAIL=__ENV.K6_EMAIL||'charge@example.test';
const PASSWORD=__ENV.K6_PASSWORD||'Mot de passe de charge isolé 2026';
const VUS=Number(__ENV.MAX_VUS||10);

const runDuration=new Trend('folio_run_duration',true);
const runQueued=new Counter('folio_run_busy');
const runLimited=new Counter('folio_run_rate_limited');
// Jeton CSRF déposé par le serveur dans le cookie folio_csrf, renvoyé sur chaque modification.
const csrf=()=>{const values=http.cookieJar().cookiesForURL(BASE).folio_csrf;return values&&values.length?values[0]:'';};
const headers=extra=>({Host:HOST,Origin:ORIGIN,'Content-Type':'application/json',...(csrf()?{'X-CSRF-Token':csrf()}:{}),...extra});

export const options={
  // Chaque utilisateur virtuel garde sa session d'une itération à l'autre, comme un navigateur.
  noCookiesReset:true,
  scenarios:{
    // Lecture de l'atelier : 1, puis 5, puis 10 utilisateurs virtuels avec pauses réalistes.
    api:{executor:'ramping-vus',exec:'browse',startVUs:1,stages:[{duration:'30s',target:1},{duration:'30s',target:5},{duration:'45s',target:VUS},{duration:'15s',target:0}],gracefulRampDown:'10s'},
    // Analyses : une à la fois, comme le serveur l'impose.
    ai:{executor:'constant-vus',exec:'analyse',vus:1,duration:'3m',startTime:'5s'},
  },
  thresholds:{
    'http_req_duration{kind:api}':['p(95)<1000','p(99)<2000'],
    'http_req_failed{kind:api}':['rate<0.01'],
    folio_run_duration:['p(95)<15000','p(99)<20000'],
    checks:['rate>0.99'],
  },
  summaryTrendStats:['avg','min','med','p(90)','p(95)','p(99)','max','count'],
};

// Vérification anti-robot : même preuve de travail que le navigateur (SHA-256, N bits à zéro), délai minimal respecté.
function zeroBits(hex){let bits=0;for(const ch of hex){const v=parseInt(ch,16);if(v===0){bits+=4;continue;}return bits+Math.clz32(v)-28;}return bits;}
function human(){
  const res=http.get(BASE+'/api/auth/challenge',{headers:headers(),tags:{kind:'auth'}});
  if(res.status!==200)fail('Défi anti-robot indisponible : '+res.status);
  const {challenge,difficulty}=res.json(),started=Date.now();
  const {salt}=JSON.parse(encoding.b64decode(challenge.split('.')[0],'rawurl','s'));
  let nonce=0;while(zeroBits(crypto.sha256(salt+':'+nonce,'hex'))<difficulty)nonce++;
  const wait=1000-(Date.now()-started);if(wait>0)sleep(wait/1000);
  return {challenge,nonce:String(nonce)};
}

function login(){
  const jar=http.cookieJar();
  const res=http.post(BASE+'/api/auth/login',JSON.stringify({email:EMAIL,password:PASSWORD,human:human()}),{headers:headers(),tags:{kind:'auth'}});
  if(res.status!==200)fail('Connexion refusée : '+res.status);
  return jar;
}

export function setup(){
  const status=http.get(BASE+'/api/auth/status',{headers:headers(),tags:{kind:'auth'}}).json();
  if(status.setupRequired){
    const res=http.post(BASE+'/api/auth/setup',JSON.stringify({email:EMAIL,password:PASSWORD,human:human()}),{headers:headers(),tags:{kind:'auth'}});
    if(res.status!==201)fail('Création du compte de charge impossible : '+res.status);
  }else login();
  const workspace=http.get(BASE+'/api/workspace',{headers:headers(),tags:{kind:'api'}}).json();
  const backend=http.get(BASE+'/api/backend/status',{headers:headers(),tags:{kind:'api'}}).json();
  if(!backend.simulated)fail('Le backend de charge doit utiliser FOLIO_PROVIDER=simulated.');
  return {documents:workspace.documents.map(doc=>doc.id)};
}

let session=false;
function ensureSession(){if(!session){login();http.get(BASE+'/api/auth/session',{headers:headers(),tags:{kind:'auth'}});session=true;}}

export function browse(data){
  ensureSession();
  const ws=http.get(BASE+'/api/workspace',{headers:headers(),tags:{kind:'api',name:'workspace'}});
  check(ws,{'atelier 200':r=>r.status===200});
  sleep(1+Math.random()*2);
  const doc=data.documents[Math.floor(Math.random()*data.documents.length)];
  const text=http.get(BASE+'/api/documents/'+doc,{headers:headers(),tags:{kind:'api',name:'document'}});
  check(text,{'document 200':r=>r.status===200});
  sleep(1+Math.random()*2);
  const threads=ws.json('threads')||[];
  if(threads.length){const thread=http.get(BASE+'/api/threads/'+threads[0].id,{headers:headers(),tags:{kind:'api',name:'thread'}});check(thread,{'conversation 200':r=>r.status===200});}
  const metrics=http.get(BASE+'/api/metrics',{headers:headers(),tags:{kind:'api',name:'metrics'}});
  check(metrics,{'mesures 200':r=>r.status===200});
  sleep(2+Math.random()*3);
}

const QUESTIONS=['Quel est le chiffre d’affaires annuel de Meta en 2024 ?','Quels risques Apple mentionne-t-il dans son rapport 10-K ?','Comment évoluent les revenus publicitaires de Google ?','Quel est le résultat opérationnel d’Amazon Web Services ?'];

export function analyse(){
  ensureSession();
  const thread=http.post(BASE+'/api/threads',JSON.stringify({kind:'chat'}),{headers:headers(),tags:{kind:'api',name:'create-thread'}}).json();
  const saved=http.post(BASE+'/api/threads/'+thread.id+'/messages',JSON.stringify({content:QUESTIONS[Math.floor(Math.random()*QUESTIONS.length)]}),{headers:headers(),tags:{kind:'api',name:'message'}}).json();
  const messageId=saved.thread.messages.at(-1).id;
  const started=Date.now();
  const res=http.post(BASE+'/api/threads/'+thread.id+'/run',JSON.stringify({messageId}),{headers:headers(),tags:{kind:'run',name:'start'}});
  if(res.status===409){runQueued.add(1);sleep(2);return;}
  // La limitation de débit des analyses (par utilisateur) fait partie de la politique : elle est comptée, pas contournée.
  if(res.status===429){runLimited.add(1);sleep(Number(res.headers['Retry-After']||20));return;}
  check(res,{'analyse acceptée':r=>r.status===202});
  let run=res.json();
  while(run&&run.status==='running'&&Date.now()-started<60000){sleep(0.5);run=http.get(BASE+'/api/threads/'+thread.id+'/run',{headers:headers(),tags:{kind:'run',name:'poll'}}).json();}
  runDuration.add(Date.now()-started);
  check(run,{'analyse terminée':r=>r&&['completed','failed'].includes(r.status),'analyse simulée':r=>r&&r.usage&&r.usage.simulated===true});
  // Temps de lecture réaliste avant la question suivante (une personne lit la réponse et ses sources).
  sleep(15+Math.random()*10);
}

export function handleSummary(data){
  return {'/results/summary.json':JSON.stringify(data,null,2),stdout:textSummary(data)};
}
function textSummary(data){
  const m=data.metrics,line=(name,key)=>m[key]?`${name}: p50 ${Math.round(m[key].values.med)} ms · p95 ${Math.round(m[key].values['p(95)'])} ms · p99 ${Math.round(m[key].values['p(99)'])} ms · n=${m[key].values.count}\n`:'';
  return '\nFolio — charge\n'+line('API (lecture)','http_req_duration{kind:api}')+line('Analyse complète (simulée)','folio_run_duration')+`Échecs HTTP API : ${((m['http_req_failed{kind:api}']?.values.rate||0)*100).toFixed(2)} %\n`;
}
