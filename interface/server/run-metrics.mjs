// Mesures réelles d'exécution : tokens, coût, empreinte estimée et latences.
// Aucun contenu (question, passage, réponse) n'est conservé ici.
import {promises as fs} from 'node:fs';
import path from 'node:path';

export const ROLES=['planner','researcher','verifier','writer'];

// Tarif standard payant, vérifié le 17 novembre 2026 sur la page officielle.
// Les jetons de raisonnement sont facturés au tarif de sortie.
export const PRICING={
  checkedAt:'2026-11-17',
  source:'https://ai.google.dev/gemini-api/docs/pricing',
  currency:'USD',
  models:{
    'gemini-3.8-flash':[
      {until:'2027-01-01T00:00:00Z',input:0.75,output:3.75,cachedInput:0.075},
      {until:null,input:1.5,output:7.5,cachedInput:0.15},
    ],
  },
};

// Estimation publiée par Google (août 2025) pour le prompt texte médian de Gemini Apps,
// périmètre complet (machines actives, inactives, refroidissement, PUE). Ce n'est pas une mesure de nos appels.
export const FOOTPRINT={
  basis:'per_model_call',
  energyWh:0.24,co2eG:0.03,waterMl:0.26,
  source:'https://cloud.google.com/blog/products/infrastructure/measuring-the-environmental-impact-of-ai-inference',
  publishedAt:'2025-08',
  scope:'Médiane d’un prompt texte Gemini Apps ; hors réseau, appareil, entraînement et stockage.',
  assurance:'estimation',
};

const number=value=>Number.isFinite(value)&&value>=0?value:0;
const round=(value,digits)=>Math.round(value*10**digits)/10**digits;

export function priceFor(model,at=new Date(),override={}){
  const rows=PRICING.models[model];
  const time=new Date(at).getTime();
  const row=rows?.find(item=>!item.until||time<Date.parse(item.until));
  const input=Number.isFinite(override.input)?override.input:row?.input;
  const output=Number.isFinite(override.output)?override.output:row?.output;
  if(!Number.isFinite(input)||!Number.isFinite(output))return {known:false,model,currency:PRICING.currency,source:null};
  return {known:true,model,currency:PRICING.currency,inputPerMTok:input,outputPerMTok:output,cachedInputPerMTok:row?.cachedInput??input,
    source:Number.isFinite(override.input)?'configuration':PRICING.source,checkedAt:PRICING.checkedAt,validUntil:row?.until||null};
}

export function usageFromGemini(data){
  const meta=data?.usageMetadata||{};
  const usage={inputTokens:number(meta.promptTokenCount),outputTokens:number(meta.candidatesTokenCount),thoughtTokens:number(meta.thoughtsTokenCount),cachedTokens:number(meta.cachedContentTokenCount)};
  usage.totalTokens=number(meta.totalTokenCount)||usage.inputTokens+usage.outputTokens+usage.thoughtTokens;
  return usage;
}

export function costOf(usage,price){
  if(!price?.known)return null;
  const cached=Math.min(number(usage.cachedTokens),number(usage.inputTokens));
  return ((number(usage.inputTokens)-cached)*price.inputPerMTok+cached*price.cachedInputPerMTok+(number(usage.outputTokens)+number(usage.thoughtTokens))*price.outputPerMTok)/1e6;
}

const emptyTotals=()=>({calls:0,inputTokens:0,outputTokens:0,thoughtTokens:0,cachedTokens:0,costUsd:0,energyWh:0,co2eG:0,waterMl:0,modelMs:0});

// Registre d'une exécution : un appel modèle = une ligne attribuée à un rôle.
export function createUsageLedger({model,simulated=false,at=new Date(),priceOverride}={}){
  const price=simulated?{known:true,model:'simulated',currency:PRICING.currency,inputPerMTok:0,outputPerMTok:0,cachedInputPerMTok:0,source:'simulated'}:priceFor(model,at,priceOverride);
  const byAgent={};let costKnown=price.known;
  function record(agent,usage={},modelMs=0){
    if(!ROLES.includes(agent))throw new Error('Rôle inconnu pour la mesure.');
    const row=byAgent[agent]||=emptyTotals();
    row.calls++;for(const key of ['inputTokens','outputTokens','thoughtTokens','cachedTokens'])row[key]+=number(usage[key]);
    const cost=costOf(usage,price);if(cost===null)costKnown=false;else row.costUsd+=cost;
    if(!simulated){row.energyWh+=FOOTPRINT.energyWh;row.co2eG+=FOOTPRINT.co2eG;row.waterMl+=FOOTPRINT.waterMl;}
    row.modelMs+=number(modelMs);
  }
  function snapshot(){
    const total=emptyTotals(),agents={};
    for(const [agent,row] of Object.entries(byAgent)){
      agents[agent]={...row,costUsd:costKnown?round(row.costUsd,8):null,energyWh:round(row.energyWh,4),co2eG:round(row.co2eG,4),waterMl:round(row.waterMl,4),modelMs:Math.round(row.modelMs)};
      for(const key of Object.keys(total))total[key]+=row[key];
    }
    return {simulated,model:simulated?'simulated':model,byAgent:agents,
      total:{...total,costUsd:costKnown?round(total.costUsd,8):null,energyWh:round(total.energyWh,4),co2eG:round(total.co2eG,4),waterMl:round(total.waterMl,4),modelMs:Math.round(total.modelMs)},
      pricing:price,footprint:simulated?{...FOOTPRINT,energyWh:0,co2eG:0,waterMl:0,assurance:'simulated_no_model_call'}:FOOTPRINT};
  }
  return {record,snapshot};
}

