import React, {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {ArrowLeft, ArrowUp, Brain, Check, Copy, Download, FileDown, FileText, MessageSquare, Pencil, Plus, Search, ShieldCheck, SlidersHorizontal, Trash2, X} from 'lucide-react';
import {FolioMark} from './Identity.jsx';
import RunActivity from './RunActivity.jsx';
import {CharacterCount, Markdown, useNow} from './components/Primitives.jsx';
import {backendState, companyLabel, documentTitle, formatFullDate, formatMessageTime, formatRelative, plural, recencyGroup} from './format.mjs';
import {downloadThread} from './export.mjs';
import {downloadDocx} from './export-docx.mjs';

export const priorities = {normal: 'Normal', important: 'Important', essential: 'Essentiel'};
const MAX_QUESTION = 4000;
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function Citations({citations, documents, onOpenDocument}) {
  const byId = useMemo(() => new Map(documents.map(doc => [doc.id, doc])), [documents]);
  return <div className="chat-sources">
    <p className="chat-sources-heading"><ShieldCheck size={13}/>{plural(citations.length, 'source contrôlée', 'sources contrôlées')} · extraits retrouvés mot pour mot</p>
    <ol className="chat-citations">{citations.map((citation, index) => {
      const doc = byId.get(citation.documentId);
      return <li key={index}><button type="button" onClick={() => onOpenDocument(citation.documentId, {page: citation.page, quote: citation.quote})} aria-label={`Ouvrir la source ${index + 1} : ${doc ? documentTitle(doc) : citation.title}${citation.page ? ', page ' + citation.page : ''}`}>
        <span className="citation-number">{index + 1}</span>
        <span className="citation-text"><strong>{doc ? documentTitle(doc) : citation.title}</strong>{citation.page ? <span className="citation-page">p. {citation.page}</span> : null}
          {citation.quote && <small className="citation-quote">« {citation.quote} »</small>}</span>
      </button></li>;
    })}</ol>
  </div>;
}

// Indice d'appui documentaire : uniquement des faits vérifiables (citations exactes, sources distinctes).
// Ce n'est pas une probabilité que la réponse soit vraie.
function AnswerSupport({message}) {
  const sources = new Set(message.citations.map(citation => citation.documentId)).size;
  const level = message.simulated ? ['simulated', 'Simulé'] : sources >= 2 ? ['strong', 'Appui croisé'] : ['simple', 'Appui unique'];
  return <p className={'answer-support support-' + level[0]} title="Indice d’appui documentaire, pas une probabilité de vérité.">
    <strong>{level[1]}</strong>
    <span>{plural(message.citations.length, 'citation exacte contrôlée', 'citations exactes contrôlées')} · {plural(sources, 'rapport distinct', 'rapports distincts')}{message.simulated ? ' · réponse simulée, sans modèle' : sources < 2 ? ' · à recouper si la décision en dépend' : ''}</span>
  </p>;
}

// Suggestions tirées du corpus réel : entreprises présentes et dernier exercice annuel disponible.
const of = name => (/^[aeiouyhâéèêîôû]/i.test(name) ? 'd’' : 'de ') + name;
export function questionSuggestions(documents = []) {
  const latest = new Map();
  for (const doc of documents) if (doc.type === '10-K' && doc.year && (!latest.has(doc.company) || doc.year > latest.get(doc.company))) latest.set(doc.company, doc.year);
  const entries = [...latest].sort((a, b) => a[0].localeCompare(b[0]));
  const suggestions = [];
  const [first, second] = entries;
  if (first) suggestions.push(`Quel est le chiffre d’affaires total ${of(companyLabel(first[0]))} pour l’exercice ${first[1]} ?`);
  if (second) suggestions.push(`Quels risques ${companyLabel(second[0])} met-il en avant dans son rapport annuel ${second[1]} ?`);
  if (entries[2]) suggestions.push(`Quel est le résultat net ${of(companyLabel(entries[2][0]))} pour l’exercice ${entries[2][1]} ?`);
  if (first && second && first[1] === second[1]) suggestions.push(`Compare le résultat opérationnel ${of(companyLabel(first[0]))} et ${of(companyLabel(second[0]))} en ${first[1]}.`);
  return suggestions.slice(0, 4);
}

function MessageItem({message, thread, backend, documents, onRetain, onMemory, onOpenDocument}) {
  const [copied, setCopied] = useState(false);
  const retained = thread.memory.some(note => note.sourceMessageId === message.id);
  const user = message.role === 'user';
  const showCitations = (backend.connected || message.citationsVerified) && Array.isArray(message.citations) && message.citations.length > 0;
  async function copy() {
    try { await navigator.clipboard.writeText(message.content); setCopied(true); setTimeout(() => setCopied(false), 2200); } catch { setCopied(false); }
  }
  return <article className={`chat-message role-${message.role}`}>
    <div className="message-meta"><span>{user ? 'Vous' : 'Folio'}</span><time dateTime={message.createdAt} title={formatFullDate(message.createdAt)}>{formatMessageTime(message.createdAt)}</time></div>
    <div className="message-body">{user ? <p>{message.content}</p> : <Markdown text={message.content}/>}</div>
    {showCitations && <Citations citations={message.citations} documents={documents} onOpenDocument={onOpenDocument}/>}
    {!user && showCitations && <AnswerSupport message={message}/>}
    <div className="message-actions">
      {user && <button type="button" onClick={() => retained ? onMemory(thread) : onRetain(thread, message)} aria-label={retained ? 'Voir ce point dans la mémoire' : 'Retenir ce message dans la mémoire'}>{retained ? <Check size={13}/> : <Brain size={13}/>}<span>{retained ? 'En mémoire' : 'Retenir'}</span></button>}
      {!user && <button type="button" onClick={copy} aria-label="Copier la réponse">{copied ? <Check size={13}/> : <Copy size={13}/>}<span>{copied ? 'Copiée' : 'Copier'}</span></button>}
      <span className="saved-label"><Check size={11}/>Enregistré</span>
    </div>
  </article>;
}

export default function ChatPanel({thread, backend = {connected: false}, sending, onSend, onMemory, onRetain, onPriority, onRename, onDelete, onOpenDocument, documents = [], onChooseDocuments, onRetryRun, onStopRun, onClearScope, onCheckBackend, onBack}) {
  const [draft, setDraft] = useState('');
  const messagesRef = useRef(null), bottomRef = useRef(null), textareaRef = useRef(null), lastCount = useRef(0);
  const running = thread?.lastRun?.status === 'running';
  const processing = sending || running;
  const state = backendState(backend);
  const now = useNow(60000);
  const messageCount = thread?.messages.length || 0;
  const scoped = thread?.documentIds?.length > 0;
  const scopeDocuments = scoped ? thread.documentIds.map(id => documents.find(doc => doc.id === id)).filter(Boolean) : [];

  useEffect(() => { if (!sending) setDraft(''); }, [thread?.id]);
  // Défilement : uniquement dans la zone des messages quand elle défile, sinon jusqu’au dernier message ajouté.
  useIsomorphicLayoutEffect(() => {
    const container = messagesRef.current;
    if (!container) return;
    if (!messageCount && !thread?.lastRun) { container.scrollTop = 0; lastCount.current = 0; return; }
    const scrollable = container.scrollHeight > container.clientHeight + 1 && getComputedStyle(container).overflowY !== 'visible';
    const added = messageCount > lastCount.current;
    if (scrollable) container.scrollTop = container.scrollHeight;
    else if (added && lastCount.current) bottomRef.current?.scrollIntoView({block: 'nearest'});
    lastCount.current = messageCount;
  }, [thread?.id, messageCount, thread?.lastRun?.status]);

  async function submit(event) {
    event.preventDefault();
    if (!draft.trim() || processing) return;
    const success = await onSend(draft);
    if (success) setDraft('');
  }
  const composerHint = running ? 'Une analyse est en cours : vous pouvez préparer votre prochaine question, l’envoi sera possible à la fin.'
    : sending ? 'Enregistrement de votre message et préparation de la recherche…'
    : state === 'simulated' ? 'Mode simulé : la réponse sera un extrait littéral étiqueté, sans appel au modèle.'
    : state !== 'ready' && state !== 'checking' ? 'Votre message sera enregistré ; la réponse nécessite le modèle IA.'
    : null;

  return <section className="chat-panel" aria-label={thread ? `${thread.kind === 'thematic' ? 'Session thématique' : 'Conversation'} : ${thread.title}` : 'Nouvelle conversation'}>
    <header className="chat-panel-header">
      {onBack && <button type="button" className="chat-back" onClick={onBack}><ArrowLeft size={15}/>Toutes les conversations</button>}
      <div className="chat-title-block">
        <span className="eyebrow">{thread?.kind === 'thematic' ? 'SESSION THÉMATIQUE' : 'CONVERSATION'}</span>
        <h2>{thread?.title || 'Une nouvelle conversation.'}</h2>
        {thread && <p className="chat-subtitle">{plural(messageCount, 'message')} · {thread.createdAt ? <>ouverte <time dateTime={thread.createdAt} title={formatFullDate(thread.createdAt)}>{formatRelative(thread.createdAt, now)}</time></> : 'sauvegarde locale'}{thread.memory.length ? ` · ${plural(thread.memory.length, 'point retenu', 'points retenus')}` : ''}</p>}
      </div>
      {thread && <div className="chat-tools">
        <button className="small-icon" title="Renommer" aria-label="Renommer la conversation" disabled={sending} onClick={() => onRename(thread)}><Pencil size={16}/></button>
        {thread.messages.some(message => message.role === 'assistant') && <button className="small-icon" title="Exporter en Markdown" aria-label="Exporter cet échange en Markdown" onClick={() => downloadThread(thread, documents)}><Download size={16}/></button>}
        {thread.messages.some(message => message.role === 'assistant') && <button className="small-icon" title="Exporter en Word (.docx)" aria-label="Exporter cet échange en Word" onClick={() => downloadDocx(thread, documents)}><FileDown size={16}/></button>}
        <button className="memory-trigger" disabled={sending} onClick={() => onMemory(thread)} aria-label={`Mémoire de l’échange : ${plural(thread.memory.length, 'point')}`}><Brain size={16}/><span>Mémoire</span><b>{thread.memory.length}</b></button>
        <button className="small-icon danger-hover" title="Supprimer" aria-label="Supprimer cette conversation" disabled={sending} onClick={() => onDelete(thread)}><Trash2 size={16}/></button>
      </div>}
    </header>
    {thread && <div className="chat-session-meta">
      <label>Importance<select aria-label="Importance de la conversation" value={thread.effectivePriority} disabled={sending} onChange={event => onPriority(thread, event.target.value)}><option value="normal">Normale</option><option value="important">Importante</option><option value="essential">Essentielle</option></select></label>
      <span>{thread.priorityManual ? 'Choisie par vous' : 'Estimée d’après les points retenus'} · sauvegarde locale</span>
    </div>}
    {!backend.connected && <div className={'backend-notice backend-' + state} role="status"><span className="quiet-status"/><p>{backend.state === 'checking' ? 'Vérification de la connexion au modèle IA…' : backend.error?.message || 'Le backend IA n’est pas encore connecté. Vos messages sont conservés.'}</p>{onCheckBackend && backend.configured && backend.state !== 'disabled' && <button className="backend-check" onClick={onCheckBackend} disabled={processing || backend.state === 'checking'}>Vérifier la connexion</button>}</div>}
    <div className="pdf-context">
      <span className="source-auto-label" title={scoped ? scopeDocuments.map(documentTitle).join(', ') : undefined}><ShieldCheck size={14}/>
        {scoped ? <>Recherche ciblée sur {scopeDocuments.length === 1 ? <strong>{documentTitle(scopeDocuments[0])}</strong> : <strong>{plural(thread.documentIds.length, 'document')}</strong>}</> : <>Sources recherchées automatiquement dans vos archives{documents.length ? ` (${plural(documents.length, 'document')})` : ''}</>}
      </span>
      <span className="pdf-context-actions">
        {thread && onChooseDocuments && <button onClick={() => onChooseDocuments(thread)} disabled={sending}><SlidersHorizontal size={13}/>{scoped ? 'Modifier' : 'Restreindre…'}</button>}
        {scoped && <button onClick={() => onClearScope?.(thread)} disabled={sending}><X size={13}/>Utiliser tout le corpus</button>}
      </span>
    </div>
    <div className="chat-messages" ref={messagesRef} aria-live="polite" aria-relevant="additions">
      {!messageCount && <div className="chat-welcome">
        <span className="welcome-mark"><FolioMark size={29}/></span>
        <h3>{thread?.kind === 'thematic' ? 'Un thème, une nouvelle session.' : 'Garder le fil de vos idées.'}</h3>
        <p>{thread?.kind === 'thematic' ? 'Précisez les questions et les attentes de ce résumé. Les points retenus des conversations associées apparaissent à côté.' : 'Posez vos questions, retrouvez les échanges et retenez ce qui compte pour la suite.'}</p>
        <ul className="welcome-promises">
          <li><Search size={14}/>Les passages utiles sont recherchés dans les rapports, sans sélection préalable.</li>
          <li><ShieldCheck size={14}/>Chaque citation est contrôlée mot pour mot ; sans preuve suffisante, Folio s’abstient.</li>
          <li><Brain size={14}/>Objectifs, préférences et décisions sont retenus pour la suite de l’échange.</li>
        </ul>
        <div className="prompt-suggestions">{(thread?.kind === 'thematic' ? ['Je veux un résumé des points clés de ce thème.', 'Priorité : distinguer les décisions et les questions ouvertes.'] : ['Je veux comprendre les résultats de Meta.', 'Mon objectif est de comparer Google et Amazon.']).map(text => <button key={text} onClick={() => { setDraft(text); textareaRef.current?.focus(); }} disabled={sending}>{text}<Plus size={13}/></button>)}</div>
        {thread?.kind !== 'thematic' && questionSuggestions(documents).length > 0 && <div className="question-suggestions" aria-label="Questions possibles sur le corpus">{questionSuggestions(documents).map(text => <button key={text} type="button" onClick={() => { setDraft(text); textareaRef.current?.focus(); }} disabled={sending}><Search size={12}/> {text}</button>)}</div>}
      </div>}
      {thread?.messages.map(message => <MessageItem key={message.id} message={message} thread={thread} backend={backend} documents={documents} onRetain={onRetain} onMemory={onMemory} onOpenDocument={onOpenDocument}/>)}
      <RunActivity run={thread?.lastRun} onRetry={() => onRetryRun?.(thread)} onStop={() => onStopRun?.(thread)} disabled={sending} documents={documents} onOpenDocument={onOpenDocument}/>
      <div ref={bottomRef}/>
    </div>
    <form className="chat-composer" onSubmit={submit}>
      <label className="sr-only" htmlFor="chat-draft">Votre message</label>
      <textarea id="chat-draft" ref={textareaRef} value={draft} onChange={event => setDraft(event.target.value)} maxLength={MAX_QUESTION} aria-describedby="chat-composer-hint" placeholder={thread?.kind === 'thematic' ? 'Préciser ce que ce résumé devra retenir…' : 'Écrire un message…'} rows={2} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(event); } }}/>
      <div className="chat-composer-bottom">
        <span id="chat-composer-hint" className={composerHint ? 'composer-status' : 'composer-keys'}>{composerHint || 'Entrée pour envoyer · Maj + Entrée pour une nouvelle ligne'}</span>
        <CharacterCount value={draft} max={MAX_QUESTION}/>
        <button type="submit" disabled={!draft.trim() || processing} aria-label="Envoyer le message" title={running ? 'Disponible à la fin de l’analyse en cours' : 'Envoyer'}><ArrowUp size={19}/></button>
      </div>
    </form>
  </section>;
}

