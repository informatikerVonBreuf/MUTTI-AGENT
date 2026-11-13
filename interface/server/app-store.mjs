import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { extractMemories,effectivePriority,boundedContext } from './chat-memory.mjs';
import {createRagPreparation} from './rag-preparation.mjs';
import {buildAgentPlan,RAG_POLICY} from './agent-policies.mjs';
const fail=(message,status=400)=>{const error=new Error(message);error.status=status;throw error;};
async function walk(directory){const entries=await fs.readdir(directory,{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error;});return (await Promise.all(entries.map(entry=>entry.isDirectory()?walk(path.join(directory,entry.name)):[path.join(directory,entry.name)]))).flat().sort();}
const key=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const trim=(value,min,max,label)=>{if(typeof value!=='string'||value.trim().length<min||value.trim().length>max)fail(label);return value.trim();};

export async function createAppStore({projectRoot,storageDirectory,backendState=()=>({connected:false,citationsEnabled:false})}){
  const markdown=await walk(path.join(projectRoot,'data/rag-data/markdown'));
  const pdfs=await walk(path.join(projectRoot,'data/rag-data/pdfs'));
  const grouped=new Map();
  for(const file of [...markdown.filter(file=>/\.md$/i.test(file)),...pdfs.filter(file=>/\.pdf$/i.test(file))]){
    const company=path.basename(path.dirname(file)).toLowerCase(),name=path.basename(file,path.extname(file));
    const identity=company+'/'+key(name);let doc=grouped.get(identity);
    if(!doc){doc={id:createHash('sha256').update(identity).digest('hex').slice(0,18),name,company,type:/10-k/i.test(name)?'10-K':/10-q/i.test(name)?'10-Q':'8-K',year:name.match(/20\d{2}/)?.[0]||''};grouped.set(identity,doc);}
    if(/\.pdf$/i.test(file))doc.pdf=file;else doc.text=file;
  }
  const documents=[...grouped.values()].sort((a,b)=>a.company.localeCompare(b.company)||b.year.localeCompare(a.year)||a.name.localeCompare(b.name));
  const companies=[...new Set(documents.map(doc=>doc.company))];
  const prepareRag=createRagPreparation(documents);
  const validateDocuments=ids=>{if(!Array.isArray(ids)||ids.length>RAG_POLICY.maxDocuments||ids.some(id=>typeof id!=='string'||!documents.some(doc=>doc.id===id)))fail('Choisissez au plus 8 documents du corpus.');return [...new Set(ids)];};
  await fs.mkdir(storageDirectory,{recursive:true});const file=path.join(storageDirectory,'conversations.json');
  let state={version:1,threads:[],migratedLegacy:false};
  try{state=JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!Array.isArray(state.threads)||state.version!==1)throw new Error('Le fichier des conversations est invalide.');
  let writes=Promise.resolve();
  const persist=()=>{const snapshot=JSON.stringify(state,null,2);writes=writes.catch(()=>{}).then(async()=>{await fs.writeFile(file+'.tmp',snapshot);await fs.rename(file+'.tmp',file);});return writes;};
  if(!state.migratedLegacy){
    let legacy=[];try{legacy=JSON.parse(await fs.readFile(path.join(storageDirectory,'missions.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
    if(!Array.isArray(legacy))throw new Error('Historique précédent invalide.');
    for(const run of legacy.filter(run=>run.kind==='documentary'&&!run.demo&&!run.example&&typeof run.query==='string')){
      if(state.threads.some(thread=>thread.id===run.id))continue;
      const message={id:randomUUID(),role:'user',content:run.query,createdAt:run.createdAt||new Date().toISOString(),status:'saved'};
      state.threads.push({id:run.id,kind:'chat',title:run.title||run.query.slice(0,70),createdAt:message.createdAt,updatedAt:message.createdAt,messages:[message],memory:extractMemories(message.content,message.id),priority:'normal',priorityManual:false,pinned:false,sourceThreadIds:[],theme:'',imported:true});
    }
    state.migratedLegacy=true;await persist();
  }
  const threadById=id=>state.threads.find(thread=>thread.id===id);
  const requireThread=id=>threadById(id)||fail('Conversation introuvable.',404);
  const linkedNotes=thread=>thread.kind!=='thematic'?[]:thread.sourceThreadIds.flatMap(id=>{const source=threadById(id);return source?source.memory.map(note=>({...note,sourceThreadId:source.id,sourceThreadTitle:source.title})):[];});
  const serialize=thread=>({...thread,documentIds:thread.documentIds||[],agentPlan:thread.kind==='thematic'?buildAgentPlan(thread):null,effectivePriority:effectivePriority(thread),linkedNotes:linkedNotes(thread),backendConnected:backendState().connected,citations:[]});
  const summary=thread=>({runStatus:thread.lastRun?.status||null,id:thread.id,kind:thread.kind,title:thread.title,theme:thread.theme,createdAt:thread.createdAt,updatedAt:thread.updatedAt,messageCount:thread.messages.length,memoryCount:thread.memory.length,linkedMemoryCount:linkedNotes(thread).length,sourceThreadIds:thread.sourceThreadIds,effectivePriority:effectivePriority(thread),pinned:thread.pinned,documentCount:(thread.documentIds||[]).length,lastMessage:thread.messages.at(-1)?.content.slice(0,130)||''});
  const docSummary=({pdf,text,...doc})=>({...doc,hasPdf:Boolean(pdf),hasText:Boolean(text)});
  return {
    overview(){return {documents:documents.map(docSummary),companies,threads:state.threads.map(summary).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||String(b.updatedAt).localeCompare(a.updatedAt)),backend:{...backendState(),memoryMode:'local_rules',ragPreparationAvailable:true},memoryCount:state.threads.reduce((count,thread)=>count+thread.memory.length,0)};},
    document(id){return documents.find(doc=>doc.id===id);},
    getThread(id){return serialize(requireThread(id));},
    documentScope(id){const thread=requireThread(id);return thread.documentIds?.length?[...thread.documentIds]:documents.map(doc=>doc.id);},
    async setRun(id,run){const thread=requireThread(id);thread.lastRun=JSON.parse(JSON.stringify(run));await persist();return serialize(thread);},
    async recoverRuns(){let changed=false;for(const thread of state.threads){if(thread.lastRun?.status==='running'){thread.lastRun.status='interrupted';thread.lastRun.finishedAt=new Date().toISOString();thread.lastRun.error={code:'INTERRUPTED',message:'Le serveur a été redémarré. Relancez explicitement cette analyse.'};for(const task of thread.lastRun.tasks||[])if(task.status==='running')task.status='interrupted';changed=true;}}if(changed)await persist();},
    async addAssistantMessage(id,{content,citations,runId,sourceMessageId}){const thread=requireThread(id);if(thread.messages.some(message=>message.runId===runId))return serialize(thread);if(!thread.messages.some(message=>message.id===sourceMessageId&&message.role==='user'))fail('Question source introuvable.',404);if(typeof content!=='string'||!content.trim()||content.length>24000||!Array.isArray(citations)||citations.some(c=>!documents.some(doc=>doc.id===c.documentId)))fail('Réponse documentaire invalide.');thread.messages.push({id:randomUUID(),role:'assistant',content,citations,citationsVerified:true,runId,sourceMessageId,createdAt:new Date().toISOString(),status:'completed'});thread.updatedAt=new Date().toISOString();await persist();return serialize(thread);},
    context(id){const thread=requireThread(id);return boundedContext(thread,linkedNotes(thread));},
    plan(id){return buildAgentPlan(requireThread(id));},
    async prepareRag(id,question){const thread=requireThread(id);return prepareRag({question,documentIds:thread.documentIds||[],threadId:id,memory:boundedContext(thread,linkedNotes(thread)).memory});},
    async createThread({kind='chat',title,theme='',sourceThreadIds=[],documentIds=[]}={}){
      if(!['chat','thematic'].includes(kind))fail('Type de session invalide.');
      documentIds=validateDocuments(documentIds);
      if(kind==='thematic')theme=trim(theme,2,120,'Indiquez un thème de 2 à 120 caractères.');else theme='';
      if(!Array.isArray(sourceThreadIds)||sourceThreadIds.length>50||sourceThreadIds.some(id=>typeof id!=='string'||threadById(id)?.kind!=='chat'))fail('Les conversations associées sont invalides.');
      if(kind==='chat'&&sourceThreadIds.length)fail('Une conversation ordinaire ne reprend pas d’autre session.');
      const now=new Date().toISOString();
      const thread={id:randomUUID(),kind,documentIds,title:title?trim(title,1,120,'Titre invalide.'):kind==='thematic'?theme:'Nouvelle conversation',theme,sourceThreadIds:[...new Set(sourceThreadIds)],messages:[],memory:[],createdAt:now,updatedAt:now,priority:'normal',priorityManual:false,pinned:false};
      state.threads.push(thread);await persist();return serialize(thread);
    },
    async updateThread(id,patch={}){
      const original=requireThread(id),thread={...original};
      if('documentIds'in patch)thread.documentIds=validateDocuments(patch.documentIds);
      if('title'in patch)thread.title=trim(patch.title,1,120,'Le titre doit contenir entre 1 et 120 caractères.');
      if('priority'in patch){if(!['normal','important','essential'].includes(patch.priority))fail('Importance invalide.');thread.priority=patch.priority;thread.priorityManual=true;}
      if('pinned'in patch){if(typeof patch.pinned!=='boolean')fail('État d’épinglage invalide.');thread.pinned=patch.pinned;}
      if('sourceThreadIds'in patch){if(thread.kind!=='thematic'||!Array.isArray(patch.sourceThreadIds)||patch.sourceThreadIds.length>50||patch.sourceThreadIds.some(id=>threadById(id)?.kind!=='chat'))fail('Conversations associées invalides.');thread.sourceThreadIds=[...new Set(patch.sourceThreadIds)];}
      thread.updatedAt=new Date().toISOString();Object.assign(original,thread);await persist();return serialize(original);
    },
    async addMessage(id,content){
      const thread=requireThread(id);content=trim(content,1,12000,'Le message doit contenir entre 1 et 12 000 caractères.');
      const message={id:randomUUID(),role:'user',content,createdAt:new Date().toISOString(),status:'awaiting_backend'};
      thread.messages.push(message);
      const additions=extractMemories(content,message.id,thread.memory);
      const automatic=thread.memory.filter(note=>note.method==='local_rules'&&!note.pinned);
      for(const note of additions){if(automatic.length>=12){const oldest=automatic.shift();thread.memory=thread.memory.filter(item=>item.id!==oldest.id);}thread.memory.push(note);automatic.push(note);}
      if(thread.title==='Nouvelle conversation')thread.title=content.length>70?content.slice(0,67)+'…':content;
      thread.updatedAt=message.createdAt;await persist();return {thread:serialize(thread),memoryAdded:additions.length,replyStatus:'awaiting_backend'};
    },
    async addMemory(id,{text,sourceMessageId}={}){
      const thread=requireThread(id);text=trim(text,3,1000,'Le point à retenir doit contenir entre 3 et 1 000 caractères.');
      if(sourceMessageId&&!thread.messages.some(message=>message.id===sourceMessageId))fail('Message introuvable.',404);
      const existing=thread.memory.find(note=>(sourceMessageId&&note.sourceMessageId===sourceMessageId&&note.pinned)||key(note.text)===key(text));
      if(existing){existing.pinned=true;existing.method='manual';existing.weight=5;if(sourceMessageId)existing.sourceMessageId=sourceMessageId;await persist();return serialize(thread);}
      if(thread.memory.filter(note=>note.pinned||note.method==='manual').length>=50)fail('La mémoire contient déjà 50 points conservés manuellement.');
      thread.memory.push({id:randomUUID(),text,type:'retenu',weight:5,method:'manual',sourceMessageId:sourceMessageId||null,pinned:true,createdAt:new Date().toISOString()});thread.updatedAt=new Date().toISOString();await persist();return serialize(thread);
    },
    async updateMemory(id,noteId,{text}={}){const thread=requireThread(id),note=thread.memory.find(note=>note.id===noteId);if(!note)fail('Point de mémoire introuvable.',404);note.text=trim(text,3,1000,'Le point doit contenir entre 3 et 1 000 caractères.');note.method='manual';note.pinned=true;note.weight=5;thread.updatedAt=new Date().toISOString();await persist();return serialize(thread);},
    async deleteMemory(id,noteId){const thread=requireThread(id);if(!thread.memory.some(note=>note.id===noteId))fail('Point de mémoire introuvable.',404);thread.memory=thread.memory.filter(note=>note.id!==noteId);await persist();return serialize(thread);},
    async deleteThread(id){requireThread(id);state.threads=state.threads.filter(thread=>thread.id!==id);for(const thread of state.threads)thread.sourceThreadIds=thread.sourceThreadIds.filter(sourceId=>sourceId!==id);await persist();return {deleted:true,id};},
    async close(){await writes;},
  };
}
