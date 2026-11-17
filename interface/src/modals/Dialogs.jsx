import React, {useEffect, useState} from 'react';
import {ArrowDownToLine, Brain, Check, ExternalLink, FileText, MessageSquare, Pencil, Plus, Trash2} from 'lucide-react';
import {CharacterCount, Markdown, Modal} from '../components/Primitives.jsx';
import {priorities} from '../ChatPanel.jsx';
import {companyLabel, documentParts, documentTitle, formatFullDate, formatRelative, noteLabels, plural} from '../format.mjs';

const PREVIEW_LIMIT = 100000;
const prefersText = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 800px), (pointer: coarse)').matches;

// Passage cité retrouvé dans le texte extrait : on montre son contexte, le passage surligné.
function locateQuote(content, quote) {
  if (!content || !quote) return null;
  const probe = quote.replace(/…$/, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (probe.length < 12) return null;
  const flat = content.replace(/\s+/g, ' ');
  const index = flat.indexOf(probe);
  if (index < 0) return null;
  const end = Math.min(flat.length, index + Math.max(probe.length, quote.length));
  return {before: flat.slice(Math.max(0, index - 400), index), match: flat.slice(index, end), after: flat.slice(end, end + 400)};
}

export function DocumentModal({document: doc, focus = null, busy, sending, onClose, onNewChat}) {
  const [format, setFormat] = useState('pdf');
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!doc) return;
    setExpanded(false);
    // Un passage cité sans page connue s'affiche mieux dans le texte, où il est surligné.
    setFormat(doc.hasPdf && !(doc.hasText && (prefersText() || (focus?.quote && !focus?.page))) ? 'pdf' : 'text');
  }, [doc?.id]);
  const parts = doc ? documentParts(doc) : null;
  const length = doc?.content?.length || 0;
  const located = doc && focus?.quote ? locateQuote(doc.content, focus.quote) : null;
  const pdfUrl = doc ? `/api/documents/${doc.id}/pdf${focus?.page ? `#page=${focus.page}` : ''}` : '';
  return <Modal title={doc ? documentTitle(doc) : 'Ouvrir le document'} eyebrow={doc ? `BIBLIOTHÈQUE / ${companyLabel(doc.company).toUpperCase()}` : 'BIBLIOTHÈQUE'} onClose={onClose} className="document-modal" busy={!doc}>
    {doc ? <>
      <p className="document-meta">{parts.kind}{parts.period ? ` · ${parts.period}` : ''} · {doc.hasPdf ? 'PDF original' : 'PDF indisponible'}{doc.hasText ? ` · texte extrait (${length.toLocaleString('fr-FR')} caractères)` : ''}{focus?.page ? ` · ouvert à la page ${focus.page}` : ''}</p>
      {focus?.quote && <figure className="document-focus">
        <figcaption>Passage cité{focus.page ? ` · page ${focus.page}` : ''}{located ? ' · retrouvé dans le texte extrait' : ''}</figcaption>
        {located ? <p>…{located.before}<mark>{located.match}</mark>{located.after}…</p> : <blockquote>{focus.quote}</blockquote>}
      </figure>}
      <div className="document-viewer-toolbar">
        <button className="text-button" onClick={() => onNewChat([doc.id])} disabled={busy || sending}><MessageSquare size={14}/>Discuter de ce PDF</button>
        <div className="format-tabs" role="group" aria-label="Format d’affichage">
          {doc.hasPdf && <button className={format === 'pdf' ? 'active' : ''} aria-pressed={format === 'pdf'} onClick={() => setFormat('pdf')}>PDF original</button>}
          {doc.hasText && <button className={format === 'text' ? 'active' : ''} aria-pressed={format === 'text'} onClick={() => setFormat('text')}>Texte</button>}
        </div>
        <span className="document-links">
          {doc.hasPdf && <a className="text-button" href={pdfUrl} target="_blank" rel="noopener"><ExternalLink size={14}/>Nouvel onglet</a>}
          <a className="text-button" href={format === 'pdf' ? `/api/documents/${doc.id}/pdf?download=1` : `/api/documents/${doc.id}?download=1`} download><ArrowDownToLine size={14}/>Télécharger {format === 'pdf' ? 'le PDF' : 'le texte (.md)'}</a>
        </span>
      </div>
      {format === 'pdf' ? <>
        <iframe className="pdf-viewer" title={documentTitle(doc)} src={pdfUrl}/>
        <p className="document-hint">Si l’aperçu reste vide sur votre appareil, utilisez « Nouvel onglet »{doc.hasText ? ' ou l’affichage « Texte »' : ''}.</p>
      </> : <div className="document-text">
        {length > PREVIEW_LIMIT && !expanded && <p className="document-hint">Affichage des {PREVIEW_LIMIT.toLocaleString('fr-FR')} premiers caractères sur {length.toLocaleString('fr-FR')}.</p>}
        <Markdown text={expanded ? doc.content : doc.content.slice(0, PREVIEW_LIMIT)}/>
        {!expanded && length > PREVIEW_LIMIT && <button className="button-secondary" onClick={() => setExpanded(true)}>Afficher la suite ({(length - PREVIEW_LIMIT).toLocaleString('fr-FR')} caractères)</button>}
      </div>}
    </> : <div className="simple-empty" role="status"><FileText size={25}/><p>Ouverture du document…</p></div>}
  </Modal>;
}

