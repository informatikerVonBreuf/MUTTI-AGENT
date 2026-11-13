// UI contract only. No identity provider, account store or private API protection
// is connected yet. Do not mark configured=true until authorization is enforced.
export function authStatus(){return {mode:'local_preview',configured:false,authenticated:false,provider:null,apiProtected:false,localPreviewAllowed:true,invitationOnly:true};}
export function unavailableAuthResponse(){return {code:'AUTH_NOT_CONNECTED',error:'Les accès invités ne sont pas encore activés.'};}