// Rang le plus proche : p95 = valeur sous laquelle se terminent 95 % des observations.
export function percentile(values,p){
  const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);
  if(!sorted.length)return null;
  return sorted[Math.min(sorted.length-1,Math.max(0,Math.ceil(p/100*sorted.length)-1))];
}
export function summarize(values){
  const list=values.filter(Number.isFinite);
  if(!list.length)return {count:0,p50:null,p95:null,p99:null,max:null,mean:null};
  return {count:list.length,p50:percentile(list,50),p95:percentile(list,95),p99:percentile(list,99),max:Math.max(...list),mean:Math.round(list.reduce((a,b)=>a+b,0)/list.length)};
}

// Latences HTTP en mémoire (fenêtre glissante), par route normalisée.
export function routeKey(method,pathname){
  return method+' '+pathname.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,':id').replace(/\/[a-f0-9]{18}(?=\/|$)/g,'/:doc');
}
export function createLatencyRecorder({size=5000}={}){
  const samples=[];
  return {
    record(route,ms,status){samples.push({route,ms:Math.round(ms*10)/10,status,at:Date.now()});if(samples.length>size)samples.splice(0,samples.length-size);},
    summary(){
      const groups=new Map();for(const sample of samples){const group=groups.get(sample.route)||[];group.push(sample);groups.set(sample.route,group);}
      return [...groups].map(([route,list])=>({route,...summarize(list.map(item=>item.ms)),errors:list.filter(item=>item.status>=500).length})).sort((a,b)=>b.count-a.count);
    },
  };
}

// Journal des exécutions terminées, sans contenu : une ligne JSON par exécution.
export function runRecord(run){
  const tasks=(run.tasks||[]).filter(task=>task.status!=='not_used').map(task=>({agent:task.agent,status:task.status,durationMs:Number.isFinite(task.durationMs)?task.durationMs:null}));
  const durationMs=run.startedAt&&run.finishedAt?Date.parse(run.finishedAt)-Date.parse(run.startedAt):null;
  return {runId:run.id,kind:run.kind,status:run.status,errorCode:run.error?.code||null,startedAt:run.startedAt,finishedAt:run.finishedAt,durationMs,tasks,
    evidenceCount:run.evidenceCount||0,verifiedClaimCount:run.verifiedClaimCount||0,simulated:Boolean(run.usage?.simulated),model:run.usage?.model||null,
    usage:run.usage?{total:run.usage.total,byAgent:run.usage.byAgent}:null};
}

export async function createMetricsLog({storageDirectory,limit=5000}){
  const directory=path.join(storageDirectory,'metrics'),file=path.join(directory,'runs.jsonl');
  await fs.mkdir(directory,{recursive:true});
  let records=[];
  try{records=(await fs.readFile(file,'utf8')).split('\n').filter(Boolean).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}}).slice(-limit);}catch(error){if(error.code!=='ENOENT')throw error;}
  let writes=Promise.resolve();
  return {
    append(run){const record=runRecord(run);records.push(record);if(records.length>limit)records.shift();writes=writes.catch(()=>{}).then(()=>fs.appendFile(file,JSON.stringify(record)+'\n'));return writes;},
    records(){return records.slice();},
    async close(){await writes.catch(()=>{});},
  };
}

export function aggregateRuns(records){
  const finished=records.filter(record=>record.finishedAt);
  const byKind={};
  for(const kind of ['chat','thematic']){
    const list=finished.filter(record=>record.kind===kind);
    const completed=list.filter(record=>record.status==='completed');
    byKind[kind]={runs:list.length,completed:completed.length,failed:list.filter(r=>r.status==='failed').length,cancelled:list.filter(r=>r.status==='cancelled').length,
      duration:summarize(completed.map(record=>record.durationMs))};
  }
  const agents={};
  for(const role of ROLES){
    const durations=finished.flatMap(record=>record.tasks.filter(task=>task.agent===role&&task.status==='completed').map(task=>task.durationMs));
    const usage=emptyTotals();let costKnown=true;
    for(const record of finished){const row=record.usage?.byAgent?.[role];if(!row)continue;for(const key of Object.keys(usage))usage[key]+=row[key]||0;if(row.costUsd===null)costKnown=false;}
    agents[role]={duration:summarize(durations),...usage,costUsd:costKnown?round(usage.costUsd,8):null,energyWh:round(usage.energyWh,4),co2eG:round(usage.co2eG,4),waterMl:round(usage.waterMl,4)};
  }
  const totals=emptyTotals();let costKnown=true;
  for(const record of finished){const row=record.usage?.total;if(!row)continue;for(const key of Object.keys(totals))totals[key]+=row[key]||0;if(row.costUsd===null)costKnown=false;}
  return {runs:finished.length,simulatedRuns:finished.filter(record=>record.simulated).length,since:finished[0]?.startedAt||null,byKind,agents,
    totals:{...totals,costUsd:costKnown?round(totals.costUsd,8):null,energyWh:round(totals.energyWh,4),co2eG:round(totals.co2eG,4),waterMl:round(totals.waterMl,4)}};
}
