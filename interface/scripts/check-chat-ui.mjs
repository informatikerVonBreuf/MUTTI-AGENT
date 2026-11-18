import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
const root=fileURLToPath(new URL('../',import.meta.url));
const vite=await createServer({root,configFile:path.join(root,'vite.config.js'),server:{middlewareMode:true,hmr:false},appType:'custom'});
try{
  const {default:ChatPanel}=await vite.ssrLoadModule('/src/ChatPanel.jsx');
  const thread={id:'fixture',kind:'chat',title:'Conversation test',memory:[],effectivePriority:'normal',messages:[{id:'reply',role:'assistant',content:'Réponse de test.',createdAt:new Date().toISOString(),citations:[{documentId:'test',title:'CITATION_RESERVEE_AU_BACKEND'}]}]};
  const props={thread,sending:false,onSend:async()=>true,onMemory:()=>{},onRetain:()=>{},onPriority:()=>{},onRename:()=>{},onDelete:()=>{},onOpenDocument:()=>{}};
  const disconnected=renderToStaticMarkup(React.createElement(ChatPanel,{...props,backend:{connected:false}}));
  assert.ok(!disconnected.includes('CITATION_RESERVEE_AU_BACKEND'));
  assert.ok(disconnected.includes('backend IA n’est pas encore connecté'));
  const connected=renderToStaticMarkup(React.createElement(ChatPanel,{...props,backend:{connected:true}}));
  assert.ok(connected.includes('CITATION_RESERVEE_AU_BACKEND'));
  assert.ok(disconnected.includes('Supprimer cette conversation')&&disconnected.includes('Importance de la conversation'));
  const reconnect=renderToStaticMarkup(React.createElement(ChatPanel,{...props,onCheckBackend:()=>{},backend:{connected:false,configured:true,state:'unavailable'}}));
  assert.ok(reconnect.includes('Vérifier la connexion'));
  const {default:RunActivity}=await vite.ssrLoadModule('/src/RunActivity.jsx');
  const measured=renderToStaticMarkup(React.createElement(RunActivity,{run:{kind:'chat',status:'completed',startedAt:'2026-11-13T10:00:00Z',finishedAt:'2026-11-13T10:00:08.500Z',verifiedClaimCount:2}}));
  assert.ok(measured.includes('Durée totale')&&measured.includes('8,5'));
  const {HomePage,PageScenery}=await vite.ssrLoadModule('/src/ImmersivePages.jsx');
  const {default:AgentTransparency}=await vite.ssrLoadModule('/src/AgentTransparency.jsx');
  const {buildAgentPlan}=await import('../server/agent-policies.mjs');
  const home=renderToStaticMarkup(React.createElement(HomePage,{workspace:{documents:[],companies:[]}}));
  assert.ok(home.includes('book-stage')&&home.includes('Ouvrir le livre en trois dimensions'));
  for(const page of ['home','library','chat','themes']){const art=renderToStaticMarkup(React.createElement(PageScenery,{page}));assert.ok(art.includes('scenery-'+page)&&art.includes('aria-hidden="true"'));}
  const transparent=renderToStaticMarkup(React.createElement(AgentTransparency,{plan:buildAgentPlan({theme:'Risks'})}));
  assert.ok(transparent.includes('non exécuté')&&transparent.includes('Aucun événement'));
  const pdf=renderToStaticMarkup(React.createElement(ChatPanel,{...props,thread:{...thread,documentIds:['pdf1']},documents:[{id:'pdf1',name:'Meta 2024'}],backend:{connected:false}}));
  assert.ok(pdf.includes('Recherche ciblée')&&pdf.includes('Utiliser tout le corpus'));
  const {default:AuthScreen}=await vite.ssrLoadModule('/src/AuthScreen.jsx');
  const authProps={statusState:'ready',canPreview:true,onPreview:()=>{},onModeChange:()=>{},onSignIn:async()=>{},onRecover:async()=>{},onRetry:()=>{}};
  const login=renderToStaticMarkup(React.createElement(AuthScreen,authProps));
  assert.ok(login.includes('id="auth-email"')&&login.includes('type="password"')&&login.includes('autoComplete="current-password"'));
  assert.ok(login.includes('auth-title')&&login.includes('human-reading-book')&&login.includes('Aucun identifiant'));
  assert.ok(login.includes('human-reader-css-book')&&login.includes('automatiquement en trois dimensions'));
  assert.ok(login.includes('Parcourir l’aperçu local')&&login.includes('Afficher le mot de passe'));
  const recovery=renderToStaticMarkup(React.createElement(AuthScreen,{...authProps,mode:'recovery'}));
  assert.ok(recovery.includes('Demander un lien de récupération')&&!recovery.includes('id="auth-password"'));
  const loading=renderToStaticMarkup(React.createElement(AuthScreen,{...authProps,statusState:'loading',canPreview:false}));
  assert.ok(loading.includes('disabled=""')&&!loading.includes('auth-preview'));
  const unavailable=renderToStaticMarkup(React.createElement(AuthScreen,{...authProps,statusState:'error',canPreview:false}));
  assert.ok(unavailable.includes('Réessayer')&&!unavailable.includes('auth-preview'));
  const localStatus={provider:'local',configured:true,apiProtected:true,localPreviewAllowed:false,recoveryMode:'local_code'};
  const setup=renderToStaticMarkup(React.createElement(AuthScreen,{...authProps,mode:'setup',authInfo:{...localStatus,setupRequired:true},statusState:'connected',canPreview:false}));
  assert.ok(setup.includes('Créer mon compte')&&setup.includes('id="auth-confirm"')&&setup.includes('autoComplete="new-password"')&&!setup.includes('auth-preview'));
  const localRecovery=renderToStaticMarkup(React.createElement(AuthScreen,{...authProps,mode:'recovery',authInfo:localStatus,statusState:'connected',canPreview:false}));
  assert.ok(localRecovery.includes('id="auth-recovery-code"')&&localRecovery.includes('Réinitialiser mon accès')&&!localRecovery.includes('Demander un lien'));
  const cognito=renderToStaticMarkup(React.createElement(AuthScreen,{...authProps,authInfo:{provider:'cognito',configured:true},statusState:'connected',canPreview:false}));
  assert.ok(cognito.includes('Continuer avec AWS')&&!cognito.includes('id="auth-password"'));
  // Chat RAG en étapes fixes : huit cartes, statut réel, refus du filtre d'entrée, affirmations retirées, aucune mention d'agent.
  const stages=(statuses,detail={})=>['input_guard','query','retrieval','passage_screen','generation','output_guard','correction','answer'].map((stage,index)=>({stage,status:statuses[index],detail:detail[stage]||{},durationMs:statuses[index]==='completed'?120:null}));
  const pipelineRun=renderToStaticMarkup(React.createElement(RunActivity,{run:{kind:'chat',status:'completed',startedAt:'2026-11-18T10:00:00Z',finishedAt:'2026-11-18T10:00:09Z',verifiedClaimCount:1,attempts:1,
    stages:stages(['completed','completed','completed','completed','completed','completed','skipped','completed'],{retrieval:{passages:7,quarantined:1},output_guard:{claims:2,kept:1,dropped:1,reasons:['number_mismatch']},answer:{claims:1,citations:1}}),
    rejectedClaims:[{index:1,by:'worker',reasons:['number_mismatch']}],security:[{kind:'passage_quarantine',count:1,signals:['instruction_override']}]}}));
  for(const text of ['LE RAG DOCUMENTAIRE, ÉTAPE PAR ÉTAPE','Aucun agent','Filtre d’entrée','Contrôle de sortie','Réponse assemblée','montant absent de la citation','remplacement de consignes','RAG documentaire · étapes fixes'])assert.ok(pipelineRun.includes(text),text);
  assert.ok(!pipelineRun.includes('LE CHANTIER DES AGENTS'));
  const refused=renderToStaticMarkup(React.createElement(RunActivity,{run:{kind:'chat',status:'failed',error:{code:'INPUT_REJECTED',message:'Question refusée par le filtre d’entrée (jailbreak).'},stages:stages(['blocked','skipped','skipped','skipped','skipped','skipped','skipped','skipped'],{input_guard:{reasons:['jailbreak']}}),security:[{kind:'input_guard',reason:'jailbreak',signals:['jailbreak']}]}}));
  assert.ok(refused.includes('a bloqué')&&refused.includes('Question refusée')&&refused.includes('open=""'));
  const thematicRun=renderToStaticMarkup(React.createElement(RunActivity,{run:{kind:'thematic',status:'completed',tasks:[{agent:'researcher',status:'completed'}],toolCalls:[{ticker:'META',status:'ok',cached:true,mcpTool:'get_stock_info',passages:[{id:'m',excerpt:'Meta (META) — capitalisation boursière'}]}],retrievals:[]}}));
  assert.ok(thematicRun.includes('LE CHANTIER DES AGENTS')&&thematicRun.includes('📈 META')&&thematicRun.includes('MCP'));
  const market=renderToStaticMarkup(React.createElement(ChatPanel,{...props,backend:{connected:true},thread:{...thread,messages:[{id:'m',role:'assistant',content:'Résumé.',createdAt:new Date().toISOString(),citationsVerified:true,citations:[{source:'market',title:'Yahoo Finance (MCP) — META',ticker:'META',retrievedAt:'2026-11-18T10:00:00Z',quote:'capitalisation boursière (marketCap) : 1500000000000'}]}]}}));
  assert.ok(market.includes('Yahoo Finance (MCP) — META')&&market.includes('consulté le 18/11/2026')&&market.includes('citation-market'));
  // Page Sécurité : rendu initial (chargement) et libellés de couche ; les données réelles sont vérifiées par check-rag-api.
  const {default:SecurityPage,STOP_LAYER}=await vite.ssrLoadModule('/src/pages/SecurityPage.jsx');
  const security=renderToStaticMarkup(React.createElement(SecurityPage));
  assert.ok(security.includes('05 / ARCHIVE VIVANTE')&&security.includes('couche par couche'));assert.equal(STOP_LAYER.input_guard,'Filtre d’entrée');
  const {default:MetricsPage}=await vite.ssrLoadModule('/src/pages/MetricsPage.jsx');assert.ok(renderToStaticMarkup(React.createElement(MetricsPage)).includes('04 / ARCHIVE VIVANTE'));
  console.log('Rendu React vérifié : citations masquées sans backend, commandes de mémoire, importance et suppression, RAG en étapes, chantier des agents avec MCP, citations de marché, page Sécurité.');
}finally{await vite.close();}
