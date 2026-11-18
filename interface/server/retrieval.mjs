import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';

const stopwords = new Set('a au aux avec ce ces cette dans de des du en et est il la le les leur leurs ou par pour que quel quelle quelles quels qui se ses son sur un une vos votre vous je nous what which how the a an and or of for to in is are was were with from at by as it its be this that between compare comparer analyse analyser analysis detailed détaille détaillée faire fait donne donner montrez montrer'.split(' '));
const vocabulary = {
  revenu: ['revenue','sales'], revenus:['revenue','sales'], chiffre:['revenue','sales'], affaires:['revenue','sales'],
  rentabilite:['profit','income','margin'], profitabilite:['profit','income','margin'], benefice:['income','profit'], benefices:['income','profit'],
  resultat:['income','earnings'], resultats:['income','earnings'], marge:['margin','profit'], marges:['margin','profit'],
  croissance:['growth','increase','revenue'], moteurs:['growth','revenue','segment'], cout:['cost','expense'], couts:['cost','expenses'],
  depenses:['expenses','cost'], investissements:['investment','capital','expenditures'], investissement:['investment','capital'],
  tresorerie:['cash','flow'], dette:['debt'], dettes:['debt'], bilan:['balance','assets','liabilities'], actif:['assets'],
  actifs:['assets'], passif:['liabilities'], actions:['stock','shares'], action:['stock','shares'], risque:['risk'], risques:['risk'],
  annuel:['annual'], annuelle:['annual'], trimestre:['quarter'], trimestriel:['quarter'], ia:['artificial','intelligence'],
  publicite:['advertising'], services:['services'], cloud:['cloud','aws'], performance:['revenue','income'], comparer:['revenue','income'],
  // Formes courantes des questions en français : sans elles, « ventes nettes » ou « publicitaire » ne trouvent aucun passage anglais.
  publicitaire:['advertising'], publicitaires:['advertising'], vente:['sales'], ventes:['sales'], nette:['net'], nettes:['net'],
  operationnel:['operating'], operationnelle:['operating'], operationnels:['operating'], exploitation:['operating'],
};
export const normalize = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const tokenize = text => normalize(text).match(/[a-z0-9]{2,}/g) || [];
const aliases = { amazon:['amazon','amzn','aws'], apple:['apple','aapl'], google:['google','alphabet','googl','goog'], meta:['meta','facebook'] };
export const COMPANY_ALIASES = aliases;
export const chunkHash = content => createHash('sha256').update(content).digest('hex');

