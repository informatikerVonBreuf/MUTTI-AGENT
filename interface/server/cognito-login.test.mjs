import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {createCognitoLogin,verifyCognitoIdToken} from './cognito-login.mjs';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'fixture',alg:'RS256',use:'sig'};
const region='eu-west-3',pool=region+'_fixture',issuer=`https://cognito-idp.${region}.amazonaws.com/${pool}`,clientId='fixtureclient',nonce='fixture-nonce',clock=Date.now();
function token(changes={},headerChanges={}){const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'fixture',...headerChanges})).toString('base64url'),body=Buffer.from(JSON.stringify({iss:issuer,aud:clientId,sub:'fixture-user',token_use:'id',iat:Math.floor(clock/1000),exp:Math.floor(clock/1000)+3600,nonce,email:'owner@example.test',email_verified:true,...changes})).toString('base64url');return header+'.'+body+'.'+sign('RSA-SHA256',Buffer.from(header+'.'+body),privateKey).toString('base64url');}
const options={issuer,clientId,nonce,keys:[jwk],now:clock};
test('Identité Cognito : signature, émetteur, audience, usage, nonce, e-mail vérifié et expiration',()=>{
  assert.equal(verifyCognitoIdToken(token(),options).sub,'fixture-user');
  for(const change of [{iss:'https://attacker.test'},{aud:'wrong-client'},{token_use:'access'},{nonce:'wrong'},{email_verified:false},{exp:1},{nbf:Math.floor(clock/1000)+3600}])assert.throws(()=>verifyCognitoIdToken(token(change),options),error=>error.code==='INVALID_IDENTITY');
  assert.throws(()=>verifyCognitoIdToken(token({}, {alg:'none'}),options));const corrupted=token().split('.');corrupted[1]=Buffer.from('{}').toString('base64url');assert.throws(()=>verifyCognitoIdToken(corrupted.join('.'),options));
});
test('Code OAuth à usage unique, PKCE, contrôle du propriétaire et aucun jeton envoyé à l’interface',async()=>{
  const values={FOLIO_COGNITO_REGION:region,FOLIO_COGNITO_USER_POOL_ID:pool,FOLIO_COGNITO_CLIENT_ID:clientId,FOLIO_COGNITO_DOMAIN:`https://fixture.auth.${region}.amazoncognito.com`,FOLIO_COGNITO_REDIRECT_URI:'http://localhost:5173/api/auth/callback',FOLIO_COGNITO_OWNER_EMAIL:'owner@example.test'};
  let expectedNonce,expectedChallenge;const adapter=createCognitoLogin({values,now:()=>clock,fetcher:async(url,options)=>{if(String(url).endsWith('/oauth2/token')){const parameters=new URLSearchParams(options.body);assert.equal(createHash('sha256').update(parameters.get('code_verifier')).digest('base64url'),expectedChallenge);return new Response(JSON.stringify({id_token:token({nonce:expectedNonce})}));}assert.equal(String(url),issuer+'/.well-known/jwks.json');return new Response(JSON.stringify({keys:[jwk]}));}});
  const started=adapter.start({headers:{host:'localhost:5173'}}),authorize=new URL(started.location);expectedNonce=authorize.searchParams.get('nonce');expectedChallenge=authorize.searchParams.get('code_challenge');assert.equal(authorize.searchParams.get('code_challenge_method'),'S256');assert.ok(!started.location.includes('code_verifier'));
  const callback=new URL(values.FOLIO_COGNITO_REDIRECT_URI+'?code=fixture&state='+authorize.searchParams.get('state')),request={headers:{cookie:started.cookie}};
  const result=await adapter.callback(request,callback);assert.equal(result.user.provider,'cognito');assert.equal(result.user.email,'owner@example.test');assert.equal(result.location,'http://localhost:5173/#home');assert.equal(result.id_token,undefined);
  await assert.rejects(adapter.callback(request,callback),error=>error.code==='INVALID_CALLBACK');
  const badState=new URL(callback);badState.searchParams.set('state','a'.repeat(43));await assert.rejects(adapter.callback(request,badState),error=>error.code==='INVALID_CALLBACK');
});
test('Cognito refuse les destinations arbitraires et reste non configuré sans identifiants',()=>{
  assert.equal(createCognitoLogin().configured,false);
  assert.throws(()=>createCognitoLogin({values:{FOLIO_COGNITO_REGION:region,FOLIO_COGNITO_CLIENT_ID:clientId,FOLIO_COGNITO_USER_POOL_ID:pool,FOLIO_COGNITO_DOMAIN:'https://evil.test',FOLIO_COGNITO_REDIRECT_URI:'http://localhost:5173/api/auth/callback',FOLIO_COGNITO_OWNER_EMAIL:'owner@example.test'}}));
});
test('Un compte AWS non autorisé est refusé et une rotation de clé recharge le JWKS',async()=>{
  const values={FOLIO_COGNITO_REGION:region,FOLIO_COGNITO_USER_POOL_ID:pool,FOLIO_COGNITO_CLIENT_ID:clientId,FOLIO_COGNITO_DOMAIN:`https://fixture.auth.${region}.amazoncognito.com`,FOLIO_COGNITO_REDIRECT_URI:'http://localhost:5173/api/auth/callback',FOLIO_COGNITO_OWNER_EMAIL:'owner@example.test'};
  let expectedNonce,attempt=0,jwksRequests=0;
  const adapter=createCognitoLogin({values,now:()=>clock,fetcher:async url=>{if(String(url).endsWith('/oauth2/token'))return new Response(JSON.stringify({id_token:token({nonce:expectedNonce,email:attempt===1?'outsider@example.test':'owner@example.test'},{kid:attempt===1?'fixture':'rotated'})}));jwksRequests++;return new Response(JSON.stringify({keys:[{...jwk,kid:attempt===1?'fixture':'rotated'}]}));}});
  for(attempt=1;attempt<=2;attempt++){const start=adapter.start({headers:{host:'localhost:5173'}}),authorization=new URL(start.location);expectedNonce=authorization.searchParams.get('nonce');const request={headers:{cookie:start.cookie}},callback=new URL(values.FOLIO_COGNITO_REDIRECT_URI+'?code=fixture&state='+authorization.searchParams.get('state'));if(attempt===1)await assert.rejects(adapter.callback(request,callback),error=>error.code==='ACCESS_DENIED');else assert.equal((await adapter.callback(request,callback)).user.email,'owner@example.test');}
  assert.equal(jwksRequests,2);
});
