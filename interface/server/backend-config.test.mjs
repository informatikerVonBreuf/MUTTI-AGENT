import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadBackendConfig} from './backend-config.mjs';
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'folio-config-'));t.after(async()=>{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(root,{recursive:true,force:true});});return {root,projectRoot:root,storageDirectory:root};}
test('Configuration : ancien nom de clé, priorité environnement et désactivation des tests',async t=>{
  const options=await fixture(t);await fs.writeFile(path.join(options.root,'.env'),'GOOGLE_API="FAKE_OLD_KEY"\nFOLIO_GEMINI_MODEL=gemini-2.5-flash\n');
  assert.equal((await loadBackendConfig({...options,env:{}})).apiKey,'FAKE_OLD_KEY');
  assert.equal((await loadBackendConfig({...options,env:{GOOGLE_API_KEY:'FAKE_NEW_KEY'}})).apiKey,'FAKE_NEW_KEY');
  assert.equal((await loadBackendConfig({...options,env:{FOLIO_DISABLE_AI:'1'}})).apiKey,'');
});
test('Un pointeur local sélectionne le fichier privé et le bon interpréteur',async t=>{
  const options=await fixture(t),environmentFile=path.join(options.root,'private.env');await fs.writeFile(environmentFile,'GEMINI_API_KEY=FAKE_PRIVATE_KEY');
  await fs.writeFile(path.join(options.root,'backend-settings.json'),JSON.stringify({environmentFile,pythonExecutable:'custom-python'}));
  const config=await loadBackendConfig({...options,env:{}});assert.equal(config.apiKey,'FAKE_PRIVATE_KEY');assert.equal(config.python,'custom-python');
});
test('Un nom de modèle permettant de modifier le chemin distant est refusé',async t=>{
  const options=await fixture(t);await assert.rejects(loadBackendConfig({...options,env:{FOLIO_GEMINI_MODEL:'../../other?key=invalid'}}),/Nom de modèle invalide/);
});
