import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildIndex,searchIndex} from './retrieval.mjs';

async function corpus(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'folio-retrieval-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  // Une page par ligne de tableau, un leurre avant la bonne ligne : sans la traduction attendue, le leurre
  // égale ou dépasse la cible et passe devant (tri stable). Pas de « $ » : les bonus de score ne jouent pas.
  const page='\n\n<!-- page break -->\n\n';
  const files={
    'apple 10-k 2024':['Income statement line: | Net income | 93,736 | 96,995 |','Operating expenses line: | Sales and marketing | 27,195 |','Products and services line: | Total net sales | 391,035 |'].join(page),
    'amazon 10-k 2024':['Statements of operations line: | Net income | 59,248 | 30,425 |','Statements of operations line: | Operating income | 68,593 | 36,852 |'].join(page),
    'meta 10-k 2024':['Revenue by source line: | Total revenue | 164,501 | 134,902 |','Revenue by source line: | Advertising | 160,633 | 131,948 |'].join(page),
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
