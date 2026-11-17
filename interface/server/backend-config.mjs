import {promises as fs} from 'node:fs';
import path from 'node:path';
import {parseEnv} from 'node:util';
const positive=value=>{const parsed=Number(value);return value!==undefined&&value!==''&&Number.isFinite(parsed)&&parsed>=0?parsed:undefined;};
export async function loadBackendConfig({projectRoot,storageDirectory,env=process.env}={}){
  let settings={};try{settings=JSON.parse(await fs.readFile(path.join(storageDirectory,'backend-settings.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw new Error('Configuration locale du backend invalide.');}
  const environmentFile=env.FOLIO_ENV_FILE||settings.environmentFile||path.join(projectRoot,'.env');
  let values={};try{values=parseEnv(await fs.readFile(environmentFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw new Error('Le fichier de configuration du backend est illisible.');}
  const read=name=>env[name]??values[name];
  const model=read('FOLIO_GEMINI_MODEL')||'gemini-3.8-flash';if(!/^[a-zA-Z0-9._-]{1,100}$/.test(model))throw new Error('Nom de modèle invalide.');
  const provider=read('FOLIO_PROVIDER')||'gemini';if(!['gemini','simulated'].includes(provider))throw new Error('Fournisseur IA inconnu.');
  const simulated=provider==='simulated'&&env.FOLIO_DISABLE_AI!=='1';
  // Traçage LangSmith : désactivé par défaut, activé seulement par FOLIO_TRACING=on.
  // Entrées et sorties sont toujours masquées ; seuls structure, durées, rôles, tokens et tags partent.
  const tracingKey=read('LANGSMITH_API_KEY')||'';
  let endpoint=read('LANGSMITH_ENDPOINT')||'';
  if(endpoint){try{const parsed=new URL(endpoint);if(parsed.protocol!=='https:')throw new Error();endpoint=parsed.origin;}catch{throw new Error('Adresse LangSmith invalide : HTTPS requis.');}}
  const project=read('FOLIO_LANGSMITH_PROJECT')||'folio-dev';if(!/^[a-zA-Z0-9._-]{1,80}$/.test(project))throw new Error('Nom de projet LangSmith invalide.');
  const tracing={enabled:read('FOLIO_TRACING')==='on'&&Boolean(tracingKey),requested:read('FOLIO_TRACING')==='on',apiKey:tracingKey,project,endpoint,hideContent:true};
  const delay=positive(read('FOLIO_SIMULATED_DELAY_MS'));
  return {projectRoot,storageDirectory,python:env.FOLIO_PYTHON||settings.pythonExecutable||'python',disabled:env.FOLIO_DISABLE_AI==='1',
    apiKey:env.FOLIO_DISABLE_AI==='1'||simulated?'':(read('GOOGLE_API_KEY')||read('GEMINI_API_KEY')||read('GOOGLE_API')||''),
    provider:simulated?'simulated':'gemini',simulated,simulatedDelayMs:delay===undefined?350:Math.min(delay,10000),
    model:simulated?'simulated':model,environmentFile,qdrantUrl:read('QDRANT_URL')||'http://127.0.0.1:6333',timeoutMs:180000,tracing,
    priceOverride:{input:positive(read('FOLIO_PRICE_INPUT_PER_MTOK')),output:positive(read('FOLIO_PRICE_OUTPUT_PER_MTOK'))}};
}