// `screen` (filtre d'ingestion) écarte un fragment suspect AVANT l'indexation : il n'entre ni dans les statistiques BM25
// ni dans les résultats, et ne peut donc pas évincer des passages légitimes. `reviewed` : empreintes de fragments
// signalés puis examinés à la main (faux positifs), conservés sur correspondance exacte uniquement.
export async function buildIndex(documents,{screen=null,reviewed=new Set()}={}) {
  const chunks = [];
  const frequencies = new Map();
  const quarantined = [];let reviewedKept=0;
  for (const doc of documents) {
    // Texte ramené à LF : mêmes fragments, mêmes empreintes, quelle que soit la machine (fins de ligne converties par Git).
    const content = (await fs.readFile(doc.file,'utf8')).replace(/\r\n/g,'\n');
    // Empreinte attendue (manifeste) : un rapport modifié entre la vérification et l'indexation n'est pas indexé.
    if (doc.sha256 && chunkHash(content) !== doc.sha256) { quarantined.push({documentId:doc.id,name:doc.name,page:null,signals:['corpus_altered'],score:0,excerpt:''}); continue; }
    const pages = content.split(/<!--\s*page break\s*-->/i);
    for (let pageIndex=0;pageIndex<pages.length;pageIndex++) {
      const pageNumber=pages.length>1?pageIndex+1:null;
      // Commentaires HTML : toujours retirés du texte ; ceux qui contiennent une instruction sont signalés.
      if(screen)for(const comment of pages[pageIndex].match(/<!--[^]*?-->/g)||[]){if(/^<!--\s*(?:image|page break)\s*-->$/i.test(comment))continue;const scan=screen(comment);if(scan.disposition==='quarantine')quarantined.push({documentId:doc.id,name:doc.name,page:pageNumber,signals:[...new Set(['hidden_instruction',...scan.signals])],score:scan.score,excerpt:comment.replace(/\s+/g,' ').slice(0,160),hidden:true});}
      const page = pages[pageIndex].replace(/<!--[^]*?-->/g,' ').trim();
      const paragraphs = page.split(/\n\s*\n/);
      let current='';
      const push=()=>{
        if(current.trim().length<35){current='';return;}
        let isReviewed=false;
        if(screen){const hash=chunkHash(current.trim());if(reviewed.has(hash)){reviewedKept++;isReviewed=true;}else{const scan=screen(current.trim());if(scan.disposition==='quarantine'){quarantined.push({documentId:doc.id,name:doc.name,page:pageNumber,signals:scan.signals,score:scan.score,excerpt:current.trim().replace(/\s+/g,' ').slice(0,160),sha256:hash});current='';return;}}}
        const tokens=tokenize(current), counts=new Map();
        for(const token of tokens)counts.set(token,(counts.get(token)||0)+1);
        for(const term of counts.keys())frequencies.set(term,(frequencies.get(term)||0)+1);
        chunks.push({documentId:doc.id,name:doc.name,company:doc.company,year:doc.year,type:doc.type,page:pageNumber,content:current.trim(),counts,length:tokens.length,...(isReviewed?{reviewed:true}:{})});current='';
      };
      for(const paragraph of paragraphs){
        if(current.length+paragraph.length>1800)push();
        if(paragraph.length>2200){for(let i=0;i<paragraph.length;i+=1700){current=paragraph.slice(i,i+1800);push();}}
        else current+=(current?'\n\n':'')+paragraph;
      }
      push();
    }
    // Rend la main entre deux rapports : la construction ne bloque pas les autres requêtes.
    await new Promise(resolve=>setImmediate(resolve));
  }
  return {chunks,frequencies,averageLength:chunks.reduce((sum,chunk)=>sum+chunk.length,0)/Math.max(chunks.length,1),quarantined,reviewedKept};
}