export function ScopeModal({documents, thread, busy, onClose, onApply}) {
  const [selection, setSelection] = useState(() => thread?.documentIds || []);
  const companies = [...new Set(documents.map(doc => doc.company))];
  const toggle = id => setSelection(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]);
  return <Modal title="Les documents de cet échange." onClose={onClose} className="scope-modal">
    <p className="modal-description">Choisissez jusqu’à huit documents. La recherche sera limitée à cette sélection. Sans sélection, tout le corpus est disponible.</p>
    <form onSubmit={event => { event.preventDefault(); onApply(selection); }}>
      <div className="associated-choices pdf-selection-list">{companies.map(company => <fieldset key={company} className="scope-company">
        <legend>{companyLabel(company)}</legend>
        {documents.filter(doc => doc.company === company).map(doc => <label key={doc.id}>
          <input type="checkbox" checked={selection.includes(doc.id)} disabled={!selection.includes(doc.id) && selection.length >= 8} onChange={() => toggle(doc.id)}/>
          <span><strong>{documentTitle(doc)}</strong><small>{documentParts(doc).kind} · {doc.hasText ? 'texte disponible pour la recherche' : 'extraction à raccorder'}</small></span>
        </label>)}
      </fieldset>)}</div>
      <div className="form-footer">
        <span className={'selection-count' + (selection.length >= 8 ? ' is-full' : '')} role="status">{selection.length ? `${selection.length} / 8 sélectionné${selection.length > 1 ? 's' : ''}` : 'Tout le corpus'}</span>
        {selection.length > 0 && <button type="button" className="text-button" onClick={() => setSelection([])}>Tout désélectionner</button>}
        <button type="button" className="button-secondary" onClick={onClose}>Annuler</button>
        <button className="button-primary" disabled={busy}>Appliquer</button>
      </div>
    </form>
  </Modal>;
}

