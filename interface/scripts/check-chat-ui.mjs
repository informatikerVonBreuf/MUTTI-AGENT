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
  console.log('Rendu React vérifié : citations masquées sans backend, commandes de mémoire, importance et suppression présentes.');
}finally{await vite.close();}
