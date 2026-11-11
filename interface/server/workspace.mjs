import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { buildIndex,searchIndex,createDocumentaryReport } from './retrieval.mjs';

export const phases=[
  {name:'Définir le périmètre',agent:'Préparation',detail:'Lecture de la demande et des sources sélectionnées.'},
  {name:'Rechercher les passages',agent:'Recherche documentaire',detail:'Classement lexical des passages du corpus local.'},
  {name:'Rassembler les références',agent:'Références',detail:'Association de chaque extrait à son document et à sa page, si disponible.'},
  {name:'Enregistrer le dossier',agent:'Publication',detail:'Création du rapport documentaire et de ses références.'},
];
async function walk(directory,extension){
  const entries=await fs.readdir(directory,{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
  return (await Promise.all(entries.map(entry=>entry.isDirectory()?walk(path.join(directory,entry.name),extension):entry.name.toLowerCase().endsWith(extension)?[path.join(directory,entry.name)]:[]))).flat().sort();
}
export async function createWorkspace({projectRoot,storageDirectory}){
  const files=await walk(path.join(projectRoot,'data/rag-data/markdown'),'.md');
  const documents=files.map((file,index)=>{const name=path.basename(file,'.md');return {id:String(index),name,company:path.basename(path.dirname(file)),type:/10-k/.test(name)?'10-K':/10-q/.test(name)?'10-Q':'8-K',year:name.match(/20\d{2}/)?.[0]||'',file};});
  const index=await buildIndex(documents);
  const sampleFile=path.join(projectRoot,'research_outputs/kgptalkie/session2/final_report.md');
  const archiveFiles=[...await walk(path.join(projectRoot,'research_outputs'),'.md'),...await walk(path.join(projectRoot,'agent_files'),'.md')].filter(file=>['final_report.md','report.md'].includes(path.basename(file)));
  const archives=[];
  for(const file of archiveFiles){
    const report=await fs.readFile(file,'utf8'),stat=await fs.stat(file);
    const heading=report.match(/^#\s+(.+)$/m)?.[1]?.replace(/\*\*/g,'').trim();
    const title=(heading||'Dossier archivé').slice(0,160);
    const id=file===sampleFile?'example-apple-amazon':'archive-'+createHash('sha256').update(path.relative(projectRoot,file)).digest('hex').slice(0,16);
    archives.push({id,title,query:title,status:'completed',phase:4,createdAt:stat.mtime.toISOString(),demo:false,example:true,kind:'archive',sources:[],report});
  }
  await fs.mkdir(storageDirectory,{recursive:true});
  const storeFile=path.join(storageDirectory,'missions.json');
  let saved=[];try{saved=JSON.parse(await fs.readFile(storeFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!Array.isArray(saved))throw new Error('Historique de recherches invalide.');
  const runs=new Map([...archives.map(archive=>[archive.id,archive]),...saved.map(run=>[run.id,{...run,status:run.status==='running'?'interrupted':run.status}])]);
  let writes=Promise.resolve();const tasks=new Set();let closed=false;
  const persist=()=>{const snapshot=JSON.stringify([...runs.values()].filter(run=>!run.example),null,2);writes=writes.catch(()=>{}).then(async()=>{await fs.writeFile(storeFile+'.tmp',snapshot);await fs.rename(storeFile+'.tmp',storeFile);});return writes;};
  const summary=run=>{const {report,sources,...rest}=run;return {...rest,sourceCount:sources?.length||0};};
  async function execute(run,options){
    const advance=async phase=>{await nextTurn();if(closed||run.status!=='running')return false;run.phase=phase;run.steps.push({phase,at:new Date().toISOString()});return true;};
    try{
      if(!await advance(1))return;
      const result=searchIndex(index,documents,run.query,options);
      if(!await advance(2))return;
      run.sources=result.sources;run.searchedDocuments=result.searchedDocuments;run.totalMatches=result.totalMatches;
      if(!await advance(3))return;
      const report=createDocumentaryReport(run,result);
      if(!await advance(4))return;
      run.report=report;run.status='completed';run.finishedAt=new Date().toISOString();await persist();
    }catch(error){run.status='failed';run.error='La recherche n’a pas pu être terminée.';console.error(error.message);await persist().catch(err=>console.error(err.message));}
  }
  return {
    overview(){return {mode:'local',engineConnected:true,aiConnected:false,documents:documents.map(({file,...doc})=>doc),missions:[...runs.values()].map(summary).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)),phases,companies:[...new Set(documents.map(doc=>doc.company))],reportCount:[...runs.values()].filter(run=>run.status==='completed'&&!run.demo).length,indexedPassages:index.chunks.length};},
    document(id){return documents.find(doc=>doc.id===id);},run(id){return runs.get(id);},
    async create(query,{depth='deep',documentIds=[]}={}){
      if(closed){const error=new Error('Le moteur est en cours d’arrêt.');error.status=503;throw error;}
      if(typeof query!=='string'||query.trim().length<5||query.trim().length>4000){const error=new Error('La demande doit contenir entre 5 et 4 000 caractères.');error.status=400;throw error;}
      if(!['brief','deep'].includes(depth)||!Array.isArray(documentIds)||documentIds.length>documents.length||documentIds.some(id=>typeof id!=='string'||!documents.some(doc=>doc.id===id))){const error=new Error('Les paramètres de recherche sont invalides.');error.status=400;throw error;}
      if([...runs.values()].filter(run=>run.status==='running').length>=3){const error=new Error('Trois recherches sont déjà en cours.');error.status=429;throw error;}
      const clean=query.trim();const run={id:randomUUID(),title:clean.length>72?clean.slice(0,69)+'…':clean,query:clean,status:'running',phase:0,createdAt:new Date().toISOString(),demo:false,kind:'documentary',depth,documentIds:[...new Set(documentIds)],sources:[],steps:[{phase:0,at:new Date().toISOString()}],report:''};
      runs.set(run.id,run);await persist();const task=execute(run,{depth,documentIds:run.documentIds});tasks.add(task);task.finally(()=>tasks.delete(task));return run;
    },
    async cancel(id){const run=runs.get(id);if(!run)return null;if(run.status==='running'){run.status='cancelled';await persist();}return run;},
    async close(){closed=true;for(const run of runs.values())if(run.status==='running')run.status='interrupted';await Promise.allSettled([...tasks]);await persist();await writes;},
  };
}
