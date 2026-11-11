import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createAppStore} from './app-store.mjs';
import {extractMemories,boundedContext} from './chat-memory.mjs';
async function fixture(t,legacy=[]){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'folio-sessions-'));
  const projectRoot=path.join(directory,'project'),storageDirectory=path.join(directory,'data');
  for(const folder of ['data/rag-data/markdown/meta','data/rag-data/markdown/google','data/rag-data/pdfs/meta'])await fs.mkdir(path.join(projectRoot,folder),{recursive:true});
  await fs.writeFile(path.join(projectRoot,'data/rag-data/markdown/meta/meta 10-k 2024.md'),'# Meta 2024\n\nDocument financier local.');
  await fs.writeFile(path.join(projectRoot,'data/rag-data/markdown/google/google 10-k 2024.md'),'# Google 2024\n\nDocument financier local.');
  await fs.writeFile(path.join(projectRoot,'data/rag-data/pdfs/meta/meta 10-k 2024.pdf'),'%PDF-1.4\nfixture');
  await fs.writeFile(path.join(projectRoot,'data/rag-data/pdfs/meta/meta 10-q q2 2025.pdf'),'%PDF-1.4\nfixture');
  await fs.mkdir(storageDirectory,{recursive:true});await fs.writeFile(path.join(storageDirectory,'missions.json'),JSON.stringify(legacy));
  const config={projectRoot,storageDirectory},store=await createAppStore(config);
  t.after(async()=>{await store.close();assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(directory,{recursive:true,force:true});});return {store,config,storageDirectory};
}
test('Bibliothèque par entreprise, PDF et texte regroupés sans exposer les chemins',async t=>{
  const {store}=await fixture(t),view=store.overview();assert.deepEqual(view.companies,['google','meta']);assert.equal(view.documents.length,3);
  const doc=view.documents.find(doc=>doc.name==='meta 10-k 2024');assert.equal(doc.hasPdf,true);assert.equal(doc.hasText,true);assert.equal(doc.pdf,undefined);assert.equal(doc.text,undefined);assert.equal(store.document('../.env'),undefined);
});
test('Le chat conserve plusieurs messages sans fabriquer de réponse ni de citation',async t=>{
  const {store}=await fixture(t),thread=await store.createThread();
  await store.addMessage(thread.id,'Bonjour, je veux comprendre les résultats de Meta.');await store.addMessage(thread.id,'Quelle période devrais-je examiner ?');
  const current=store.getThread(thread.id);assert.equal(current.messages.length,2);assert.ok(current.messages.every(message=>message.role==='user'));assert.equal(current.backendConnected,false);assert.deepEqual(current.citations,[]);assert.equal(store.overview().backend.citationsEnabled,false);assert.notEqual(current.title,'Nouvelle conversation');
});
test('La mémoire reconnaît les formulations accentuées et évite les doublons',()=>{
  const notes=extractMemories('Priorité : examiner les données annuelles. Je préfère les tableaux comparatifs.','message');assert.equal(notes.length,2);assert.equal(extractMemories('Je préfère les tableaux comparatifs.','next',notes).length,0);assert.ok(notes.every(note=>note.method==='local_rules'));
});
test('L’importance est déduite des points retenus mais reste modifiable',async t=>{
  const {store}=await fixture(t),thread=await store.createThread();await store.addMessage(thread.id,'Mon objectif est de comparer Meta et Google.');assert.equal(store.getThread(thread.id).effectivePriority,'important');await store.updateThread(thread.id,{priority:'normal'});assert.equal(store.getThread(thread.id).effectivePriority,'normal');await store.updateThread(thread.id,{priority:'essential'});assert.equal(store.getThread(thread.id).effectivePriority,'essential');
});
test('Un changement invalide ne modifie pas partiellement le titre du chat',async t=>{
  const {store}=await fixture(t),thread=await store.createThread({title:'Titre original'});await assert.rejects(store.updateThread(thread.id,{title:'Ne doit pas être conservé',priority:'invalid'}),error=>error.status===400);assert.equal(store.getThread(thread.id).title,'Titre original');
});
test('Les notes manuelles peuvent être corrigées et oubliées',async t=>{
  const {store}=await fixture(t),thread=await store.createThread();let current=await store.addMemory(thread.id,{text:'Comparer les exercices annuels.'});const note=current.memory[0];current=await store.updateMemory(thread.id,note.id,{text:'Comparer seulement 2024.'});assert.equal(current.memory[0].text,'Comparer seulement 2024.');assert.equal(current.memory[0].pinned,true);await store.deleteMemory(thread.id,note.id);assert.equal(store.getThread(thread.id).memory.length,0);assert.equal(store.context(thread.id).memory.length,0);
});
test('Retenir un message ne crée pas de doublon avec la même note repérée',async t=>{
  const {store}=await fixture(t),thread=await store.createThread();const response=await store.addMessage(thread.id,'Je veux conserver les résultats annuels.');const message=response.thread.messages[0];await store.addMemory(thread.id,{text:message.content,sourceMessageId:message.id});const current=store.getThread(thread.id);assert.equal(current.memory.length,1);assert.equal(current.memory[0].pinned,true);
});
test('Une session thématique est séparée et ne reprend que les mémoires choisies',async t=>{
  const {store}=await fixture(t),a=await store.createThread({title:'Meta'}),b=await store.createThread({title:'Google'});await store.addMemory(a.id,{text:'Objectif Meta retenu.'});await store.addMemory(b.id,{text:'Objectif Google non partagé.'});const theme=await store.createThread({kind:'thematic',theme:'Rentabilité',sourceThreadIds:[a.id]});assert.equal(theme.messages.length,0);assert.equal(theme.linkedNotes.length,1);assert.match(theme.linkedNotes[0].text,/Meta/);assert.doesNotMatch(JSON.stringify(store.context(theme.id)),/Google/);await store.addMessage(theme.id,'Préparer un résumé annuel.');assert.equal(store.getThread(a.id).messages.length,0);
});
test('Supprimer un chat supprime sa mémoire et ses liens thématiques, même après redémarrage',async t=>{
  const {store,config,storageDirectory}=await fixture(t),chat=await store.createThread();await store.addMemory(chat.id,{text:'NOTE_PRIVEE_A_EFFACER'});const theme=await store.createThread({kind:'thematic',theme:'Risques',sourceThreadIds:[chat.id]});await store.deleteThread(chat.id);assert.throws(()=>store.getThread(chat.id),error=>error.status===404);assert.deepEqual(store.getThread(theme.id).linkedNotes,[]);assert.deepEqual(store.getThread(theme.id).sourceThreadIds,[]);assert.doesNotMatch(JSON.stringify(store.context(theme.id)),/NOTE_PRIVEE/);await store.close();const reopened=await createAppStore(config);try{assert.equal(reopened.overview().threads.length,1);assert.doesNotMatch(await fs.readFile(path.join(storageDirectory,'conversations.json'),'utf8'),/NOTE_PRIVEE/);}finally{await reopened.close();}
});
test('Supprimer une session thématique conserve les chats associés',async t=>{
  const {store}=await fixture(t),chat=await store.createThread();const theme=await store.createThread({kind:'thematic',theme:'Investissements',sourceThreadIds:[chat.id]});await store.deleteThread(theme.id);assert.equal(store.getThread(chat.id).id,chat.id);
});
test('Le contexte reste borné tout en conservant les derniers échanges',()=>{
  const thread={memory:Array.from({length:20},(_,i)=>({text:String(i).padEnd(450,'x'),weight:1,pinned:false,createdAt:String(i)})),messages:Array.from({length:12},(_,i)=>({role:'user',content:String(i).padEnd(5000,'m')}))};const context=boundedContext(thread);assert.ok(context.memory.length<=8);assert.ok(context.memory.reduce((n,note)=>n+note.text.length,0)<=3200);assert.ok(context.recentMessages.length<=8);assert.ok(context.recentMessages.reduce((n,message)=>n+message.content.length,0)<=16000);assert.ok(context.recentMessages.at(-1).content.startsWith('11'));
});
test('Le tri de mémoire protège les notes retenues manuellement',async t=>{
  const {store}=await fixture(t),chat=await store.createThread();await store.addMemory(chat.id,{text:'Point manuel à conserver.'});for(let i=0;i<16;i++)await store.addMessage(chat.id,'Important : conserver le point numéro '+i+'.');const current=store.getThread(chat.id);assert.ok(current.memory.some(note=>note.text==='Point manuel à conserver.'));assert.ok(current.memory.filter(note=>note.method==='local_rules'&&!note.pinned).length<=12);
});
test('La migration conserve les questions, sans citations, et ne réimporte pas un chat supprimé',async t=>{
  const legacy=[{id:'ancien-chat',kind:'documentary',query:'Je veux comprendre Meta.',title:'Question conservée',createdAt:new Date().toISOString(),demo:false,report:'Un ancien résultat avec sources'}];const {store,config,storageDirectory}=await fixture(t,legacy);assert.equal(store.overview().threads.length,1);assert.equal(store.getThread('ancien-chat').messages[0].content,legacy[0].query);assert.deepEqual(store.getThread('ancien-chat').citations,[]);await store.deleteThread('ancien-chat');await store.close();const reopened=await createAppStore(config);try{assert.equal(reopened.overview().threads.length,0);assert.deepEqual(JSON.parse(await fs.readFile(path.join(storageDirectory,'missions.json'),'utf8')),legacy);}finally{await reopened.close();}
});
test('La persistance supporte les enregistrements rapprochés de plusieurs conversations',async t=>{
  const {store,config}=await fixture(t),chats=await Promise.all(Array.from({length:4},()=>store.createThread()));await Promise.all(chats.map((chat,i)=>store.addMessage(chat.id,'Message numéro '+i)));await store.close();const reopened=await createAppStore(config);try{assert.equal(reopened.overview().threads.length,4);for(const chat of chats)assert.equal(reopened.getThread(chat.id).messages.length,1);}finally{await reopened.close();}
});
test('Les validations empêchent les liens vers des sessions inconnues et les notes hors conversation',async t=>{
  const {store}=await fixture(t),a=await store.createThread(),b=await store.createThread();const message=(await store.addMessage(a.id,'Un message personnel.')).thread.messages[0];await assert.rejects(store.addMemory(b.id,{text:'Une note interdite.',sourceMessageId:message.id}),error=>error.status===404);await assert.rejects(store.createThread({kind:'thematic',theme:'Test',sourceThreadIds:['unknown']}),error=>error.status===400);await assert.rejects(store.addMessage(a.id,' '.repeat(5)),error=>error.status===400);assert.equal(store.overview().threads.length,2);
});

test('Le contexte ne répète pas les mêmes points provenant de plusieurs conversations',()=>{
  const note={text:'Conserver les exercices annuels.',type:'preference',weight:2,pinned:false,createdAt:new Date().toISOString()};
  const context=boundedContext({memory:[note],messages:[]},[{...note,sourceThreadId:'other'}]);assert.equal(context.memory.length,1);
});
