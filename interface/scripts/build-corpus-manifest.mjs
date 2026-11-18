// Produit data/rag-data/manifest.json : empreinte SHA-256 de chaque rapport servi (Markdown et PDF).
// Action humaine explicite, à lancer seulement après revue des rapports ajoutés ou remplacés ; le serveur refuse
// ensuite tout fichier absent du manifeste ou dont l'empreinte diffère.
//   node scripts/build-corpus-manifest.mjs            écrit le manifeste
//   node scripts/build-corpus-manifest.mjs --check    compare le corpus au manifeste existant, sans rien écrire
//   node scripts/build-corpus-manifest.mjs --flagged  liste les fragments que le filtre d'ingestion écarterait (à examiner)
import path from 'node:path';
import {promises as fs} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {buildManifest,verifyCorpus,readScreenReview,MANIFEST_FILE} from '../server/corpus-integrity.mjs';
import {buildIndex} from '../server/retrieval.mjs';
import {screenUntrustedText} from '../server/injection-screen.mjs';

const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const mode=process.argv[2]||'--write';

if(mode==='--check'){
  const report=await verifyCorpus({projectRoot});
  console.log(JSON.stringify({manifest:report.manifest,summary:report.summary,issues:report.files.filter(file=>file.status!=='verified').map(({path:file,status,duplicateOf})=>({file,status,duplicateOf}))},null,2));
  process.exitCode=report.summary.altered||report.summary.unlisted||report.summary.missing?1:0;
}else if(mode==='--flagged'){
  const report=await verifyCorpus({projectRoot}),review=await readScreenReview(projectRoot);
  const docs=report.files.filter(file=>/\.md$/i.test(file.path)&&['verified','unverified'].includes(file.status)).map(file=>({id:file.path,name:file.path,company:'',year:'',type:'',file:file.absolute}));
  const index=await buildIndex(docs,{screen:screenUntrustedText,reviewed:new Set(review.chunks.map(item=>item.sha256))});
  console.log(JSON.stringify({chunks:index.chunks.length,flagged:index.quarantined.length,reviewedKept:index.reviewedKept,flaggedChunks:index.quarantined},null,2));
}else{
  const manifest=await buildManifest(projectRoot);
  await fs.writeFile(path.join(projectRoot,MANIFEST_FILE),JSON.stringify(manifest,null,1)+'\n');
  const report=await verifyCorpus({projectRoot});
  console.log(`Manifeste écrit : ${manifest.files.length} fichiers. Vérification : ${JSON.stringify(report.summary)}.`);
  for(const file of report.files.filter(item=>item.status==='duplicate'))console.log(`Doublon exclu au chargement : ${file.path} (identique à ${file.duplicateOf}).`);
}
