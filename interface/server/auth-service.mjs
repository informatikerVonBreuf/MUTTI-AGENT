import {randomBytes,randomUUID,createHash,timingSafeEqual,scrypt as scryptCallback} from 'node:crypto';
import {promisify} from 'node:util';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createCognitoLogin} from './cognito-login.mjs';
import {createAccountLocks,newTotpSecret,otpauthUrl,passwordProblems,verifyTotp} from './account-security.mjs';

const scrypt=promisify(scryptCallback),SESSION_MS=8*60*60*1000,MFA_MS=5*60*1000;
const digest=value=>createHash('sha256').update(value).digest('hex');
const normalizeEmail=value=>typeof value==='string'?value.trim().toLowerCase():'';
const validEmail=value=>value.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const secret=()=>randomBytes(32).toString('base64url');
const hashPassword=(password,salt)=>scrypt(password,salt,64,{N:131072,r:8,p:1,maxmem:256*1024*1024});
const DUMMY_SALT=randomBytes(32).toString('base64url');
export class LoginError extends Error{constructor(code,message,status=400){super(message);this.code=code;this.status=status;}}
export function cookieValue(request,name){const raw=String(request.headers.cookie||'').split(';').map(part=>part.trim()).find(part=>part.startsWith(name+'='));return raw?raw.slice(name.length+1):'';}
export function sessionCookie(token,{secure=false,maxAge=SESSION_MS/1000,name='folio_session',sameSite='Strict'}={}){return `${name}=${token}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${Math.max(0,Math.floor(maxAge))}${secure?'; Secure':''}`;}
// Navigateur résumé pour la liste des sessions : famille et système, jamais la chaîne complète.
export function deviceLabel(userAgent=''){
  const ua=String(userAgent);const browser=/Edg\//.test(ua)?'Edge':/Firefox\//.test(ua)?'Firefox':/Chrome\//.test(ua)?'Chrome':/Safari\//.test(ua)?'Safari':/k6\//.test(ua)?'k6':ua?'Autre client':'Client inconnu';
  const system=/Windows/.test(ua)?'Windows':/Android/.test(ua)?'Android':/iPhone|iPad/.test(ua)?'iOS':/Mac OS X/.test(ua)?'macOS':/Linux/.test(ua)?'Linux':'';
  return system?`${browser} · ${system}`:browser;
}