export function searchIndex(index,documents,query,{depth='deep',documentIds=[]}={}) {
  const words=tokenize(query);
  const terms=new Map();
  for(const word of words){
    if(!stopwords.has(word)&&!/^20\d{2}$/.test(word))terms.set(word,1);
    for(const translated of vocabulary[word]||[])terms.set(translated,.8);
  }
  const companies=Object.entries(aliases).filter(([,names])=>names.some(name=>words.includes(name))).map(([name])=>name);
  const years=[...new Set(query.match(/\b20\d{2}\b/g)||[])];
  // Trimestre : « T1 », « Q1 », mais aussi « premier trimestre », « 2e trimestre », « first quarter ».
  const ordinals={premier:1,'1er':1,deuxieme:2,second:2,seconde:2,'2e':2,troisieme:3,'3e':3,quatrieme:4,'4e':4,first:1,third:3,fourth:4};
  const quarters=[...new Set([...[...normalize(query).matchAll(/\b[qt]([1-4])\b/g)].map(match=>'q'+match[1]),...[...normalize(query).matchAll(/\b(premier|1er|deuxieme|second|seconde|2e|troisieme|3e|quatrieme|4e|first|third|fourth)\s+(?:trimestre|quarter)\b/g)].map(match=>'q'+ordinals[match[1]])])];
  const requestedType=/\b(?:annuel(?:le)?s?|annual|10-k)\b/i.test(normalize(query))?'10-k':null;
  for(const alias of Object.values(aliases).flat())terms.delete(alias);
  if(requestedType)for(const word of ['annual','annuel','annuelle','annuels','annuelles'])terms.delete(word);
  const financialQuestion=['revenue','sales','income','profit','margin','cash','debt','cost','expenses'].some(term=>terms.has(term));
  // « en 2024 » sans trimestre désigne l'exercice : le rapport annuel (10-K) passe devant les 10-Q de la même année.
  const fiscalYear=years.length&&!quarters.length&&!requestedType&&!/\b(?:trimestre|trimestriel\w*|quarter\w*|quarterly)\b/.test(normalize(query));
  const allowedIds=new Set(documentIds);
  const validIds=new Set(documents.filter(doc=>(!companies.length||companies.includes(doc.company))&&(!years.length||years.includes(doc.year))&&(!quarters.length||quarters.some(q=>doc.name.includes(q)))&&(!requestedType||String(doc.type).toLowerCase()===requestedType)&&(!allowedIds.size||allowedIds.has(doc.id))).map(doc=>doc.id));
  const scored=[];
  for(const chunk of index.chunks){
    if(!validIds.has(chunk.documentId))continue;
    let score=0,matched=0;
    for(const [term,weight] of terms){
      const tf=chunk.counts.get(term)||0;if(!tf)continue;matched++;
      const frequency=index.frequencies.get(term)||0;
      const idf=Math.log(1+(index.chunks.length-frequency+.5)/(frequency+.5));
      score+=weight*idf*(tf*2.2)/(tf+1.2*(.25+.75*chunk.length/index.averageLength));
    }
    if(score>0&&financialQuestion&&/(?:revenue|sales|income|profit|margin|cash|debt|cost|expenses)[^\n]{0,130}\$/i.test(chunk.content))score*=3;
    if(score>0&&(terms.has('revenue')||terms.has('sales'))&&/total\s+revenue[^.\n]{0,100}\$/i.test(chunk.content))score*=2;
    if(score>0&&fiscalYear&&String(chunk.type).toLowerCase()==='10-k')score*=1.8;
    if(score>0)scored.push({...chunk,score,matched});
  }
  scored.sort((a,b)=>b.score-a.score);
  const perDocument=new Map(),selected=[];
  const limit=depth==='brief'?4:9;
  const firstByCompany=companies.length>1?companies.map(company=>scored.find(chunk=>chunk.company===company)).filter(Boolean):[];
  const balanced=[...firstByCompany,...scored.filter(chunk=>!firstByCompany.includes(chunk))];
  for(const chunk of balanced){
    const used=perDocument.get(chunk.documentId)||0;if(used>=3)continue;
    const key=chunk.documentId+':'+chunk.page+':'+chunk.content.slice(0,150);
    if(selected.some(item=>item.key===key))continue;
    selected.push({key,documentId:chunk.documentId,name:chunk.name,company:chunk.company,year:chunk.year,type:chunk.type,page:chunk.page,excerpt:chunk.content.slice(0,1800),matchedTerms:chunk.matched,...(chunk.reviewed?{reviewed:true}:{})});
    perDocument.set(chunk.documentId,used+1);if(selected.length>=limit)break;
  }
  return {sources:selected.map(({key,...source},i)=>({...source,reference:i+1})),filters:{companies,years,quarters},searchedDocuments:validIds.size,totalMatches:scored.length};
}

export function createDocumentaryReport(run,result) {
  const {sources,filters,searchedDocuments}=result;
  const date=new Intl.DateTimeFormat('fr-FR',{dateStyle:'long',timeZone:'Europe/Paris'}).format(new Date());
  const lines=['# '+run.title,'','> Dossier documentaire local. Les passages ci-dessous sont des extraits du corpus ; aucune synthèse par un modèle IA ni donnée de marché en direct n’a été produite.','','## Question de recherche','',run.query,'','## Périmètre','',`Date : ${date}. Documents parcourus : ${searchedDocuments}. Extraits retenus : ${sources.length}.`,filters.companies.length?'Entreprises : '+filters.companies.join(', ')+'.':'Entreprises : corpus sélectionné.',filters.years.length?'Exercices demandés : '+filters.years.join(', ')+'.':'Exercices : ceux disponibles dans le corpus.','','## Résultats documentaires',''];
  if(!sources.length)lines.push('Aucun passage pertinent trouvé pour cette demande dans le périmètre sélectionné. Essayez un autre terme financier, une autre entreprise ou une autre période.');
  for(const source of sources){
    lines.push(`### [${source.reference}] ${source.name}${source.page?' — page '+source.page:''}`,'','Source : '+source.type+' · '+source.company+' · '+source.year+'.','',source.excerpt,'');
  }
  lines.push('## Limites et vérification','', '- Recherche lexicale avec correspondances de vocabulaire français et anglais ; elle ne remplace pas une analyse sémantique.', '- Les données doivent être vérifiées dans le document d’origine. Les périodes fiscales et les unités peuvent différer entre entreprises.', '- Les numéros de page ne sont affichés que lorsque les séparateurs de page existent dans le texte extrait.');
  return lines.join('\n');
}
