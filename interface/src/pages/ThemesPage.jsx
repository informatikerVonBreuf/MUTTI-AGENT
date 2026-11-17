import React from 'react';
import {ArrowLeft, ArrowUpRight, Download, FileText, MessageSquare, Plus, Trash2} from 'lucide-react';
import ChatPanel from '../ChatPanel.jsx';
import AgentTransparency from '../AgentTransparency.jsx';
import {PageHeading} from '../components/PageChrome.jsx';
import {useNow} from '../components/Primitives.jsx';
import {downloadThread} from '../export.mjs';
import {formatFullDate, formatRelative, plural} from '../format.mjs';

const sessionStates = {
  null: ['Jamais lancée', 'idle'], running: ['Analyse en cours', 'running'], completed: ['Résumé produit', 'done'],
  failed: ['Dernière analyse en échec', 'failed'], interrupted: ['Analyse interrompue', 'failed'], cancelled: ['Analyse arrêtée', 'failed'],
};

function preparationNote(session, backend, now) {
  const run = session.lastRun;
  if (run?.status === 'running') return 'Les agents travaillent sur votre demande. Le journal ci-dessous se met à jour à chaque étape réelle.';
  if (run?.status === 'completed') return `Dernier résumé produit ${formatRelative(run.finishedAt, now)} : ${plural(run.verifiedClaimCount || 0, 'affirmation sourcée', 'affirmations sourcées')}. Une nouvelle demande relance les quatre rôles.`;
  if (run && run.status !== 'completed') return 'La dernière analyse n’a pas abouti. Vous pouvez la relancer depuis l’échange.';
  return backend.connected ? 'Envoyez votre demande pour lancer la recherche et la synthèse.' : 'Le modèle IA doit être disponible pour lancer cette synthèse.';
}

export default function ThemesPage({themes, chats, session, backend = {}, busy, sending, panelProps, onOpenThread, onCloseSession, onNewTheme, onDelete}) {
  const now = useNow(60000);
  if (session) {
    const answers = session.messages.filter(message => message.role === 'assistant').length;
    return <div className="themes-page">
      <PageHeading number="03" title="Croiser les lectures." emphasis="Éclairer un thème." description={session.theme}/>
      <div className="theme-session-bar">
        <button className="back-link" onClick={onCloseSession}><ArrowLeft size={14}/>Toutes les sessions thématiques</button>
        <span>Session indépendante · ouverte <time dateTime={session.createdAt} title={formatFullDate(session.createdAt)}>{formatRelative(session.createdAt, now)}</time> · historique séparé</span>
        {answers > 0 && <button className="text-button" onClick={() => downloadThread(session, panelProps.documents)}><Download size={14}/>Exporter le résumé (.md)</button>}
      </div>
      <div className="thematic-workspace">
        <ChatPanel thread={session} {...panelProps}/>
        <aside className="theme-preparation" aria-labelledby="theme-preparation-title">
          <span className="eyebrow">PRÉPARATION DU RÉSUMÉ</span>
          <h2 id="theme-preparation-title">{session.theme}</h2>
          <p>Cette session est indépendante. Les points ci-dessous viennent uniquement des conversations que vous avez associées.</p>
          <h3>Conversations associées <span className="count-badge">{session.sourceThreadIds.length}</span></h3>
          <div className="linked-chats">{session.sourceThreadIds.length ? session.sourceThreadIds.map(id => {
            const source = chats.find(item => item.id === id);
            return source ? <button key={id} onClick={() => onOpenThread(id)}><MessageSquare size={13}/><span>{source.title}<small>{plural(source.memoryCount, 'point retenu', 'points retenus')} · {formatRelative(source.updatedAt, now)}</small></span><ArrowUpRight size={12}/></button> : null;
          }) : <span>Aucune conversation associée. Le résumé s’appuiera uniquement sur votre demande et sur le corpus.</span>}</div>
          <h3>Éléments à retenir <span className="count-badge">{session.linkedNotes.length}</span></h3>
          {session.linkedNotes.length ? session.linkedNotes.map(note => <div className="linked-memory" key={note.sourceThreadId + note.id}><small>{note.sourceThreadTitle}</small><p>{note.text}</p></div>)
            : <div className="preparation-empty">Les points importants des conversations associées apparaîtront ici.</div>}
          <div className="summary-pending" role="status"><span className="quiet-status"/>{preparationNote(session, backend, now)}</div>
        </aside>
      </div>
      <AgentTransparency plan={session.agentPlan} run={session.lastRun}/>
    </div>;
  }
  return <div className="themes-page">
    <header className="simple-heading compact-heading">
      <div><span className="eyebrow">03 / RÉSUMÉS THÉMATIQUES</span><h1>Un thème.<br/><em>Une nouvelle session.</em></h1><p>Préparez un résumé séparé, avec les points importants des échanges que vous choisissez. Quatre rôles d’agents recherchent, vérifient et rédigent.</p></div>
      <button className="button-primary" onClick={onNewTheme}><Plus size={16}/>Nouvelle session</button>
    </header>
    {themes.length > 0 && <ol className="theme-session-list">{themes.map((item, index) => {
      const [stateLabel, stateKey] = sessionStates[item.runStatus] || sessionStates.null;
      return <li className="theme-session-card" key={item.id}>
        <div className="theme-card-number">{String(index + 1).padStart(2, '0')}</div>
        <button onClick={() => onOpenThread(item.id)} disabled={busy}>
          <span className="theme-card-top"><span className="eyebrow">SESSION THÉMATIQUE</span><em className={'session-state state-' + stateKey}>{stateLabel}</em></span>
          <h2>{item.title}</h2>
          <p>{item.sourceThreadIds.length ? plural(item.sourceThreadIds.length, 'conversation associée', 'conversations associées') : 'Aucune conversation associée'} · {item.linkedMemoryCount ? plural(item.linkedMemoryCount, 'point disponible', 'points disponibles') : 'aucun point repris'}</p>
          <p className="theme-card-dates">{plural(item.messageCount, 'message')} · mise à jour <time dateTime={item.updatedAt} title={formatFullDate(item.updatedAt)}>{formatRelative(item.updatedAt, now)}</time></p>
          <span className="theme-card-open">Ouvrir la session<ArrowUpRight size={15}/></span>
        </button>
        <button className="small-icon danger-hover theme-card-delete" disabled={busy || sending} aria-label={'Supprimer la session ' + item.title} title="Supprimer la session" onClick={() => onDelete(item)}><Trash2 size={15}/></button>
      </li>;
    })}</ol>}
    {!themes.length && <div className="simple-empty thematic-empty"><FileText size={31}/><h2>Le premier thème reste à ouvrir.</h2><p>Les résumés auront leur propre session, sans mélanger les historiques de chat.</p><button className="button-secondary" onClick={onNewTheme}>Préparer une session<Plus size={14}/></button></div>}
  </div>;
}
