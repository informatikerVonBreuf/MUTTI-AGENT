import React from 'react';
import {ArrowRight, ArrowUpRight, BookOpen, FileText, MessageSquare, RefreshCw} from 'lucide-react';
import BookSculpture from '../BookSculpture.jsx';
import {FolioMark} from '../Identity.jsx';
import {useNow} from '../components/Primitives.jsx';
import {backendSentence, backendState, companyLabel, formatFullDate, formatRelative, listFormat, plural} from '../format.mjs';

const runNotes = {running: 'analyse en cours', failed: 'dernière analyse en échec', interrupted: 'analyse à relancer', cancelled: 'analyse arrêtée'};

export default function HomePage({workspace, backend, onNavigate, onNewChat, onNewTheme, onOpenThread, onCheckBackend}) {
  const now = useNow(60000);
  const documents = workspace.documents || [], companies = workspace.companies || [], threads = workspace.threads || [];
  const chats = threads.filter(thread => thread.kind === 'chat'), themes = threads.filter(thread => thread.kind === 'thematic');
  const recent = [...threads].filter(thread => thread.messageCount > 0 || thread.kind === 'thematic').sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 3);
  const status = backend ? backendState(backend) : null;
  const names = companies.map(companyLabel);
  const destinations = [
    {number: '01', icon: BookOpen, title: 'Lire les archives.', text: names.length ? `Parcourir les dossiers de ${listFormat(names)}.` : 'Parcourir les rapports déposés dans la bibliothèque.', count: `${plural(documents.length, 'document')} · ${plural(companies.length, 'entreprise')}`, action: () => onNavigate('library'), label: 'Bibliothèque'},
    {number: '02', icon: MessageSquare, title: 'Ouvrir une question.', text: 'Poser une question, retrouver ses sources et garder les points importants.', count: plural(chats.length, 'conversation'), action: onNewChat, label: 'Chat avec les PDF'},
    {number: '03', icon: FileText, title: 'Croiser les regards.', text: 'Créer une session thématique et suivre le plan de travail des agents.', count: plural(themes.length, 'session', 'sessions'), action: onNewTheme, label: 'Résumés thématiques'},
  ];
  return <div className="home-page">
    <section className="home-cover">
      <div className="home-copy">
        <span className="eyebrow">FOLIO / VOTRE ATELIER DE LECTURE</span>
        <h1>Le savoir mérite<br/><em>d’être compris.</em></h1>
        <p>Des documents aux idées qui comptent. Un espace pour lire vos archives, questionner les PDF et préparer des synthèses par thématique.</p>
        <div className="home-actions">
          <button className="button-primary" onClick={() => onNavigate('library')}>Ouvrir la bibliothèque<ArrowUpRight size={16}/></button>
          <button className="text-button" onClick={onNewChat}>Commencer un échange<ArrowRight size={15}/></button>
        </div>
        <ul className="home-corpus-note" aria-label="Contenu de votre espace">
          <li>{plural(documents.length, 'document')}</li>
          <li>{plural(companies.length, 'entreprise')}</li>
          {workspace.threads ? <li>{plural(chats.length, 'conversation')}</li> : <li>Votre historique local</li>}
          {Number.isFinite(workspace.memoryCount) && <li>{plural(workspace.memoryCount, 'point retenu', 'points retenus')}</li>}
        </ul>
      </div>
      <div className="home-book"><BookSculpture/><span className="home-book-caption">OBJET 01 / CLIQUEZ POUR OUVRIR LE LIVRE</span></div>
    </section>
    <section className="home-tenseconds" aria-labelledby="home-tenseconds-title">
      <h2 id="home-tenseconds-title" className="eyebrow">FOLIO EN 10 SECONDES</h2>
      <ol>
        <li><button type="button" onClick={() => onNavigate('library')}><span className="sticker" aria-hidden="true">📚</span><strong>Lire</strong><span>{plural(documents.length, 'rapport officiel', 'rapports officiels')}{companies.length ? ` de ${listFormat(companies.map(companyLabel))}` : ''} : 10-K, 10-Q et 8-K, classés par entreprise et par année.</span></button></li>
        <li><button type="button" onClick={onNewChat}><span className="sticker" aria-hidden="true">💬</span><strong>Questionner</strong><span>Une question en français : huit étapes fixes, sans agent, et des règles qui vérifient chaque citation mot pour mot, page comprise, ou s’abstiennent faute de preuve.</span></button></li>
        <li><button type="button" onClick={() => onNavigate('themes')}><span className="sticker" aria-hidden="true">🏗️</span><strong>Relier</strong><span>Quatre agents préparent un résumé thématique, données de marché comprises (MCP) : vous suivez leur chantier, ce qu’ils consultent, le coût et l’empreinte.</span></button></li>
      </ol>
    </section>
    {recent.length > 0 && <section className="home-recent" aria-labelledby="home-recent-title">
      <div className="home-section-rule"><h2 id="home-recent-title">REPRENDRE OÙ VOUS EN ÉTIEZ</h2><FolioMark size={15}/></div>
      <ul className="home-recent-list">{recent.map(thread => <li key={thread.id}>
        <button onClick={() => onOpenThread?.(thread.id)}>
          <span className="recent-kind">{thread.kind === 'thematic' ? <FileText size={14}/> : <MessageSquare size={14}/>}{thread.kind === 'thematic' ? 'Session thématique' : 'Conversation'}</span>
          <strong>{thread.title}</strong>
          <span className="recent-meta"><time dateTime={thread.updatedAt} title={formatFullDate(thread.updatedAt)}>{formatRelative(thread.updatedAt, now)}</time> · {plural(thread.messageCount, 'message')}{thread.memoryCount ? ` · ${plural(thread.memoryCount, 'point retenu', 'points retenus')}` : ''}{runNotes[thread.runStatus] ? <em> · {runNotes[thread.runStatus]}</em> : null}</span>
          <ArrowUpRight size={16} className="recent-arrow"/>
        </button>
      </li>)}</ul>
    </section>}
    <div className="home-section-rule"><span>CHOISIR SON POINT D’ENTRÉE</span><FolioMark size={15}/></div>
    <section className="home-destinations">{destinations.map(item => <button className={'home-destination destination-' + item.number} key={item.number} onClick={item.action}>
      <div><span>{item.number}</span><item.icon size={20}/></div>
      <h2>{item.title}</h2>
      <p>{item.text}</p>
      {workspace.threads && <span className="destination-count">{item.count}</span>}
      <span className="destination-link">{item.label}<ArrowUpRight size={15}/></span>
    </button>)}</section>
    <div className={'home-readiness readiness-' + (status || 'unknown')} role="status">
      <span className="quiet-status"/>
      <p>{status ? backendSentence(backend) : 'Bibliothèque, historique et mémoire sont disponibles. La disponibilité du modèle IA est vérifiée avant les réponses et les résumés.'}</p>
      {status === 'unavailable' && backend.configured && onCheckBackend && <button className="text-button" onClick={onCheckBackend}><RefreshCw size={13}/>Vérifier à nouveau</button>}
    </div>
  </div>;
}
