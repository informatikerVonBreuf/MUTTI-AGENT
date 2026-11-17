// Vérifie l'intégrité du journal d'audit chaîné : node scripts/verify-audit.mjs [chemin/audit.jsonl]
// Code de sortie 0 si la chaîne est intacte, 1 sinon.
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyChain} from '../server/audit-log.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const file=process.argv[2]||path.join(process.env.FOLIO_DATA_DIR||path.join(root,'.runtime'),'audit','audit.jsonl');
let content='';
try{content=await fs.readFile(file,'utf8');}catch(error){if(error.code==='ENOENT'){console.log('Aucun journal d’audit à vérifier : '+file);process.exit(0);}throw error;}
const result=verifyChain(content.split('\n').filter(Boolean));
if(result.valid)console.log(`Journal d’audit intact : ${result.entries} entrées, dernière empreinte ${result.lastHash.slice(0,16)}…`);
else{console.error(`Journal d’audit ROMPU à la ligne ${result.brokenAt} (${result.reason}) après ${result.entries} entrées valides.`);process.exitCode=1;}
