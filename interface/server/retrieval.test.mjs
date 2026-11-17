import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildIndex,searchIndex} from './retrieval.mjs';

async function corpus(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'folio-retrieval-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const files={
    'apple 10-k 2024':'Products and services performance.\n\n| Total net sales | $ 391,035 | $ 383,285 |\n\nThe Company designs smartphones and wearables for customers worldwide.',
    'amazon 10-k 2024':'Consolidated statements of operations.\n\n| Operating income | 68,593 | 36,852 |\n\nThe Company sells products through online and physical stores worldwide.',
    'meta 10-k 2024':'Revenue by source.\n\n| Advertising | $ 160,633 | $ 131,948 |\n\n| Total revenue | $ 164,501 | $ 134,902 |\n\nOur family of apps connects billions of people.',
  };
  const documents=[];
  for(const [name,content] of Object.entries(files)){
    const company=name.split(' ')[0],file=path.join(directory,name+'.md');
    await fs.writeFile(file,content);
    documents.push({id:String(documents.length),name,company,type:'10-K',year:'2024',file});
  }
  return {documents,index:await buildIndex(documents)};
}

test('Recherche : les formes françaises courantes trouvent les passages anglais (ventes, publicitaire, opérationnel)',async t=>{
  const {documents,index}=await corpus(t);
  const first=query=>searchIndex(index,documents,query).sources[0]?.excerpt||'';
  assert.match(first('Quelles sont les ventes nettes d’Apple en 2024 ?'),/Total net sales/);
  assert.match(first('Quel est le chiffre d’affaires publicitaire de Meta en 2024 ?'),/Advertising/);
  assert.match(first('Quel est le résultat opérationnel d’Amazon en 2024 ?'),/Operating income/);
  assert.match(first('Quel est le résultat d’exploitation d’Amazon en 2024 ?'),/Operating income/);
});
