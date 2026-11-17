import React,{useEffect,useMemo,useState} from 'react';
import App from './App.jsx';
import AuthScreen from './AuthScreen.jsx';
import {createAuthClient,isLocalPreviewAllowed} from './auth-client.mjs';
const previewRoutes=new Set(['home','library','chat','themes']);
function readRoute(){if(typeof window==='undefined')return 'login';const hash=window.location.hash.slice(1);return hash==='recovery'?'recovery':previewRoutes.has(hash)?'preview':'login';}
export default function AuthGateway(){
  const client=useMemo(()=>createAuthClient(),[]);
  const [route,setRoute]=useState(readRoute),[status,setStatus]=useState(null),[state,setState]=useState('loading'),[attempt,setAttempt]=useState(0),[session,setSession]=useState(null),[notice,setNotice]=useState(()=>typeof window!=='undefined'&&new URLSearchParams(window.location.search).get('auth')==='failed'?'La connexion AWS n’a pas abouti. Réessayez.':'');
  useEffect(()=>{const change=()=>setRoute(readRoute());window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);
  useEffect(()=>{const controller=new AbortController();let active=true;setState('loading');setSession(null);client.status({signal:controller.signal}).then(async data=>{if(!active)return;setStatus(data);if(data.configured&&data.apiProtected){const current=await client.session({signal:controller.signal});if(!active)return;setSession(current.authenticated?current:null);}setState(data.configured&&data.apiProtected?'connected':'ready');}).catch(error=>{if(active&&error.name!=='AbortError'){setStatus(null);setState('error');}});return()=>{active=false;controller.abort();};},[client,attempt]);
  const local=isLocalPreviewAllowed(status,typeof window==='undefined'?'':window.location.hostname);
  function changeMode(next){window.location.hash=next;setRoute(next);}
  function openPreview(){if(!local)return;window.location.hash='home';setRoute('preview');}
  async function signIn(fields){const current=await client.signIn(fields,status);setSession(current);window.location.hash='home';setRoute('preview');}
  async function setup(fields){try{return await client.setup(fields,status);}catch(error){if(error.code==='SETUP_CLOSED'){setNotice(error.message);setAttempt(value=>value+1);}throw error;}}
  function finishSetup(result){setStatus(previous=>({...previous,setupRequired:false}));setSession(result.session);window.location.hash='home';setRoute('preview');}
  async function signOut(){try{const result=await client.logout();setSession(null);setNotice('Vous êtes déconnecté.');changeMode('login');if(result.logoutUrl)window.location.assign(result.logoutUrl);}catch(error){setNotice(error.message);throw error;}}
  useEffect(()=>{const expired=()=>{setSession(null);setNotice('Votre session a expiré. Connectez-vous à nouveau.');window.location.hash='login';setRoute('login');};window.addEventListener('folio-auth-expired',expired);return()=>window.removeEventListener('folio-auth-expired',expired);},[]);
  useEffect(()=>{if(session?.authenticated&&route==='login'){window.location.hash='home';setRoute('preview');}},[session,route]);
  if(route==='preview'&&(local||session?.authenticated))return <App onOpenLogin={local?()=>changeMode('login'):undefined} onSignOut={session?.authenticated?signOut:undefined} accountLabel={session?.user?.email} accessMode={session?.authenticated?'authenticated':'local_preview'}/>;
  return <AuthScreen mode={route==='recovery'?'recovery':status?.setupRequired?'setup':'login'} authInfo={status} notice={notice} statusState={state} canPreview={local&&state==='ready'} onPreview={openPreview} onModeChange={changeMode} onSignIn={signIn} onSetup={setup} onSetupComplete={finishSetup} onRecover={fields=>client.recover(fields,status)} onReset={fields=>client.resetLocal(fields,status)} onResetComplete={()=>{setSession(null);setNotice('Votre mot de passe a été modifié. Connectez-vous.');changeMode('login');}} onExternalSignIn={()=>window.location.assign('/api/auth/redirect')} onRetry={()=>setAttempt(value=>value+1)}/>;
}
