// Unconfigured-provider fixture retained for client regression tests.
// The active server uses auth-service.mjs and enforces sessions on business APIs.
export function authStatus(){return {mode:'local_preview',configured:false,authenticated:false,provider:null,apiProtected:false,localPreviewAllowed:true,invitationOnly:true};}
export function unavailableAuthResponse(){return {code:'AUTH_NOT_CONNECTED',error:'Les accès invités ne sont pas encore activés.'};}
