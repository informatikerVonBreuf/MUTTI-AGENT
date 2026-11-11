import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { createWorkspace } from './workspace.mjs';
async function fixture(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'folio-live-test-'));
  const projectRoot=path.join(directory,'project'),storageDirectory=path.join(directory,'store');
  for(const [company,year] of [['apple','2024'],['apple','2023'],['amazon','2024']]){
    const dir=path.join(projectRoot,'data/rag-data/markdown',company);await fs.mkdir(dir,{recursive:true});
    const pages=Array.from({length:5},(_,i)=>`# ${company} financial statements\n\n${company} annual revenue increased in fiscal ${year}. Operating income, profit margin and cash flow are reported for this period. Page marker ${i+1}.`).join('\n\n<!-- page break -->\n\n');
    await fs.writeFile(path.join(dir,`${company} 10-k ${year}.md`),pages);
  }
  const archived=path.join(projectRoot,'research_outputs/kgptalkie/session2');await fs.mkdir(archived,{recursive:true});await fs.writeFile(path.join(archived,'final_report.md'),'# ARCHIVE_SENTINEL\nUn ancien rapport indépendant.');
  const configuration={projectRoot,storageDirectory};const workspace=await createWorkspace(configuration);
  t.after(async()=>{await workspace.close();assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(directory,{recursive:true,force:true});});
  return {workspace,configuration,projectRoot};
}
async function complete(run){for(let i=0;i<100&&run.status==='running';i++)await wait(5);assert.equal(run.status,'completed');return run;}
test('Catalogue réel, mode local explicite et chemins privés',async t=>{
  const {workspace}=await fixture(t),view=workspace.overview();assert.equal(view.mode,'local');assert.equal(view.engineConnected,true);assert.equal(view.aiConnected,false);assert.equal(view.documents.length,3);assert.equal(view.indexedPassages,15);assert.equal(view.documents[0].file,undefined);assert.equal(workspace.document('../.env'),undefined);
});
test('Rejet des demandes et paramètres invalides avant création',async t=>{
  const {workspace}=await fixture(t);
  for(const query of [null,{},' ','x'.repeat(4001)])await assert.rejects(workspace.create(query),e=>e.status===400);
  for(const options of [{depth:'other'},{documentIds:['../../.env']},{documentIds:'0'}])await assert.rejects(workspace.create('Apple revenue',options),e=>e.status===400);
  assert.equal(workspace.overview().missions.length,1);
});
test('Une question française produit des extraits fidèles avec filtres entreprise et année',async t=>{
  const {workspace,projectRoot}=await fixture(t),run=await complete(await workspace.create('Quels sont les revenus d’Apple en 2024 ?'));
  assert.equal(run.demo,false);assert.equal(run.kind,'documentary');assert.ok(run.sources.length>0);assert.ok(run.sources.every(source=>source.company==='apple'&&source.year==='2024'));
  const original=await fs.readFile(path.join(projectRoot,'data/rag-data/markdown/apple/apple 10-k 2024.md'),'utf8');
  for(const source of run.sources){assert.ok(original.includes(source.excerpt));assert.ok(source.page>=1&&source.page<=5);}
  assert.match(run.report,/\[1\]/);assert.match(run.report,/aucune synthèse par un modèle IA/);assert.doesNotMatch(run.report,/ARCHIVE_SENTINEL/);
});
test('La sélection des documents contraint effectivement la recherche',async t=>{
  const {workspace}=await fixture(t),amazon=workspace.overview().documents.find(doc=>doc.company==='amazon');
  const run=await complete(await workspace.create('annual revenue',{documentIds:[amazon.id]}));assert.ok(run.sources.length>0);assert.ok(run.sources.every(source=>source.documentId===amazon.id));assert.equal(run.searchedDocuments,1);
});
test('Les formats essentiel et dossier limitent les extraits à 4 et 9',async t=>{
  const {workspace}=await fixture(t);
  const brief=await complete(await workspace.create('annual revenue',{depth:'brief'}));const deep=await complete(await workspace.create('annual revenue',{depth:'deep'}));
  assert.equal(brief.sources.length,4);assert.equal(deep.sources.length,9);
});
test('Aucun résultat ne réutilise un rapport archivé ni une réponse inventée',async t=>{
  const {workspace}=await fixture(t),run=await complete(await workspace.create('zebulon quantique inconnu'));
  assert.equal(run.sources.length,0);assert.match(run.report,/Aucun passage pertinent/);assert.doesNotMatch(run.report,/ARCHIVE_SENTINEL/);
});
test('L’arrêt interrompt le travail avant la rédaction et persiste',async t=>{
  const {workspace,configuration}=await fixture(t),run=await workspace.create('Apple revenue');await workspace.cancel(run.id);await wait(20);assert.equal(run.status,'cancelled');assert.equal(run.report,'');
  const reopened=await createWorkspace(configuration);try{assert.equal(reopened.run(run.id).status,'cancelled');}finally{await reopened.close();}
});
test('Le redémarrage conserve les références et le rapport réellement produit',async t=>{
  const {workspace,configuration}=await fixture(t),run=await complete(await workspace.create('Amazon revenus 2024'));await workspace.close();
  const reopened=await createWorkspace(configuration);try{assert.deepEqual(reopened.run(run.id).sources,run.sources);assert.equal(reopened.run(run.id).report,run.report);assert.equal(reopened.run(run.id).status,'completed');}finally{await reopened.close();}
});
test('Une fermeture en cours de recherche conserve un état interrompu',async t=>{
  const {workspace,configuration}=await fixture(t),run=await workspace.create('Apple revenue');await workspace.close();
  const reopened=await createWorkspace(configuration);try{assert.equal(reopened.run(run.id).status,'interrupted');}finally{await reopened.close();}
});
test('La limite de concurrence et les identifiants inconnus sont gérés',async t=>{
  const {workspace}=await fixture(t);
  const outcomes=await Promise.allSettled(Array.from({length:4},()=>workspace.create('Apple annual revenue')));
  assert.equal(outcomes.filter(outcome=>outcome.status==='fulfilled').length,3);assert.equal(outcomes.find(outcome=>outcome.status==='rejected').reason.status,429);assert.equal(await workspace.cancel('unknown'),null);
});

test('Les rapports préexistants sont chargés depuis les deux emplacements du projet',async t=>{
  const {configuration,projectRoot}=await fixture(t);
  const folder=path.join(projectRoot,'agent_files/user/thread');await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,'report.md'),'# Un second dossier\n\nRapport conservé.');
  const reopened=await createWorkspace(configuration);
  try{const archives=reopened.overview().missions.filter(run=>run.kind==='archive');assert.equal(archives.length,2);assert.ok(archives.some(run=>run.title==='Un second dossier'));assert.ok(archives.every(run=>!run.demo));}finally{await reopened.close();}
});
