// Intégrité du corpus (défense contre l'empoisonnement documentaire) : chaque rapport chargé doit figurer dans le
// manifeste approuvé (data/rag-data/manifest.json, versionné) avec la même empreinte SHA-256. Un fichier modifié,
// ajouté sans revue ou dupliqué n'entre ni dans la bibliothèque, ni dans l'index, ni dans la route PDF.
// Le manifeste n'est produit que par interface/scripts/build-corpus-manifest.mjs, action humaine explicite.
import {createHash} from 'node:crypto';
import {createReadStream,promises as fs} from 'node:fs';
import path from 'node:path';

export const MANIFEST_FILE='data/rag-data/manifest.json';
export const REVIEW_FILE='data/rag-data/screen-review.json';
const toPosix=value=>value.split(path.sep).join('/');

// Les rapports Markdown sont du texte : Git peut changer leurs fins de ligne selon la machine (CRLF sous Windows avec
// core.autocrlf, LF ailleurs). Leur empreinte porte donc sur le texte ramené à LF ; les PDF, binaires, sur leurs octets.
export const isTextFile=file=>/\.md$/i.test(file);
export const textBytes=bytes=>Buffer.from(Buffer.from(bytes).toString('utf8').replace(/\r\n/g,'\n'),'utf8');
export const hashBytes=(file,bytes)=>createHash('sha256').update(isTextFile(file)?textBytes(bytes):bytes).digest('hex');
export function hashFile(file){
  if(isTextFile(file))return fs.readFile(file).then(bytes=>hashBytes(file,bytes));
  return new Promise((resolve,reject)=>{const hash=createHash('sha256');createReadStream(file).on('error',reject).on('data',chunk=>hash.update(chunk)).on('end',()=>resolve(hash.digest('hex')));});
}
async function walk(directory){const entries=await fs.readdir(directory,{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error;});return (await Promise.all(entries.map(entry=>entry.isDirectory()?walk(path.join(directory,entry.name)):[path.join(directory,entry.name)]))).flat();}

// Fichiers servis à l'exécution : rapports Markdown (texte indexé) et PDF (lecteur). Les tables et images ne sont lues que par les notebooks.
export async function listCorpusFiles(projectRoot){
  const base=path.join(projectRoot,'data/rag-data');
  const markdown=(await walk(path.join(base,'markdown'))).filter(file=>/\.md$/i.test(file));
  const pdfs=(await walk(path.join(base,'pdfs'))).filter(file=>/\.pdf$/i.test(file));
  return [...markdown,...pdfs].map(file=>({absolute:file,path:toPosix(path.relative(base,file))})).sort((a,b)=>a.path.localeCompare(b.path));
}
export async function buildManifest(projectRoot,{now=new Date()}={}){
  const files=[];for(const file of await listCorpusFiles(projectRoot)){const stat=await fs.stat(file.absolute);files.push({path:file.path,sha256:await hashFile(file.absolute),bytes:stat.size});}
  return {version:1,algorithm:'sha256',generatedAt:now.toISOString(),source:'Rapports publics SEC (10-K, 10-Q, 8-K)',files};
}
export async function readManifest(projectRoot){
  let raw;try{raw=await fs.readFile(path.join(projectRoot,MANIFEST_FILE),'utf8');}catch(error){if(error.code==='ENOENT')return null;throw error;}
  const manifest=JSON.parse(raw);
  if(manifest?.version!==1||manifest.algorithm!=='sha256'||!Array.isArray(manifest.files)||manifest.files.some(file=>typeof file?.path!=='string'||!/^[a-f0-9]{64}$/.test(file.sha256||'')))throw new Error('Manifeste du corpus invalide.');
  return {manifest,manifestHash:createHash('sha256').update(raw).digest('hex')};
}
// Revue humaine des faux positifs du filtre d'ingestion : seule l'empreinte exacte d'un fragment examiné est acceptée.
export async function readScreenReview(projectRoot){
  let raw;try{raw=await fs.readFile(path.join(projectRoot,REVIEW_FILE),'utf8');}catch(error){if(error.code==='ENOENT')return {chunks:[]};throw error;}
  const review=JSON.parse(raw);if(!Array.isArray(review?.chunks)||review.chunks.some(item=>!/^[a-f0-9]{64}$/.test(item?.sha256||'')||item.decision!=='benign'))throw new Error('Revue d’ingestion invalide.');
  return review;
}

