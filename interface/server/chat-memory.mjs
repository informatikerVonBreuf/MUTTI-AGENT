import { randomUUID } from 'node:crypto';
const clean=value=>value.trim().replace(/\s+/g,' ');
const normalized=value=>clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const patterns=[
  {type:'objectif',pattern:/\b(objectif|priorit[eé]|je (?:veux|souhaite|voudrais)|nous (?:voulons|souhaitons))\b/i,weight:3},
  {type:'preference',pattern:/\b(pr[eé]f[eè]re|pr[eé]f[eé]rence|toujours|jamais|uniquement|seulement)\b/i,weight:2},
  {type:'decision',pattern:/\b(d[eé]cid[eé]|d[eé]cision|retenons|on garde|on part|nous gardons|[aà] retenir|retiens|souviens-toi|important)\b/i,weight:4},
  {type:'contrainte',pattern:/\b([eé]ch[eé]ance|avant le|budget|limite|obligatoire|ne pas|[aà] [eé]viter)\b/i,weight:3},
];
export function extractMemories(content,messageId,existing=[]){
  const additions=[];
  for(const sentence of content.split(/\n+|(?<=[.!?])\s+/)){
    const text=clean(sentence);if(text.length<12)continue;
    const rule=patterns.find(item=>item.pattern.test(normalized(text)));if(!rule)continue;
    const shortened=text.length>500?text.slice(0,497)+'…':text;
    if([...existing,...additions].some(note=>normalized(note.text)===normalized(shortened)))continue;
    additions.push({id:randomUUID(),text:shortened,type:rule.type,weight:rule.weight,method:'local_rules',sourceMessageId:messageId,pinned:false,createdAt:new Date().toISOString()});
  }
  return additions.slice(0,4);
}
export function effectivePriority(thread){
  if(thread.priorityManual)return thread.priority;
  if(thread.pinned)return 'essential';
  return thread.memory.some(note=>note.pinned||note.weight>=3)?'important':'normal';
}
export function boundedContext(thread,linkedNotes=[]){
  const notes=[...thread.memory,...linkedNotes].sort((a,b)=>Number(b.pinned)-Number(a.pinned)||(b.weight||1)-(a.weight||1)||String(b.createdAt).localeCompare(a.createdAt));
  let size=0;const memory=[],seen=new Set();
  for(const note of notes){const identity=normalized(note.text);if(seen.has(identity)||memory.length>=8||size+note.text.length>3200)continue;seen.add(identity);memory.push({text:note.text,type:note.type,origin:note.sourceThreadId?'linked_chat':'current_chat'});size+=note.text.length;}
  let budget=16000;const recentMessages=[];
  for(const message of thread.messages.slice(-8).reverse()){if(!budget)break;const content=message.content.slice(0,budget);recentMessages.unshift({role:message.role,content,truncated:content.length<message.content.length});budget-=content.length;}
  return {memory,recentMessages,mode:'local_preparation'};
}