const runBadges = {running: 'En cours', failed: 'Échec', interrupted: 'À relancer', cancelled: 'Arrêtée'};

export function ChatHistory({threads, activeId, onSelect, onCreate, onDelete, busy}) {
  const [query, setQuery] = useState('');
  const now = useNow(60000);
  const needle = query.trim().toLowerCase();
  const filtered = threads.filter(thread => (thread.title + ' ' + thread.lastMessage).toLowerCase().includes(needle));
  const groups = [];
  for (const thread of filtered) {
    const label = thread.pinned ? 'Épinglées' : recencyGroup(thread.updatedAt, now);
    if (groups.at(-1)?.label !== label) groups.push({label, items: []});
    groups.at(-1).items.push(thread);
  }
  return <aside className="chat-history" aria-label="Historique des conversations">
    <div className="history-heading"><h2>Vos conversations <span className="history-count">{threads.length}</span></h2><button className="small-icon" onClick={onCreate} disabled={busy} aria-label="Nouvelle conversation" title="Nouvelle conversation"><Plus size={18}/></button></div>
    <button className="history-new button-primary" onClick={onCreate} disabled={busy}><Plus size={16}/>Nouvelle conversation</button>
    <div className="history-search-wrap"><Search size={14}/><input className="history-search" type="search" aria-label="Rechercher dans les conversations" placeholder="Retrouver un échange…" value={query} onChange={event => setQuery(event.target.value)}/></div>
    {needle && <p className="history-results" role="status">{plural(filtered.length, 'conversation trouvée', 'conversations trouvées')}</p>}
    <div className="history-list">
      {groups.map(group => <div className="history-group" key={group.label}>
        <h3 className="history-group-label">{group.label}</h3>
        {group.items.map(thread => <div className={`history-item ${activeId === thread.id ? 'selected' : ''}`} key={thread.id}>
          <button className="history-open" disabled={busy} onClick={() => onSelect(thread.id)} aria-current={activeId === thread.id ? 'true' : undefined}>
            <strong>{thread.title}</strong>
            <span className="history-meta">
              {runBadges[thread.runStatus] && <em className={'history-run run-' + thread.runStatus}>{runBadges[thread.runStatus]}</em>}
              <time dateTime={thread.updatedAt} title={formatFullDate(thread.updatedAt)}>{formatRelative(thread.updatedAt, now)}</time>
            </span>
            <span className="history-tags">
              <span><i className={'priority-dot priority-' + thread.effectivePriority}/>{priorities[thread.effectivePriority]}</span>
              {thread.messageCount > 0 && <span>{plural(thread.messageCount, 'message')}</span>}
              {thread.memoryCount > 0 && <span>{plural(thread.memoryCount, 'point retenu', 'points retenus')}</span>}
              {thread.documentCount > 0 && <span title="Recherche limitée à une sélection"><FileText size={11} aria-hidden="true"/> {plural(thread.documentCount, 'document')} ciblé{thread.documentCount > 1 ? 's' : ''}</span>}
            </span>
          </button>
          <button className="history-delete" disabled={busy} onClick={() => onDelete(thread)} aria-label={'Supprimer ' + thread.title} title="Supprimer"><Trash2 size={15}/></button>
        </div>)}
      </div>)}
      {!filtered.length && <div className="history-empty"><MessageSquare size={22}/><p>{threads.length ? 'Aucune conversation ne correspond à cette recherche.' : 'Votre historique commencera avec le premier échange.'}</p>{needle && <button className="text-button" onClick={() => setQuery('')}>Effacer la recherche</button>}</div>}
    </div>
  </aside>;
}