export function ThemeModal({chats, busy, onClose, onCreate}) {
  const [theme, setTheme] = useState('');
  const [associated, setAssociated] = useState([]);
  return <Modal title="Une nouvelle session thématique." onClose={onClose}>
    <p className="modal-description">L’historique commence ici. Vous pouvez y associer les points importants de certaines conversations.</p>
    <form className="theme-form" onSubmit={event => { event.preventDefault(); onCreate({theme, sourceThreadIds: associated}); }}>
      <label className="field-label" htmlFor="new-theme">Le thème</label>
      <input id="new-theme" className="text-field" value={theme} onChange={event => setTheme(event.target.value)} placeholder="Ex. Rentabilité, investissements, stratégie…" minLength={2} maxLength={120} required data-autofocus/>
      <div className="field-help"><span>Entre 2 et 120 caractères.</span><CharacterCount value={theme} max={120} from={0.6}/></div>
      <div className="theme-shortcuts" role="group" aria-label="Suggestions de thèmes">{['Résultats financiers', 'Investissements IA', 'Risques et perspectives'].map(value => <button type="button" key={value} aria-pressed={theme === value} onClick={() => setTheme(value)}>{value}</button>)}</div>
      <span className="field-label associated-heading">Conversations à associer <small>Facultatif · {associated.length ? plural(associated.length, 'sélectionnée', 'sélectionnées') : 'aucune sélection'}</small></span>
      <div className="associated-choices">
        {chats.map(item => <label key={item.id}>
          <input type="checkbox" checked={associated.includes(item.id)} onChange={() => setAssociated(previous => previous.includes(item.id) ? previous.filter(id => id !== item.id) : [...previous, item.id])}/>
          <span><strong>{item.title}</strong><small>{plural(item.memoryCount, 'point retenu', 'points retenus')} · {plural(item.messageCount, 'message')} · {formatRelative(item.updatedAt)}</small></span>
        </label>)}
        {!chats.length && <p>Aucune conversation pour l’instant. Vous pouvez créer une session indépendante.</p>}
      </div>
      <div className="form-footer">
        <button type="button" className="button-secondary" onClick={onClose}>Annuler</button>
        <button className="button-primary" type="submit" disabled={busy || theme.trim().length < 2}><Plus size={15}/>Créer la session</button>
      </div>
    </form>
  </Modal>;
}

export function DeleteModal({target, busy, onClose, onConfirm}) {
  const messages = target.messageCount ?? target.messages?.length ?? 0;
  const notes = target.memoryCount ?? target.memory?.length ?? 0;
  return <Modal title="Supprimer cette session ?" onClose={onClose}>
    <p className="modal-description"><strong>{target.title}</strong></p>
    <div className="delete-explanation">
      <p>La conversation et sa mémoire seront supprimées de cet espace : {plural(messages, 'message')} et {plural(notes, 'point retenu', 'points retenus')}.</p>
      {target.kind === 'chat' && <p>Ses points retenus seront également retirés des sessions thématiques associées.</p>}
      <p>Cette suppression est définitive.</p>
    </div>
    <div className="form-footer">
      <button className="button-secondary" onClick={onClose} disabled={busy} data-autofocus>Conserver</button>
      <button className="button-danger" onClick={onConfirm} disabled={busy}><Trash2 size={15}/>{busy ? 'Suppression…' : 'Supprimer la session'}</button>
    </div>
  </Modal>;
}

export function RenameModal({target, onClose, onSave}) {
  const [title, setTitle] = useState(target.title);
  return <Modal title="Renommer la conversation." onClose={onClose}>
    <form onSubmit={event => { event.preventDefault(); onSave(title); }}>
      <label className="field-label" htmlFor="thread-title">Titre</label>
      <input className="text-field" id="thread-title" value={title} onChange={event => setTitle(event.target.value)} minLength={1} maxLength={120} required data-autofocus onFocus={event => event.target.select()}/>
      <div className="field-help"><span>Le titre apparaît dans l’historique et dans les sessions associées.</span><CharacterCount value={title} max={120} from={0.6}/></div>
      <div className="form-footer">
        <button className="button-secondary" type="button" onClick={onClose}>Annuler</button>
        <button className="button-primary" disabled={!title.trim() || title.trim() === target.title}><Check size={15}/>Enregistrer</button>
      </div>
    </form>
  </Modal>;
}

