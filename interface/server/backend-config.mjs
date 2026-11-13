import {promises as fs} from 'node:fs';
import path from 'node:path';
import {parseEnv} from 'node:util';
export async function loadBackendConfig({projectRoot,storageDirectory,env=process.env}={}){
  let settings={};try{settings=JSON.parse(await fs.readFile(path.join(storageDirectory,'backend-settings.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw new Error('Configuration locale du backend invalide.');}
  const environmentFile=env.FOLIO_ENV_FILE||settings.environmentFile||path.join(projectRoot,'.env');
  let values={};try{values=parseEnv(await fs.readFile(environmentFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw new Error('Le fichier de configuration du backend est illisible.');}
  const read=name=>env[name]??values[name];
  const model=read('FOLIO_GEMINI_MODEL')||'gemini-2.5-flash';if(!/^[a-zA-Z0-9._-]{1,100}$/.test(model))throw new Error('Nom de modèle invalide.');
  return {projectRoot,storageDirectory,python:env.FOLIO_PYTHON||settings.pythonExecutable||'python',disabled:env.FOLIO_DISABLE_AI==='1',apiKey:env.FOLIO_DISABLE_AI==='1'?'':(read('GOOGLE_API_KEY')||read('GEMINI_API_KEY')||read('GOOGLE_API')||''),model,environmentFile,qdrantUrl:read('QDRANT_URL')||'http://127.0.0.1:6333',timeoutMs:180000};
}
