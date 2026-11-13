import React,{useEffect,useMemo,useState} from 'react';
import App from './App.jsx';
import AuthScreen from './AuthScreen.jsx';
import {createAuthClient,isLocalPreviewAllowed} from './auth-client.mjs';
const previewRoutes=new Set(['home','library','chat','themes']);
function readRoute(){if(typeof window==='undefined')return 'login';const hash=window.location.hash.slice(1);return hash==='recovery'?'recovery':previewRoutes.has(hash)?'preview':'login';}
export default function AuthGateway(){
  const client=useMemo(()=>createAuthClient(),[]);
  const [route,setRoute]=useState(readRoute),[status,setStatus]=useState(null),[state,setState]=useState('loading'),[attempt,setAttempt]=useState(0),[session,setSession]=useState(null);
  useEffect(()=>{const change=()=>setRoute(readRoute());window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);
  useEffect(()=>{const controller=new AbortController();let active=true;setState('loading');setSession(null);client.status({signal:controller.signal}).then(async data=>{if(!active)return;setStatus(data);if(data.configured&&data.apiProtected){const current=await client.session({signal:controller.signal});if(!active)return;setSession(current.authenticated?current:null);}setState(data.configured&&data.apiProtected?'connected':'ready');}).catch(error=>{if(active&&error.name!=='AbortError'){setStatus(null);setState('error');}});return()=>{active=false;controller.abort();};},[client,attempt]);
  const local=isLocalPreviewAllowed(status,typeof window==='undefined'?'':window.location.hostname);
  function changeMode(next){window.location.hash=next;setRoute(next);}
  function openPreview(){if(!local)return;window.location.hash='home';setRoute('preview');}
  async function signIn(fields){const current=await client.signIn(fields,status);setSession(current);window.location.hash='home';setRoute('preview');}
  if(route==='preview'&&(local||session?.authenticated))return <App onOpenLogin={()=>changeMode('login')} accessMode={session?.authenticated?'authenticated':'local_preview'}/>;
  return <AuthScreen mode={route==='recovery'?'recovery':'login'} statusState={state} canPreview={local&&state==='ready'} onPreview={openPreview} onModeChange={changeMode} onSignIn={signIn} onRecover={fields=>client.recover(fields,status)} onRetry={()=>setAttempt(value=>value+1)}/>;
}
