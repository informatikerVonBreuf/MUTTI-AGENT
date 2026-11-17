// Cartons de la vidéo, rendus par Edge dans le style Archive vivante (papier, vert bouteille, serif).
// Les cartons de résultats ne citent que des mesures déjà publiées dans le dépôt, avec leur source.
// Usage, depuis interface/ : node demo/cards.mjs   → demo/build/cards/*.png
import {chromium} from 'playwright-core';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const out=path.join(path.dirname(fileURLToPath(import.meta.url)),'build','cards');await fs.mkdir(out,{recursive:true});
const cards=[
  ['00','Folio · Archive vivante','Démonstration · recherche documentaire assistée par agents · novembre 2026'],
  ['01','Connexion et accueil','Cookies nécessaires seulement · « je ne suis pas un robot » sans service tiers · visite guidée'],
  ['02','Une question, des sources','Le chantier des agents en direct · citations mot pour mot avec la page · coût et empreinte'],
  ['03','Résumé thématique et export','Quatre rôles, des colis scellés · rapport Word, PDF, Markdown'],
  ['04','La bibliothèque','29 rapports Meta, Google, Apple, Amazon · filtres · aperçu rapide · chat ciblé sur un PDF'],
  ['05','Transparence, mesures, audit','Coût par agent · p50 / p95 / p99 · journal chaîné et transferts signés'],
  ['06','Une injection bloquée','Une note piégée en mémoire est écartée avant le modèle · comptes, double authentification, sous-comptes'],
  ['99','Merci','Code, tests, rapports red team et validation : dépôt MUTTI-AGENT'],
];
const data=[
  ['05b','La charge, mesurée avec k6',[
    ['API de lecture, 1 → 5 → 10 utilisateurs','p50 6 ms · p95 29 ms · p99 68 ms'],
    ['Analyse complète, une à la fois','p50 2,5 s · p95 3,2 s · p99 3,5 s'],
    ['Échecs','0 %'],
  ],'Pile Docker complète (nginx, CSP, anti-robot, CSRF, audit), modèle simulé, 17 novembre 2026 · source : interface/OBSERVABILITE.md'],
  ['06b','La suite red team',[
    ['Attaques testées','87 · 5 réussies (ASR 5,7 %)'],
    ['Cas légitimes','130 · 1 faux positif (0,8 %)'],
    ['Passages légitimes écartés à tort','0 sur 46'],
    ['Tâches légitimes de bout en bout','6 sur 6'],
    ['Échecs connus','chinois, arabe, consigne découpée sur plusieurs notes'],
  ],'Modèle simulé ou supposé compromis, attaquant non adaptatif · source : scripts/redteam/results/report.md'],
];
const frame=inner=>`<html><body style="margin:0;width:1280px;height:720px;display:grid;place-items:center;background:#F2EBDD;color:#173C32;font-family:'Palatino Linotype',Georgia,serif"><div style="width:1040px">${inner}</div></body></html>`;
const browser=await chromium.launch({channel:'msedge'});const page=await browser.newPage({viewport:{width:1280,height:720}});
for(const [number,title,subtitle] of cards){
  await page.setContent(frame(`<div style="font-family:'Courier New',monospace;font-size:20px;letter-spacing:.12em;color:#8A4B2D">${number==='00'||number==='99'?'FOLIO':'CHAPITRE '+number} / ARCHIVE VIVANTE</div>
  <h1 style="font-weight:400;font-size:72px;line-height:1.05;margin:18px 0 22px">${title}</h1>
  <div style="height:2px;background:#173C32;width:160px;margin-bottom:22px"></div>
  <p style="font-family:'Segoe UI',sans-serif;font-size:24px;line-height:1.5;color:#3E4A43;margin:0">${subtitle}</p>`));
  await page.screenshot({path:path.join(out,`carton-${number}.png`)});
}
for(const [number,title,rows,source] of data){
  await page.setContent(frame(`<div style="font-family:'Courier New',monospace;font-size:18px;letter-spacing:.12em;color:#8A4B2D">RÉSULTATS MESURÉS / ARCHIVE VIVANTE</div>
  <h1 style="font-weight:400;font-size:56px;line-height:1.05;margin:14px 0 26px">${title}</h1>
  <table style="border-collapse:collapse;width:100%;font-family:'Segoe UI',sans-serif;font-size:23px">${rows.map(([label,value])=>`<tr style="border-top:1px solid #C9BFA9"><td style="padding:13px 0;color:#3E4A43">${label}</td><td style="padding:13px 0;text-align:right;color:#173C32;font-weight:600">${value}</td></tr>`).join('')}</table>
  <p style="font-family:'Segoe UI',sans-serif;font-size:16px;line-height:1.5;color:#6B6458;margin:26px 0 0;border-top:2px solid #173C32;padding-top:14px">${source}</p>`));
  await page.screenshot({path:path.join(out,`carton-${number}.png`)});
}
await browser.close();console.log('cartons :',cards.length+data.length);