export async function createAuthService({storageDirectory,values={},fetcher=fetch,now=Date.now,ipOf=request=>request.socket?.remoteAddress||'local'}={}){
  const directory=path.join(storageDirectory,'auth'),ownerFile=path.join(directory,'owner.json'),sessionsFile=path.join(directory,'sessions.json'),membersFile=path.join(directory,'members.json');
  await fs.mkdir(directory,{recursive:true});
  let owner=null;try{owner=JSON.parse(await fs.readFile(ownerFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw new Error('Le compte local est illisible.');}
  if(owner&&(!validEmail(owner.email)||!/^[-a-f0-9]{36}$/.test(owner.id)||! /^[a-f0-9]{128}$/.test(owner.passwordHash)||! /^[a-f0-9]{64}$/.test(owner.recoveryHash)||! /^[A-Za-z0-9_-]{43}$/.test(owner.salt)))throw new Error('Le compte local est invalide.');
  let members=[];try{members=JSON.parse(await fs.readFile(membersFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw new Error('Les sous-comptes sont illisibles.');}
  if(!Array.isArray(members)||members.length>200||members.some(m=>!validEmail(m.email)||!/^[-a-f0-9]{36}$/.test(m.id)||! /^[a-f0-9]{128}$/.test(m.passwordHash)||!Array.isArray(m.companies)))throw new Error('Les sous-comptes sont invalides.');
  const mode=values.FOLIO_AUTH_MODE||'local',secure=values.FOLIO_SECURE_COOKIES==='1';
  if(!['local','cognito'].includes(mode))throw new Error('Mode de connexion inconnu.');
  const cognito=mode==='cognito'?createCognitoLogin({values,fetcher,now}):null;
  const provider=mode==='cognito'?'cognito':'local';
  let sessions=[];try{sessions=JSON.parse(await fs.readFile(sessionsFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw new Error('Les sessions de connexion sont illisibles.');}
  if(!Array.isArray(sessions)||sessions.length>500)throw new Error('Sessions de connexion invalides.');
  sessions=sessions.filter(item=>item.expiresAt>now()&&item.user?.provider===provider);
  let writes=Promise.resolve(),setupPending=false,resetPending=false;const failures=new Map(),locks=createAccountLocks({now,threshold:8}),mfaChallenges=new Map(),pendingTotp=new Map();
  const atomic=(file,data)=>{writes=writes.catch(()=>{}).then(async()=>{await fs.writeFile(file+'.tmp',JSON.stringify(data),{mode:0o600});await fs.rename(file+'.tmp',file);});return writes;};
  const persistSessions=()=>atomic(sessionsFile,sessions),persistOwner=()=>atomic(ownerFile,owner),persistMembers=()=>atomic(membersFile,members);
  const ownerUser=()=>({id:owner.id,email:owner.email,provider:'local',role:'owner'});
  const memberUser=member=>({id:member.id,email:member.email,provider:'local',role:'member',...(member.mustChangePassword?{mustChangePassword:true}:{})});
  const accountById=id=>owner?.id===id?owner:members.find(member=>member.id===id)||null;
  const userFor=account=>account===owner?ownerUser():memberUser(account);
  const publicMember=member=>({id:member.id,email:member.email,role:'member',companies:[...member.companies],disabled:Boolean(member.disabled),mustChangePassword:Boolean(member.mustChangePassword),mfaEnabled:Boolean(member.totpSecret),createdAt:member.createdAt,lastLoginAt:member.lastLoginAt||null});
  async function saveAccount(account){if(account===owner)await persistOwner();else await persistMembers();}
  function status(){return {mode:provider==='local'?'local_owner':'cognito',provider,configured:provider==='local'||cognito.configured,apiProtected:true,authenticated:false,localPreviewAllowed:false,invitationOnly:true,setupRequired:provider==='local'&&!owner,recoveryMode:provider==='local'?'local_code':'provider',loginUrl:provider==='cognito'&&cognito.configured?'/api/auth/redirect':null,passwordMinLength:12,mfa:provider==='local',subAccounts:provider==='local'};}
  function strongPassword(password,email){const problems=passwordProblems(password,email);if(problems.length)throw Object.assign(new LoginError('WEAK_PASSWORD','Mot de passe refusé : '+problems.join(', ')+'.'),{problems});}
  function validate(fields,{newPassword=false}={}){const email=normalizeEmail(fields?.email),password=fields?.password;if(!validEmail(email)||typeof password!=='string'||password.length>1024||(newPassword?password.length<12:!password.length))throw new LoginError('INVALID_FIELDS',newPassword?'Utilisez une adresse valide et un mot de passe d’au moins 12 caractères.':'Vérifiez votre adresse e-mail et votre mot de passe.');if(newPassword)strongPassword(password,email);return {email,password};}
  function rateLimit(key){const entry=failures.get(key);if(entry&&entry.until>now()&&entry.count>=6)throw new LoginError('RATE_LIMITED','Trop de tentatives. Patientez quinze minutes.',429);if(entry?.until<=now())failures.delete(key);}
  function failed(key){const entry=failures.get(key);failures.set(key,{count:(entry?.until>now()?entry.count:0)+1,until:entry?.until>now()?entry.until:now()+15*60*1000});if(failures.size>1000)for(const [key,item] of failures)if(item.until<=now())failures.delete(key);}
  async function establish(user,oldToken='',expiresAt=now()+SESSION_MS,request=null){const token=secret(),tokenHash=digest(token);sessions=sessions.filter(item=>item.expiresAt>now()&&item.tokenHash!==digest(oldToken));if(sessions.length>=100)sessions.shift();sessions.push({tokenHash,user:{id:user.id,email:user.email,provider:user.provider},createdAt:now(),device:deviceLabel(request?.headers?.['user-agent']),expiresAt:Math.min(expiresAt,now()+SESSION_MS)});await persistSessions();return {cookie:sessionCookie(token,{secure,maxAge:(Math.min(expiresAt,now()+SESSION_MS)-now())/1000}),session:{authenticated:true,user}};}
  function currentEntry(request){const token=cookieValue(request,'folio_session');if(!/^[A-Za-z0-9_-]{40,60}$/.test(token))return null;return sessions.find(item=>item.tokenHash===digest(token)&&item.expiresAt>now())||null;}
  function session(request){
    if(provider==='cognito'&&!cognito.configured||provider==='local'&&!owner)return {authenticated:false,user:null};
    const entry=currentEntry(request);if(!entry)return {authenticated:false,user:null};
    if(provider!=='local')return {authenticated:true,user:entry.user};
    // Rôle et état relus à chaque requête : un sous-compte désactivé perd l'accès immédiatement.
    const account=accountById(entry.user.id);if(!account||account.disabled)return {authenticated:false,user:null};
    return {authenticated:true,user:userFor(account)};
  }
  const requireLocal=()=>{if(provider!=='local')throw new LoginError('AUTH_REDIRECT_REQUIRED','Continuez sur la page de connexion AWS.',409);};
  async function setup(fields,request){if(provider!=='local'||owner||setupPending)throw new LoginError('SETUP_CLOSED','Le compte propriétaire existe déjà.',409);setupPending=true;try{const {email,password}=validate(fields,{newPassword:true}),salt=secret(),passwordHash=(await hashPassword(password,salt)).toString('hex'),recoveryCode=secret();const record={version:1,id:randomUUID(),email,salt,passwordHash,passwordAlgorithm:'scrypt-N131072-r8-p1',recoveryHash:digest(recoveryCode),createdAt:new Date(now()).toISOString()};try{await fs.writeFile(ownerFile,JSON.stringify(record),{flag:'wx',mode:0o600});}catch(error){if(error.code==='EEXIST')throw new LoginError('SETUP_CLOSED','Le compte propriétaire existe déjà.',409);throw error;}owner=record;return {...await establish(ownerUser(),cookieValue(request,'folio_session'),undefined,request),recoveryCode};}finally{setupPending=false;}}
  async function login(fields,request){
    requireLocal();if(!owner)throw new LoginError('SETUP_REQUIRED','Créez d’abord votre compte propriétaire.',409);
    const key=ipOf(request);rateLimit(key);const {email,password}=validate(fields);
    if(locks.lockedUntil(email))throw new LoginError('RATE_LIMITED','Trop de tentatives sur ce compte. Réessayez plus tard.',429);
    const account=owner.email===email?owner:members.find(member=>member.email===email)||null;
    // Même calcul scrypt pour une adresse inconnue : la durée ne révèle pas l'existence d'un compte.
    const computed=await hashPassword(password,account?.salt||DUMMY_SALT);
    if(!account||!timingSafeEqual(computed,Buffer.from(account.passwordHash,'hex'))||account.disabled){failed(key);locks.failure(email);throw new LoginError('INVALID_CREDENTIALS','L’adresse ou le mot de passe ne permet pas de se connecter.',401);}
    failures.delete(key);locks.success(email);
    if(account.totpSecret){
      const challenge=secret();mfaChallenges.set(challenge,{id:account.id,expiresAt:now()+MFA_MS,attempts:0,oldToken:cookieValue(request,'folio_session')});
      for(const [token,item] of mfaChallenges)if(item.expiresAt<now())mfaChallenges.delete(token);
      return {mfaRequired:true,challenge,expiresIn:MFA_MS/1000};
    }
    account.lastLoginAt=new Date(now()).toISOString();await saveAccount(account);
    return establish(userFor(account),cookieValue(request,'folio_session'),undefined,request);
  }
  async function verifyMfa(fields,request){
    requireLocal();const key=ipOf(request);rateLimit(key);
    const entry=mfaChallenges.get(String(fields?.challenge||''));
    if(!entry||entry.expiresAt<now())throw new LoginError('MFA_EXPIRED','La vérification a expiré. Reconnectez-vous.',401);
    const account=accountById(entry.id);if(!account||account.disabled||!account.totpSecret){mfaChallenges.delete(fields.challenge);throw new LoginError('MFA_EXPIRED','La vérification a expiré. Reconnectez-vous.',401);}
    const step=verifyTotp(account.totpSecret,String(fields?.code||''),{now:now(),lastStep:account.totpLastStep??-1});
    if(step===null){entry.attempts++;failed(key);locks.failure(account.email);if(entry.attempts>=5)mfaChallenges.delete(fields.challenge);throw new LoginError('INVALID_MFA','Code de vérification incorrect ou déjà utilisé.',401);}
    mfaChallenges.delete(fields.challenge);account.totpLastStep=step;account.lastLoginAt=new Date(now()).toISOString();await saveAccount(account);
    return establish(userFor(account),entry.oldToken,undefined,request);
  }
  async function reset(fields,request){requireLocal();if(resetPending)throw new LoginError('RATE_LIMITED','Une récupération est déjà en cours.',429);resetPending=true;try{const key=ipOf(request);rateLimit(key);const {email,password}=validate({email:fields?.email,password:fields?.newPassword},{newPassword:true});const supplied=typeof fields?.recoveryCode==='string'?fields.recoveryCode.trim():'';if(!owner||email!==owner.email||!timingSafeEqual(Buffer.from(digest(supplied),'hex'),Buffer.from(owner.recoveryHash,'hex'))){failed(key);throw new LoginError('INVALID_RECOVERY','Le code de récupération ou l’adresse est incorrect.',401);}const recoveryCode=secret(),salt=secret(),updated={...owner,salt,passwordHash:(await hashPassword(password,salt)).toString('hex'),recoveryHash:digest(recoveryCode)};await fs.writeFile(ownerFile+'.tmp',JSON.stringify(updated),{mode:0o600});await fs.rename(ownerFile+'.tmp',ownerFile);owner=updated;sessions=sessions.filter(item=>item.user.id!==owner.id);await persistSessions();failures.delete(key);locks.success(email);return {recoveryCode,cookie:sessionCookie('',{secure,maxAge:0})};}finally{resetPending=false;}}
  async function logout(request){const token=cookieValue(request,'folio_session');sessions=sessions.filter(item=>item.tokenHash!==digest(token));await persistSessions();return {cookie:sessionCookie('',{secure,maxAge:0}),logoutUrl:cognito?.configured?cognito.logoutUrl:null};}

  // Espace « Mon compte » : sessions actives, mot de passe, double authentification.
  const accountFor=user=>{requireLocal();const account=accountById(user?.id);if(!account||account.disabled)throw new LoginError('SESSION_EXPIRED','Connectez-vous pour accéder à votre atelier.',401);return account;};
  async function checkPassword(account,password){if(typeof password!=='string'||!password||password.length>1024)return false;return timingSafeEqual(await hashPassword(password,account.salt),Buffer.from(account.passwordHash,'hex'));}
  function accountInfo(user){const account=accountFor(user);return {email:account.email,role:account===owner?'owner':'member',mfaEnabled:Boolean(account.totpSecret),mustChangePassword:Boolean(account.mustChangePassword),companies:account===owner?null:[...account.companies],createdAt:account.createdAt,lastLoginAt:account.lastLoginAt||null};}
  function listSessions(user,request){const account=accountFor(user),current=currentEntry(request);return sessions.filter(item=>item.user.id===account.id&&item.expiresAt>now()).map(item=>({id:item.tokenHash.slice(0,12),createdAt:item.createdAt?new Date(item.createdAt).toISOString():null,expiresAt:new Date(item.expiresAt).toISOString(),device:item.device||'Client inconnu',current:item===current}));}
  async function revokeOtherSessions(user,request){const account=accountFor(user),current=currentEntry(request);const before=sessions.length;sessions=sessions.filter(item=>item.user.id!==account.id||item===current);await persistSessions();return {revoked:before-sessions.length};}
  async function changePassword(user,{currentPassword,newPassword}={},request){
    const account=accountFor(user),key=ipOf(request);rateLimit(key);
    if(!await checkPassword(account,currentPassword)){failed(key);throw new LoginError('INVALID_CREDENTIALS','Le mot de passe actuel est incorrect.',401);}
    if(typeof newPassword!=='string'||newPassword.length<12)throw new LoginError('WEAK_PASSWORD','Mot de passe refusé : au moins 12 caractères.');
    strongPassword(newPassword,account.email);if(newPassword===currentPassword)throw new LoginError('WEAK_PASSWORD','Choisissez un mot de passe différent de l’actuel.');
    account.salt=secret();account.passwordHash=(await hashPassword(newPassword,account.salt)).toString('hex');delete account.mustChangePassword;await saveAccount(account);
    const current=currentEntry(request);sessions=sessions.filter(item=>item.user.id!==account.id||item===current);await persistSessions();
    return {changed:true};
  }
  function mfaSetup(user){const account=accountFor(user);if(account.totpSecret)throw new LoginError('MFA_ALREADY_ENABLED','La double authentification est déjà active.',409);const secretKey=newTotpSecret();pendingTotp.set(account.id,{secret:secretKey,expiresAt:now()+10*60*1000});return {secret:secretKey,otpauthUrl:otpauthUrl(secretKey,account.email),expiresIn:600};}
  async function mfaEnable(user,{code,password}={},request){
    const account=accountFor(user),pending=pendingTotp.get(account.id),key=ipOf(request);rateLimit(key);
    if(!pending||pending.expiresAt<now())throw new LoginError('MFA_EXPIRED','Recommencez la configuration : la clé a expiré.',409);
    if(!await checkPassword(account,password)){failed(key);throw new LoginError('INVALID_CREDENTIALS','Le mot de passe est incorrect.',401);}
    const step=verifyTotp(pending.secret,String(code||''),{now:now()});if(step===null)throw new LoginError('INVALID_MFA','Code incorrect : vérifiez l’heure de votre téléphone et réessayez.',401);
    account.totpSecret=pending.secret;account.totpLastStep=step;pendingTotp.delete(account.id);await saveAccount(account);
    const current=currentEntry(request);sessions=sessions.filter(item=>item.user.id!==account.id||item===current);await persistSessions();
    return {mfaEnabled:true};
  }
  async function mfaDisable(user,{code,password}={},request){
    const account=accountFor(user),key=ipOf(request);rateLimit(key);
    if(!account.totpSecret)return {mfaEnabled:false};
    if(!await checkPassword(account,password)){failed(key);throw new LoginError('INVALID_CREDENTIALS','Le mot de passe est incorrect.',401);}
    const step=verifyTotp(account.totpSecret,String(code||''),{now:now(),lastStep:account.totpLastStep??-1});if(step===null)throw new LoginError('INVALID_MFA','Code incorrect ou déjà utilisé.',401);
    delete account.totpSecret;delete account.totpLastStep;await saveAccount(account);return {mfaEnabled:false};
  }

  // Sous-comptes : créés par le propriétaire, rôle « membre », entreprises autorisées, désactivables.
  const requireOwner=user=>{const account=accountFor(user);if(account!==owner)throw new LoginError('FORBIDDEN','Seul le propriétaire gère les sous-comptes.',403);};
  const validCompanies=list=>{if(!Array.isArray(list)||!list.length||list.length>20||list.some(item=>typeof item!=='string'||!/^(\*|[a-z0-9-]{1,40})$/.test(item)))throw new LoginError('INVALID_FIELDS','Choisissez au moins une entreprise autorisée.');return [...new Set(list)];};
  function listMembers(user){requireOwner(user);return members.map(publicMember);}
  async function createMember(user,{email,companies}={}){
    requireOwner(user);const address=normalizeEmail(email);if(!validEmail(address))throw new LoginError('INVALID_FIELDS','Adresse e-mail invalide.');
    if(address===owner.email||members.some(member=>member.email===address))throw new LoginError('ACCOUNT_EXISTS','Un compte utilise déjà cette adresse.',409);
    if(members.length>=50)throw new LoginError('LIMIT_REACHED','Cinquante sous-comptes au plus.',409);
    const invitationCode=secret(),salt=secret();
    const member={id:randomUUID(),email:address,role:'member',companies:validCompanies(companies),salt,passwordHash:(await hashPassword(invitationCode,salt)).toString('hex'),mustChangePassword:true,disabled:false,createdAt:new Date(now()).toISOString(),createdBy:owner.id};
    members.push(member);await persistMembers();return {member:publicMember(member),invitationCode};
  }
  async function updateMember(user,id,patch={}){
    requireOwner(user);const member=members.find(item=>item.id===id);if(!member)throw new LoginError('NOT_FOUND','Sous-compte introuvable.',404);
    if('companies'in patch)member.companies=validCompanies(patch.companies);
    if('disabled'in patch){if(typeof patch.disabled!=='boolean')throw new LoginError('INVALID_FIELDS','État invalide.');member.disabled=patch.disabled;if(member.disabled){sessions=sessions.filter(item=>item.user.id!==member.id);await persistSessions();}}
    let invitationCode=null;
    if(patch.resetInvitation===true){invitationCode=secret();member.salt=secret();member.passwordHash=(await hashPassword(invitationCode,member.salt)).toString('hex');member.mustChangePassword=true;delete member.totpSecret;delete member.totpLastStep;sessions=sessions.filter(item=>item.user.id!==member.id);await persistSessions();}
    await persistMembers();return {member:publicMember(member),...(invitationCode?{invitationCode}:{})};
  }
  async function deleteMember(user,id){requireOwner(user);const before=members.length;members=members.filter(item=>item.id!==id);if(members.length===before)throw new LoginError('NOT_FOUND','Sous-compte introuvable.',404);sessions=sessions.filter(item=>item.user.id!==id);await persistMembers();await persistSessions();return {deleted:true,id};}
  function companiesFor(id){const member=members.find(item=>item.id===id);return member?[...member.companies]:null;}

  return {status,session,setup,login,verifyMfa,reset,logout,accountInfo,listSessions,revokeOtherSessions,changePassword,mfaSetup,mfaEnable,mfaDisable,listMembers,createMember,updateMember,deleteMember,companiesFor,
    async oauthStart(request){if(!cognito?.configured)throw new LoginError('AUTH_NOT_CONNECTED','La configuration AWS Cognito est incomplète.',503);return cognito.start(request);},
    async oauthCallback(request,url){if(!cognito?.configured)throw new LoginError('AUTH_NOT_CONNECTED','La configuration AWS Cognito est incomplète.',503);const result=await cognito.callback(request,url);return {...await establish(result.user,cookieValue(request,'folio_session'),result.expiresAt,request),location:result.location,stateCookie:result.stateCookie};},
    async close(){await writes;}};
}
