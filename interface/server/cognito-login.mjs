import {randomBytes,createHash,createPublicKey,verify,timingSafeEqual} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('base64url');
const random=()=>randomBytes(32).toString('base64url');
function fail(code,message,status=400){const error=new Error(message);error.code=code;error.status=status;throw error;}
const stateCookie=(value,secure,maxAge=600)=>`folio_oauth_state=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure?'; Secure':''}`;
const cookie=request=>String(request.headers.cookie||'').split(';').map(part=>part.trim()).find(part=>part.startsWith('folio_oauth_state='))?.slice('folio_oauth_state='.length)||'';
async function jsonResponse(response){if(!response.ok)fail('AUTH_PROVIDER_ERROR','La connexion AWS n’a pas abouti. Réessayez.',502);const raw=await response.text();if(raw.length>131072)fail('INVALID_IDENTITY','Réponse AWS invalide.',502);try{return JSON.parse(raw);}catch{fail('INVALID_IDENTITY','Réponse AWS invalide.',502);}}

export function verifyCognitoIdToken(token,{issuer,clientId,nonce,keys,now=Date.now()}){
  if(typeof token!=='string'||token.length>16384)fail('INVALID_IDENTITY','Identité AWS non vérifiable.',401);
  let header,payload,parts;try{parts=token.split('.');if(parts.length!==3)throw new Error();header=JSON.parse(Buffer.from(parts[0],'base64url'));payload=JSON.parse(Buffer.from(parts[1],'base64url'));}catch{fail('INVALID_IDENTITY','Identité AWS non vérifiable.',401);}
  if(header.alg!=='RS256'||typeof header.kid!=='string'||header.kid.length>128)fail('INVALID_IDENTITY','Identité AWS non vérifiable.',401);
  const jwk=keys.find(key=>key.kid===header.kid&&key.kty==='RSA'&&(!key.use||key.use==='sig')&&(!key.alg||key.alg==='RS256'));
  let valid=false;try{valid=Boolean(jwk)&&verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key:jwk,format:'jwk'}),Buffer.from(parts[2],'base64url'));}catch{}
  if(!valid||payload.iss!==issuer||payload.aud!==clientId||payload.token_use!=='id'||!Number.isFinite(payload.exp)||payload.exp*1000<=now||!Number.isFinite(payload.iat)||payload.iat*1000>now+60000||payload.nbf!==undefined&&(!Number.isFinite(payload.nbf)||payload.nbf*1000>now)||typeof payload.sub!=='string'||!payload.sub||payload.nonce!==nonce||payload.email_verified!==true||typeof payload.email!=='string')fail('INVALID_IDENTITY','Identité AWS non vérifiable.',401);
  return payload;
}

