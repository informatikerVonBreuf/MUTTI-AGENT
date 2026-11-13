import test from 'node:test';
import assert from 'node:assert/strict';
import {AuthError,createAuthClient,isLocalPreviewAllowed,validateAuthFields} from '../src/auth-client.mjs';
import {authStatus,unavailableAuthResponse} from './auth-contract.mjs';
const connected={configured:true,apiProtected:true,localPreviewAllowed:false};
const reply=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
test('Auth contract exposes no connected identity and never declares the local API protected',()=>{
  const status=authStatus();assert.equal(status.configured,false);assert.equal(status.apiProtected,false);assert.equal(status.authenticated,false);assert.equal(status.provider,null);assert.equal(unavailableAuthResponse().code,'AUTH_NOT_CONNECTED');
});
test('Local preview cannot be enabled for a public hostname or interpreted as a connected session',()=>{
  for(const host of ['localhost','127.0.0.1','[::1]'])assert.equal(isLocalPreviewAllowed(authStatus(),host),true);
  for(const host of ['example.com','localhost.example.com','127.0.0.1.example.com'])assert.equal(isLocalPreviewAllowed(authStatus(),host),false);
  assert.equal(isLocalPreviewAllowed({...authStatus(),configured:true},'localhost'),false);assert.equal(isLocalPreviewAllowed(null,'localhost'),false);
});
test('Login validates email and password without imposing a new-password policy on an existing account',()=>{
  assert.deepEqual(validateAuthFields({email:' reader@example.com ',password:'x'}),{});
  assert.deepEqual(validateAuthFields({email:'reader@example.com'},'recovery'),{});
  for(const email of ['',null,'a@b@c.com','name','x'.repeat(260)+'@example.com'])assert.ok(validateAuthFields({email,password:'x'}).email);
  assert.ok(validateAuthFields({email:'reader@example.com',password:''}).password);assert.ok(validateAuthFields({email:'reader@example.com',password:'x'.repeat(1025)}).password);
});
test('Unconfigured login and recovery do not transmit credentials or create a session',async()=>{
  const calls=[],client=createAuthClient(async(...args)=>{calls.push(args);throw new Error('unexpected network call');});
  await assert.rejects(client.signIn({email:'reader@example.com',password:'TEST_ONLY_PASSWORD'},authStatus()),error=>error.code==='AUTH_NOT_CONNECTED');
  await assert.rejects(client.recover({email:'reader@example.com'},authStatus()),error=>error.code==='AUTH_NOT_CONNECTED');assert.equal(calls.length,0);
});
test('The connected adapter sends only expected fields and confirms the session server-side',async()=>{
  const calls=[];const client=createAuthClient(async(url,options)=>{calls.push({url,options});return reply(url.endsWith('/session')?{authenticated:true,user:{id:'test-user'}}:{accepted:true});});
  const session=await client.signIn({email:' reader@example.com ',password:' untouched ',role:'admin'},connected);
  assert.equal(session.user.id,'test-user');assert.equal(calls.length,2);assert.deepEqual(JSON.parse(calls[0].options.body),{email:'reader@example.com',password:' untouched '});assert.equal(calls[0].options.credentials,'same-origin');assert.equal(calls[1].url,'/api/auth/session');
});
test('A successful login response alone never establishes authentication',async()=>{
  const client=createAuthClient(async url=>reply(url.endsWith('/session')?{authenticated:false,user:null}:{authenticated:true,user:{id:'unconfirmed'}}));
  await assert.rejects(client.signIn({email:'reader@example.com',password:'TEST_ONLY_PASSWORD'},connected),error=>error.code==='INVALID_SESSION');
});
test('Provider responses and network exceptions are sanitized rather than reflected to the form',async()=>{
  const client=createAuthClient(async()=>reply({code:'INTERNAL_FAILURE',error:'TEST_SECRET_NEVER_DISPLAY'},500));
  await assert.rejects(client.signIn({email:'reader@example.com',password:'x'},connected),error=>error instanceof AuthError&&!error.message.includes('TEST_SECRET_NEVER_DISPLAY'));
  const offline=createAuthClient(async()=>{throw new Error('DATABASE_URL_TEST_SECRET');});await assert.rejects(offline.status(),error=>error.code==='NETWORK_ERROR'&&!error.message.includes('DATABASE_URL'));
});
test('Recovery requires a confirmed request before the UI can announce acceptance',async()=>{
  const client=createAuthClient(async()=>reply({accepted:false}));await assert.rejects(client.recover({email:'reader@example.com'},connected),error=>error.code==='INVALID_RESPONSE');
  const accepted=createAuthClient(async()=>reply({accepted:true}));assert.deepEqual(await accepted.recover({email:'reader@example.com'},connected),{accepted:true});
});
test('Malformed authentication status cannot authorize preview',async()=>{
  const client=createAuthClient(async()=>reply({configured:false}));await assert.rejects(client.status(),error=>error.code==='INVALID_RESPONSE');
});
