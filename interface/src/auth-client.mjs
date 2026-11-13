export class AuthError extends Error {
  constructor(code,message){super(message);this.name='AuthError';this.code=code;}
}
export const AUTH_UNAVAILABLE='Les accès invités ne sont pas encore activés. Aucun identifiant n’a été envoyé.';
export function validateAuthFields({email,password}={},mode='login'){
  const errors={};
  if(typeof email!=='string'||email.trim().length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))errors.email='Indiquez une adresse e-mail valide.';
  if(mode==='login'&&(typeof password!=='string'||password.length===0))errors.password='Saisissez votre mot de passe.';
  else if(mode==='login'&&password.length>1024)errors.password='Ce mot de passe est trop long.';
  return errors;
}
export function isLocalPreviewAllowed(status,hostname){return status?.mode==='local_preview'&&status?.localPreviewAllowed===true&&status?.configured===false&&['localhost','127.0.0.1','[::1]','::1'].includes(hostname);}
const messages={AUTH_NOT_CONNECTED:AUTH_UNAVAILABLE,INVALID_CREDENTIALS:'L’adresse ou le mot de passe ne permet pas de se connecter.',RATE_LIMITED:'Trop de tentatives. Patientez avant de réessayer.',SESSION_EXPIRED:'Votre session a expiré. Connectez-vous à nouveau.'};
export function createAuthClient(fetcher=(...args)=>fetch(...args)){
  async function request(path,options={}){
    let response;
    try{response=await fetcher(path,{...options,credentials:'same-origin',cache:'no-store'});}catch(error){if(error.name==='AbortError')throw error;throw new AuthError('NETWORK_ERROR','Le service est injoignable. Vérifiez que l’application est démarrée.');}
    let data;try{data=await response.json();}catch{throw new AuthError('INVALID_RESPONSE','Le service de connexion ne répond pas correctement.');}
    if(!response.ok)throw new AuthError(data.code||'AUTH_ERROR',messages[data.code]||'La demande n’a pas abouti. Réessayez dans un instant.');
    return data;
  }
  function requireConnected(status){if(status?.configured!==true||status?.apiProtected!==true)throw new AuthError('AUTH_NOT_CONNECTED',AUTH_UNAVAILABLE);}
  return {
    async status({signal}={}){const data=await request('/api/auth/status',{signal});if(typeof data.configured!=='boolean'||typeof data.apiProtected!=='boolean'||typeof data.localPreviewAllowed!=='boolean')throw new AuthError('INVALID_RESPONSE','Service de connexion indisponible.');return data;},
    session:({signal}={})=>request('/api/auth/session',{signal}),
    async signIn(fields,status){
      if(Object.keys(validateAuthFields(fields)).length)throw new AuthError('INVALID_FIELDS','Vérifiez votre adresse et votre mot de passe.');
      requireConnected(status);
      await request('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:fields.email.trim(),password:fields.password})});
      const session=await request('/api/auth/session');
      if(session.authenticated!==true||typeof session.user?.id!=='string'||!session.user.id)throw new AuthError('INVALID_SESSION','La session n’a pas pu être confirmée. Réessayez de vous connecter.');
      return session;
    },
    async recover(fields,status){
      if(Object.keys(validateAuthFields(fields,'recovery')).length)throw new AuthError('INVALID_FIELDS','Vérifiez votre adresse e-mail.');
      requireConnected(status);
      const result=await request('/api/auth/recovery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:fields.email.trim()})});
      if(result.accepted!==true)throw new AuthError('INVALID_RESPONSE','La demande de récupération n’a pas pu être confirmée.');
      return {accepted:true};
    },
  };
}