export function createCognitoLogin({values={},fetcher=fetch,now=Date.now}={}){
  const region=values.FOLIO_COGNITO_REGION||values.AWS_REGION,clientId=values.FOLIO_COGNITO_CLIENT_ID,poolId=values.FOLIO_COGNITO_USER_POOL_ID,domainValue=values.FOLIO_COGNITO_DOMAIN,callbackValue=values.FOLIO_COGNITO_REDIRECT_URI,ownerEmail=values.FOLIO_COGNITO_OWNER_EMAIL?.trim().toLowerCase();
  const configured=Boolean(region&&clientId&&poolId&&domainValue&&callbackValue&&ownerEmail);
  if(!configured)return {configured:false};
  if(!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(region)||!poolId.startsWith(region+'_')||! /^[a-z0-9-]+_[A-Za-z0-9]+$/.test(poolId)||!/^[\w+]{1,128}$/.test(clientId)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail))throw new Error('Configuration Cognito invalide.');
  const domain=new URL(domainValue),callback=new URL(callbackValue);
  if(domain.protocol!=='https:'||!domain.hostname.endsWith('.auth.'+region+'.amazoncognito.com')||domain.port||domain.username||domain.password||domain.search||domain.hash||!['','/'].includes(domain.pathname))throw new Error('Domaine Cognito invalide.');
  if(!['http:','https:'].includes(callback.protocol)||!['localhost','127.0.0.1','[::1]'].includes(callback.hostname)||callback.pathname!=='/api/auth/callback'||callback.search||callback.hash||callback.username||callback.password)throw new Error('URL de retour Cognito invalide pour le serveur local.');
  if(callback.protocol==='http:'&&callback.hostname!=='localhost')throw new Error('Cognito exige HTTPS, sauf pour http://localhost.');
  const issuer=`https://cognito-idp.${region}.amazonaws.com/${poolId}`,secure=values.FOLIO_SECURE_COOKIES==='1';
  const pending=new Map();let jwks=null,jwksAt=0;
  function start(request){if(request.headers.host!==callback.host)return {location:callback.origin+'/api/auth/redirect'};
    for(const [id,item] of pending)if(item.expiresAt<=now())pending.delete(id);if(pending.size>=64)fail('RATE_LIMITED','Trop de demandes de connexion. Patientez.',429);
    const state=random(),nonce=random(),verifier=random();pending.set(hash(state),{nonce,verifier,expiresAt:now()+600000});
    const url=new URL('/oauth2/authorize',domain);url.search=new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:callback.href,scope:'openid email',state,nonce,code_challenge:hash(verifier),code_challenge_method:'S256'}).toString();
    return {location:url.href,cookie:stateCookie(state,secure)};
  }
  async function callbackRequest(request,url){const state=url.searchParams.get('state')||'',stored=cookie(request);if(!/^[A-Za-z0-9_-]{43}$/.test(state)||state.length!==stored.length||!timingSafeEqual(Buffer.from(state),Buffer.from(stored)))fail('INVALID_CALLBACK','La demande de connexion a expiré.',401);
    const id=hash(state),entry=pending.get(id);pending.delete(id);if(!entry||entry.expiresAt<=now())fail('INVALID_CALLBACK','La demande de connexion a expiré.',401);
    const code=url.searchParams.get('code');if(!code||code.length>4096||url.searchParams.has('error'))fail('INVALID_CALLBACK','La connexion AWS a été annulée.',401);
    const parameters=new URLSearchParams({grant_type:'authorization_code',client_id:clientId,redirect_uri:callback.href,code,code_verifier:entry.verifier});
    const headers={'Content-Type':'application/x-www-form-urlencoded'};if(values.FOLIO_COGNITO_CLIENT_SECRET)headers.Authorization='Basic '+Buffer.from(clientId+':'+values.FOLIO_COGNITO_CLIENT_SECRET).toString('base64');
    let tokens;try{tokens=await jsonResponse(await fetcher(new URL('/oauth2/token',domain),{method:'POST',headers,body:parameters.toString(),signal:AbortSignal.timeout(15000)}));}catch{fail('AUTH_PROVIDER_ERROR','La connexion AWS n’a pas abouti. Réessayez.',502);}
    let tokenKid='';try{tokenKid=JSON.parse(Buffer.from(tokens.id_token.split('.')[0],'base64url')).kid;}catch{}
    if(!jwks||now()-jwksAt>3600000||!jwks.some(key=>key.kid===tokenKid)){try{const response=await jsonResponse(await fetcher(issuer+'/.well-known/jwks.json',{signal:AbortSignal.timeout(15000)}));if(!Array.isArray(response.keys)||response.keys.length>16)throw new Error();jwks=response.keys;jwksAt=now();}catch{fail('AUTH_PROVIDER_ERROR','Impossible de vérifier l’identité AWS.',502);}}
    const identity=verifyCognitoIdToken(tokens.id_token,{issuer,clientId,nonce:entry.nonce,keys:jwks,now:now()});
    if(identity.email.toLowerCase()!==ownerEmail)fail('ACCESS_DENIED','Ce compte ne dispose pas d’un accès à cet atelier.',403);
    return {user:{id:'cognito:'+identity.sub,email:identity.email.toLowerCase(),provider:'cognito'},expiresAt:identity.exp*1000,location:callback.origin+'/#home',stateCookie:stateCookie('',secure,0)};
  }
  const logout=new URL('/logout',domain);logout.search=new URLSearchParams({client_id:clientId,logout_uri:callback.origin+'/'}).toString();
  return {configured:true,start,callback:callbackRequest,logoutUrl:logout.href};
}