export function MemoryModal({thread, busy, onClose, onAdd, onEdit, onForget}) {
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(null);
  const [editText, setEditText] = useState('');
  const [confirming, setConfirming] = useState(null);
  const manual = thread.memory.filter(note => note.method !== 'local_rules' || note.pinned).length;
  async function add(event) { event.preventDefault(); if (await onAdd(text)) setText(''); }
  async function edit(event) { event.preventDefault(); if (await onEdit(editing, editText)) setEditing(null); }
  return <Modal title="La mémoire de cet échange." onClose={onClose} className="memory-modal" busy={busy}>
    <p className="modal-description">Les objectifs, préférences et décisions sont repérés localement dans vos messages. Vous gardez la main sur chaque point retenu.</p>
    <div className="memory-session-title"><MessageSquare size={15}/>{thread.title}<span>{priorities[thread.effectivePriority]}</span></div>
    {thread.memory.length > 0 && <p className="memory-summary">{plural(thread.memory.length, 'point')} · {plural(manual, 'conservé par vous', 'conservés par vous')} · les huit plus importants (3 200 caractères au plus) accompagnent chaque nouvelle question.</p>}
    <div className="memory-notes">
      {thread.memory.map(note => <article className="memory-note" key={note.id}>
        <div className="memory-note-top"><span>{noteLabels[note.type] || 'Point retenu'}</span><small>{note.method === 'local_rules' && !note.pinned ? 'Repéré dans vos messages' : 'Conservé par vous'}{note.createdAt ? ` · ${formatRelative(note.createdAt)}` : ''}</small></div>
        {editing === note.id ? <form onSubmit={edit}>
          <label className="sr-only" htmlFor={'memory-edit-' + note.id}>Corriger ce point</label>
          <textarea className="text-field" id={'memory-edit-' + note.id} value={editText} onChange={event => setEditText(event.target.value)} minLength={3} maxLength={1000} autoFocus/>
          <div className="memory-edit-actions"><CharacterCount value={editText} max={1000} from={0.8}/><button type="button" className="text-button" onClick={() => setEditing(null)}>Annuler</button><button className="text-button" type="submit" disabled={busy || editText.trim().length < 3}><Check size={13}/>Enregistrer</button></div>
        </form> : <>
          <p>{note.text}</p>
          {confirming === note.id ? <div className="memory-note-actions memory-confirm" role="group" aria-label="Confirmer l’oubli">
            <span>Oublier ce point ? Il ne sera plus transmis au modèle.</span>
            <button onClick={() => setConfirming(null)}>Conserver</button>
            <button className="is-danger" onClick={async () => { await onForget(note); setConfirming(null); }} disabled={busy} autoFocus><Trash2 size={12}/>Oublier</button>
          </div> : <div className="memory-note-actions">
            <button onClick={() => { setEditing(note.id); setEditText(note.text); setConfirming(null); }}><Pencil size={12}/>Corriger</button>
            <button onClick={() => setConfirming(note.id)} disabled={busy}><Trash2 size={12}/>Oublier</button>
          </div>}
        </>}
      </article>)}
      {!thread.memory.length && <div className="simple-empty"><Brain size={27}/><p>Aucun point retenu pour le moment.</p><small>Utilisez « Retenir » dans le chat ou ajoutez un point ci-dessous.</small></div>}
    </div>
    <form className="add-memory-form" onSubmit={add}>
      <label className="field-label" htmlFor="memory-point">Ajouter un point important</label>
      <textarea className="text-field" id="memory-point" value={text} onChange={event => setText(event.target.value)} placeholder="Un objectif, une préférence, une décision à conserver…" minLength={3} maxLength={1000} rows={2}/>
      <div className="field-help"><span>Au moins 3 caractères.</span><CharacterCount value={text} max={1000} from={0.8}/></div>
      <button className="button-primary" type="submit" disabled={busy || text.trim().length < 3}><Plus size={14}/>Retenir ce point</button>
    </form>
    <p className="memory-footnote">Les points sont liés à cette conversation{thread.createdAt ? `, ouverte le ${formatFullDate(thread.createdAt)}` : ''}. Ils sont effacés si vous la supprimez. La mémoire utilise actuellement des règles locales ; sa synthèse sémantique reste à ajouter.</p>
  </Modal>;
}
