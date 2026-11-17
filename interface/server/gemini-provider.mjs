import {BackendError} from './python-bridge.mjs';
import {usageFromGemini} from './run-metrics.mjs';
export async function callGemini(config,request,{signal,fetcher=fetch,onUsage}={}){
  if(!config.apiKey)throw new BackendError('MISSING_KEY');
  const operation=request.operation||'generate';if(!['probe','generate'].includes(operation))throw new BackendError('INVALID_OUTPUT');
  let body;
  if(operation==='generate'){
    if(typeof request.system!=='string'||request.system.length>6000||!request.schema||typeof request.schema!=='object')throw new BackendError('INVALID_OUTPUT');
    const text=JSON.stringify(request.payload);if(text.length>100000)throw new BackendError('INVALID_OUTPUT');
    const modern=/^gemini-3[.-]/.test(config.model);
    body={systemInstruction:{parts:[{text:request.system}]},contents:[{role:'user',parts:[{text}]}],generationConfig:{temperature:modern?1:.1,maxOutputTokens:modern?4096:3000,responseMimeType:'application/json',responseSchema:request.schema,thinkingConfig:modern?{thinkingLevel:'low'}:{thinkingBudget:0}}};
  }
  const timeout=AbortSignal.timeout(35000),combined=signal?AbortSignal.any([signal,timeout]):timeout;
  const started=performance.now();
  let response;
  try{response=await fetcher('https://generativelanguage.googleapis.com/v1beta/models/'+config.model+(operation==='generate'?':generateContent':''),{method:body?'POST':'GET',headers:{'x-goog-api-key':config.apiKey,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:combined});}
  catch(error){if(signal?.aborted)throw new BackendError('CANCELLED');if(timeout.aborted)throw new BackendError('TIMEOUT');throw new BackendError('MODEL_UNAVAILABLE');}
  if(!response.ok)throw new BackendError([401,403].includes(response.status)?'MODEL_AUTH':response.status===429?'MODEL_QUOTA':response.status===404?'MODEL_NOT_FOUND':response.status===400?'MODEL_REQUEST':'MODEL_UNAVAILABLE');
  let data;try{const text=await response.text();if(text.length>1_000_000)throw new Error();data=JSON.parse(text);}catch{throw new BackendError('INVALID_OUTPUT');}
  if(operation==='probe'){if(!data.supportedGenerationMethods?.includes('generateContent'))throw new BackendError('MODEL_UNAVAILABLE');return {connected:true,model:config.model};}
  // Un appel accepté est facturé même si sa sortie est ensuite refusée : l'usage est relevé avant l'analyse.
  try{onUsage?.(usageFromGemini(data),performance.now()-started);}catch{}
  try{const parts=data.candidates[0].content.parts;const result=JSON.parse(parts.filter(part=>!part.thought).map(part=>part.text||'').join(''));if(!result||typeof result!=='object'||Array.isArray(result))throw new Error();return result;}catch{throw new BackendError('INVALID_OUTPUT');}
}
