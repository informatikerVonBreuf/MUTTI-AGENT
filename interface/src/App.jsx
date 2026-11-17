import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Check, ChevronRight, FileText, Home, Library, LogOut, MessageSquare, Plus, RefreshCw, UserRound, X} from 'lucide-react';
import {FolioMark} from './Identity.jsx';
import {MotionControl, PageScenery} from './components/PageChrome.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import HomePage from './pages/HomePage.jsx';
import LibraryPage from './pages/LibraryPage.jsx';
import ChatPage from './pages/ChatPage.jsx';
import ThemesPage from './pages/ThemesPage.jsx';
import {DeleteModal, DocumentModal, MemoryModal, RenameModal, ScopeModal, ThemeModal} from './modals/Dialogs.jsx';
import {api, json} from './api.mjs';
import {backendSentence, backendShortLabels, backendState, pageLabels, plural} from './format.mjs';

const PAGES = ['home', 'library', 'chat', 'themes'];
const NAVIGATION = [
  ['home', Home, 'Accueil', 'Accueil'],
  ['library', Library, 'Bibliothèque', 'Bibliothèque'],
  ['chat', MessageSquare, 'Conversations', 'Conversations'],
  ['themes', FileText, 'Résumés thématiques', 'Thèmes'],
];
const readPage = () => {
  if (typeof window === 'undefined') return 'home';
  const value = window.location.hash.slice(1);
  return PAGES.includes(value) ? value : 'home';
};
const readMotion = () => {
  try { return localStorage.getItem('folio-motion') === 'paused' || window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

function BackendChip({backend, onCheck}) {
  const state = backendState(backend);
  const label = 'État du modèle IA : ' + backendSentence(backend);
  const content = <><i className="backend-dot" aria-hidden="true"/><span className="backend-chip-label">{backendShortLabels[state]}</span></>;
  if (backend.configured && backend.state !== 'disabled' && state === 'unavailable') {
    return <button className={'backend-chip state-' + state} onClick={onCheck} title={label + ' Cliquez pour vérifier à nouveau.'} aria-label={label + ' Vérifier à nouveau.'}>{content}<RefreshCw size={12}/></button>;
  }
  return <span className={'backend-chip state-' + state} title={label} role="status" aria-label={label}>{content}</span>;
}

export default function App({onOpenLogin, onSignOut, accountLabel, accessMode = 'local_preview'}) {
  const [workspace, setWorkspace] = useState(null);
  const [page, setPage] = useState(readPage);
  const [libraryView, setLibraryView] = useState({company: null, query: '', type: 'all', year: 'all'});
  const [chat, setChat] = useState(null);
  const [themeSession, setThemeSession] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [modal, setModal] = useState(null);
  const [openedDocument, setOpenedDocument] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [renameTarget, setRenameTarget] = useState(null);
  const [memoryThread, setMemoryThread] = useState(null);
  const [scopeThread, setScopeThread] = useState(null);
  const [motionPaused, setMotionPaused] = useState(readMotion);
  const [trackedThread, setTrackedThread] = useState(null);
  const readerRequest = useRef(0);
  const mainRef = useRef(null);

  const refresh = async () => { const data = await api('/api/workspace'); setWorkspace(data); return data; };
  const load = useCallback(() => {
    let active = true;
    setError('');
    api('/api/workspace').then(data => { if (active) setWorkspace(data); }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.motion = motionPaused ? 'paused' : 'running';
    try { localStorage.setItem('folio-motion', motionPaused ? 'paused' : 'running'); } catch {}
  }, [motionPaused]);
  useEffect(() => { document.documentElement.dataset.theme = 'atelier'; return load(); }, [load]);
  useEffect(() => {
    if (!toast) return undefined;
    const timeout = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(timeout);
  }, [toast]);
  useEffect(() => { document.title = pageLabels[page] + ' | Folio - Archive vivante'; }, [page]);
  useEffect(() => {
    const followHash = () => { const value = window.location.hash.slice(1); if (PAGES.includes(value)) setPage(value); };
    window.addEventListener('hashchange', followHash);
    return () => window.removeEventListener('hashchange', followHash);
  }, []);

  function navigate(next) {
    if (window.location.hash.slice(1) !== next) window.location.hash = next;
    const changed = next !== page;
    setPage(next);
    setError('');
    if (changed) {
      window.scrollTo({top: 0});
      requestAnimationFrame(() => mainRef.current?.focus({preventScroll: true}));
    }
  }
  function applyThread(thread) {
    if (thread.kind === 'thematic') setThemeSession(thread); else setChat(thread);
    setMemoryThread(previous => previous?.id === thread.id ? thread : previous);
  }
  async function openThread(id) {
    if (busy || sending) return;
    setBusy(true); setError('');
    try { const thread = await api('/api/threads/' + id); applyThread(thread); navigate(thread.kind === 'thematic' ? 'themes' : 'chat'); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function newChat(documentIds = []) {
    if (!Array.isArray(documentIds)) documentIds = [];
    if (busy || sending) return;
    setBusy(true); setError('');
    try {
      const thread = await api('/api/threads', json('POST', {kind: 'chat', documentIds}));
      setChat(thread); setModal(null); navigate('chat'); await refresh();
      if (documentIds.length) setToast(`Nouvelle conversation : la recherche est limitée à ${plural(documentIds.length, 'document')}.`);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function startRun(thread, messageId) {
    const run = await api(`/api/threads/${thread.id}/run`, json('POST', {messageId}));
    const updated = await api('/api/threads/' + thread.id);
    applyThread(updated);
    if (run.status === 'running') setTrackedThread(thread.id);
    return run;
  }
  async function send(content) {
    if (sending) return false;
    setSending(true); setError('');
    let saved = false;
    try {
      let current = page === 'themes' ? themeSession : chat;
      if (!current) { current = await api('/api/threads', json('POST', {kind: 'chat'})); setChat(current); navigate('chat'); }
      const result = await api(`/api/threads/${current.id}/messages`, json('POST', {content}));
      saved = true;
      applyThread(result.thread);
      await refresh();
      await startRun(result.thread, result.thread.messages.at(-1).id);
      return true;
    } catch (err) { setError(err.message); return saved; }
    finally { setSending(false); }
  }
  async function retryRun(thread) {
    if (sending) return;
    const messageId = thread.lastRun?.messageId || [...thread.messages].reverse().find(message => message.role === 'user')?.id;
    if (!messageId) return;
    setSending(true);
    try { await startRun(thread, messageId); } catch (err) { setError(err.message); } finally { setSending(false); }
  }
  async function stopRun(thread) {
    try { await api(`/api/threads/${thread.id}/run`, {method: 'DELETE'}); applyThread(await api('/api/threads/' + thread.id)); await refresh(); setToast('L’analyse a été arrêtée. Vous pouvez la relancer à tout moment.'); }
    catch (err) { setError(err.message); }
  }
  async function checkBackend() {
    setWorkspace(previous => previous ? {...previous, backend: {...previous.backend, state: 'checking'}} : previous);
    try { await api('/api/backend/probe', {method: 'POST'}); } catch (err) { setError(err.message); }
    finally { await refresh().catch(err => setError(err.message)); }
  }
  useEffect(() => {
    if (!trackedThread) return undefined;
    let active = true, inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const updated = await api('/api/threads/' + trackedThread);
        if (!active) return;
        setChat(previous => previous?.id === updated.id ? updated : previous);
        setThemeSession(previous => previous?.id === updated.id ? updated : previous);
        if (updated.lastRun?.status !== 'running') { setTrackedThread(null); await refresh(); }
      } catch (err) { if (active) { setTrackedThread(null); setError(err.message); } }
      finally { inFlight = false; }
    };
    const timer = setInterval(poll, 900);
    poll();
    return () => { active = false; clearInterval(timer); };
  }, [trackedThread]);
  useEffect(() => {
    if (!workspace) return undefined;
    const running = workspace.threads.find(thread => thread.runStatus === 'running');
    if (running && !trackedThread) setTrackedThread(running.id);
    if (workspace.backend?.state !== 'checking') return undefined;
    const timer = setTimeout(() => refresh().catch(() => {}), 1500);
    return () => clearTimeout(timer);
  }, [workspace, trackedThread]);

  async function changeThread(thread, patch, success) {
    setError('');
    try { const updated = await api('/api/threads/' + thread.id, json('PATCH', patch)); applyThread(updated); await refresh(); if (success) setToast(success); return true; }
    catch (err) { setError(err.message); return false; }
  }
  function openMemory(thread) { setMemoryThread(thread); setModal('memory'); }
  async function retain(thread, message) {
    try { applyThread(await api(`/api/threads/${thread.id}/memory`, json('POST', {text: message.content.slice(0, 1000), sourceMessageId: message.id}))); await refresh(); setToast('Ce message a été ajouté à la mémoire.'); }
    catch (err) { setError(err.message); }
  }
  async function memoryAction(request, success) {
    if (!memoryThread || busy) return false;
    setBusy(true);
    try { applyThread(await request()); await refresh(); if (success) setToast(success); return true; }
    catch (err) { setError(err.message); return false; }
    finally { setBusy(false); }
  }
  const addMemory = text => memoryAction(() => api(`/api/threads/${memoryThread.id}/memory`, json('POST', {text})), 'Point ajouté à la mémoire.');
  const editMemory = (noteId, text) => memoryAction(() => api(`/api/threads/${memoryThread.id}/memory/${noteId}`, json('PATCH', {text})), 'Point corrigé.');
  const forget = note => memoryAction(() => api(`/api/threads/${memoryThread.id}/memory/${note.id}`, {method: 'DELETE'}), 'Point oublié : il ne sera plus transmis au modèle.');
  function askDelete(thread) { if (busy || sending) return; setDeleteTarget(thread); setModal('delete'); }
  async function deleteConversation() {
    if (!deleteTarget || busy) return;
    setBusy(true); setError('');
    try {
      await api('/api/threads/' + deleteTarget.id, {method: 'DELETE'});
      if (chat?.id === deleteTarget.id) setChat(null);
      if (themeSession?.id === deleteTarget.id) setThemeSession(null);
      else if (themeSession) applyThread(await api('/api/threads/' + themeSession.id));
      if (memoryThread?.id === deleteTarget.id) setMemoryThread(null);
      setModal(null);
      await refresh();
      setToast('La session et sa mémoire ont été supprimées.');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  function rename(thread) { setRenameTarget(thread); setModal('rename'); }
  async function saveTitle(title) { if (await changeThread(renameTarget, {title}, 'Titre enregistré.')) setModal(null); }
  function newTheme() { setModal('theme'); }
  async function createTheme({theme, sourceThreadIds}) {
    if (busy) return;
    setBusy(true); setError('');
    try { const thread = await api('/api/threads', json('POST', {kind: 'thematic', theme, sourceThreadIds})); setThemeSession(thread); setModal(null); navigate('themes'); await refresh(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  const closeModal = useCallback(() => { readerRequest.current++; setModal(null); }, []);
  async function openDocument(id) {
    const request = ++readerRequest.current;
    setModal('document'); setOpenedDocument(null);
    try { const doc = await api('/api/documents/' + id); if (request === readerRequest.current) setOpenedDocument(doc); }
    catch (err) { if (request === readerRequest.current) { setModal(null); setError(err.message); } }
  }
  function chooseDocuments(thread) { setScopeThread(thread || null); setModal('scope'); }
  async function applyScope(documentIds) {
    if (!scopeThread) return newChat(documentIds);
    const message = documentIds.length ? `La recherche est limitée à ${plural(documentIds.length, 'document')}.` : 'La recherche porte de nouveau sur tout le corpus.';
    if (await changeThread(scopeThread, {documentIds}, message)) setModal(null);
  }

  const documents = workspace?.documents || [], threads = workspace?.threads || [];
  const chats = threads.filter(item => item.kind === 'chat'), themes = threads.filter(item => item.kind === 'thematic');
  const backend = workspace?.backend || {connected: false};
  const activity = {chat: chats.some(item => item.runStatus === 'running'), themes: themes.some(item => item.runStatus === 'running')};
  const panelProps = {
    backend, sending, documents,
    onCheckBackend: checkBackend, onRetryRun: retryRun, onStopRun: stopRun,
    onClearScope: thread => changeThread(thread, {documentIds: []}, 'La recherche porte de nouveau sur tout le corpus.'),
    onChooseDocuments: chooseDocuments, onSend: send, onMemory: openMemory, onRetain: retain,
    onPriority: (thread, priority) => changeThread(thread, {priority}),
    onRename: rename, onDelete: askDelete, onOpenDocument: openDocument,
  };

  return <div className="folio-app" data-page={page}>
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); mainRef.current?.focus(); }}>Aller au contenu</a>
    <aside className="app-navigation" aria-label="Navigation principale">
      <a href="#home" className="app-brand" aria-label="Folio — accueil" onClick={event => { event.preventDefault(); navigate('home'); }}><FolioMark size={27}/><span aria-hidden="true">folio<span className="brand-dot">.</span><small>ARCHIVE VIVANTE</small></span></a>
      <nav aria-label="Sections">{NAVIGATION.map(([id, Icon, label, short], index) => <button key={id} className={page === id ? 'active' : ''} aria-current={page === id ? 'page' : undefined} onClick={() => navigate(id)} title={label}>
        <span className="nav-index" aria-hidden="true">0{index}</span><Icon size={18} aria-hidden="true"/><span className="nav-label">{label}</span><span className="nav-short" aria-hidden="true">{short}</span>
        {activity[id] && <><i className="nav-activity" aria-hidden="true"/><span className="sr-only"> (analyse en cours)</span></>}
      </button>)}</nav>
      <button className="new-chat-button" onClick={() => newChat()} disabled={busy || sending} title="Nouvelle conversation"><Plus size={16}/><span className="new-chat-label">Nouvelle conversation</span></button>
      <div className="navigation-bottom"><span className="local-dot"/><span>Votre espace local<small>{plural(documents.length, 'document')} · {plural(chats.length, 'conversation')} · {plural(themes.length, 'session')}</small></span></div>
    </aside>
    <div className="app-content">
      <PageScenery page={page}/>
      <header className="app-topbar">
        <div className="topbar-context">
          <a href="#home" className="topbar-brand" aria-label="Folio — accueil" onClick={event => { event.preventDefault(); navigate('home'); }}><FolioMark size={22}/></a>
          <span className="topbar-trail">Archive vivante</span><ChevronRight size={12} className="topbar-trail" aria-hidden="true"/><strong>{pageLabels[page]}</strong>
        </div>
        <div className="topbar-actions">
          {workspace && <BackendChip backend={backend} onCheck={checkBackend}/>}
          <MotionControl paused={motionPaused} onChange={setMotionPaused}/>
          <span className="topbar-account" title={accountLabel ? 'Connecté : ' + accountLabel : undefined}><UserRound size={13} aria-hidden="true"/><span>{accountLabel || (accessMode === 'local_preview' ? 'Aperçu local' : 'Espace personnel')}</span></span>
          {onSignOut && <button className="connection-shortcut" onClick={async () => { try { await onSignOut(); } catch (err) { setError(err.message); } }} title={accountLabel ? 'Se déconnecter de ' + accountLabel : 'Se déconnecter'} aria-label="Se déconnecter"><LogOut size={14}/><span>Déconnexion</span></button>}
          {onOpenLogin && <button className="connection-shortcut" onClick={onOpenLogin} aria-label="Afficher la page de connexion"><UserRound size={14}/><span>Connexion</span></button>}
        </div>
      </header>
      {error && <div className="app-error" role="alert"><span>{error}</span><button aria-label="Fermer le message" onClick={() => setError('')}><X size={15}/></button></div>}
      {!workspace ? <div className="app-loading" role="status"><FolioMark size={35}/><p>{error ? 'L’espace n’a pas pu être ouvert.' : 'Ouverture de votre espace…'}</p>{error && <button className="button-primary" onClick={load}>Réessayer</button>}</div>
        : <main id="main-content" ref={mainRef} tabIndex={-1}>
          <ErrorBoundary resetKey={page}>
            {page === 'home' && <HomePage workspace={workspace} backend={backend} busy={busy} onNavigate={navigate} onNewChat={() => newChat()} onNewTheme={newTheme} onOpenThread={openThread} onCheckBackend={checkBackend}/>}
            {page === 'library' && <LibraryPage workspace={workspace} view={libraryView} onViewChange={patch => setLibraryView(previous => ({...previous, ...patch}))} busy={busy} sending={sending} onOpenDocument={openDocument} onNewChat={newChat}/>}
            {page === 'chat' && <ChatPage threads={chats} thread={chat} busy={busy} sending={sending} panelProps={panelProps} onSelect={openThread} onCreate={() => newChat()} onDelete={askDelete} onClose={() => setChat(null)}/>}
            {page === 'themes' && <ThemesPage themes={themes} chats={chats} session={themeSession} backend={backend} busy={busy} sending={sending} panelProps={panelProps} onOpenThread={openThread} onCloseSession={() => setThemeSession(null)} onNewTheme={newTheme} onDelete={askDelete}/>}
          </ErrorBoundary>
        </main>}
    </div>
    {modal === 'document' && <DocumentModal document={openedDocument} busy={busy} sending={sending} onClose={closeModal} onNewChat={newChat}/>}
    {modal === 'scope' && <ScopeModal documents={documents} thread={scopeThread} busy={busy} onClose={closeModal} onApply={applyScope}/>}
    {modal === 'theme' && <ThemeModal chats={chats} busy={busy} onClose={closeModal} onCreate={createTheme}/>}
    {modal === 'delete' && deleteTarget && <DeleteModal target={deleteTarget} busy={busy} onClose={closeModal} onConfirm={deleteConversation}/>}
    {modal === 'rename' && renameTarget && <RenameModal target={renameTarget} onClose={closeModal} onSave={saveTitle}/>}
    {modal === 'memory' && memoryThread && <MemoryModal thread={memoryThread} busy={busy} onClose={closeModal} onAdd={addMemory} onEdit={editMemory} onForget={forget}/>}
    {toast && <div className="app-toast" role="status"><Check size={16}/><span>{toast}</span><button aria-label="Fermer la notification" onClick={() => setToast('')}><X size={13}/></button></div>}
  </div>;
}