// Statuts : verified, altered (empreinte différente), unlisted (absent du manifeste), missing (absent du disque), duplicate (même contenu qu'un fichier déjà vérifié).
export async function verifyCorpus({projectRoot,manifest=undefined}={}){
  const loaded=manifest===undefined?await readManifest(projectRoot):manifest?{manifest,manifestHash:createHash('sha256').update(JSON.stringify(manifest)).digest('hex')}:null;
  const expected=new Map((loaded?.manifest.files||[]).map(file=>[file.path,file])),seen=new Map(),files=[];
  // Entre deux copies identiques, le nom le plus court (canonique, ex. sans « copy ») est conservé.
  const ordered=(await listCorpusFiles(projectRoot)).sort((a,b)=>a.path.length-b.path.length||a.path.localeCompare(b.path));
  for(const file of ordered){
    const stat=await fs.stat(file.absolute),sha256=await hashFile(file.absolute),entry=expected.get(file.path);
    let status=!loaded?'unverified':!entry?'unlisted':entry.sha256!==sha256?'altered':'verified';
    if(status==='verified'||status==='unverified'){if(seen.has(sha256))status='duplicate';else seen.set(sha256,file.path);}
    files.push({path:file.path,absolute:file.absolute,status,sha256,bytes:stat.size,mtimeMs:stat.mtimeMs,...(status==='duplicate'?{duplicateOf:seen.get(sha256)}:{})});
    expected.delete(file.path);
  }
  for(const entry of expected.values())files.push({path:entry.path,absolute:null,status:'missing',sha256:entry.sha256,bytes:entry.bytes});
  files.sort((a,b)=>a.path.localeCompare(b.path));
  const summary={verified:0,altered:0,unlisted:0,missing:0,duplicate:0,unverified:0};for(const file of files)summary[file.status]++;
  return {manifest:loaded?'present':'absent',manifestHash:loaded?.manifestHash||null,files,summary,checkedAt:new Date().toISOString()};
}

// Contrôle à l'exécution : toujours l'empreinte complète (une date de modification se restaure). Les fichiers servis sont
// vérifiés sur les octets mêmes qui seront envoyés (readVerified) : aucun écart entre contrôle et usage.
export function createIntegrityGuard(report){
  const known=new Map(report.files.filter(file=>file.absolute&&(file.status==='verified'||file.status==='unverified')).map(file=>[path.resolve(file.absolute),file])),altered=new Map();
  const expected=absolute=>known.get(path.resolve(absolute))?.sha256||null;
  const mark=(absolute,status)=>{altered.set(path.resolve(absolute),status);return false;};
  return {
    expected,
    async check(absolute){
      const key=path.resolve(absolute),file=known.get(key);if(!file||altered.has(key))return false;
      const sha256=await hashFile(key).catch(()=>null);
      return sha256===file.sha256?true:mark(key,sha256?'altered':'missing');
    },
    verifyBytes(absolute,bytes){const key=path.resolve(absolute),file=known.get(key);if(!file||altered.has(key))return false;return hashBytes(key,bytes)===file.sha256||mark(key,'altered');},
    async readVerified(absolute){let bytes;try{bytes=await fs.readFile(absolute);}catch{mark(absolute,'missing');return null;}return this.verifyBytes(absolute,bytes)?bytes:null;},
    altered(){return [...altered].map(([absolute,status])=>({path:known.get(absolute)?.path||absolute,status}));},
  };
}
