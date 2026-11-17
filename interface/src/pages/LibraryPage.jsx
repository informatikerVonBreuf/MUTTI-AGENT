import React from 'react';
import {ArrowLeft, ArrowUpRight, Eye, EyeOff, Folder, FolderOpen, History, MessageSquare, Search, X} from 'lucide-react';
import {companyLabel, documentParts, documentShortTitle, documentTitle, plural} from '../format.mjs';
import {api} from '../api.mjs';
import {readPreference} from '../preferences.mjs';

const TYPE_LABELS = {'10-K': 'Rapports annuels', '10-Q': 'Rapports trimestriels', '8-K': 'Rapports courants'};
const normalise = value => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function searchText(doc) {
  const parts = documentParts(doc);
  return normalise([doc.name, documentTitle(doc), parts.kind, parts.period, parts.quarter && 'trimestre ' + parts.quarter].join(' '));
}

// Aperçu rapide : début du texte extrait, sans ouvrir le lecteur (balises Markdown et tableaux simplifiés).
const previewText = content => content.replace(/<!--[^]*?-->/g, ' ').replace(/^\|.*\|$/gm, ' ').replace(/[#*_>`]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 900);
function DocumentRow({doc, inCompany, busy, sending, onOpenDocument, onNewChat}) {
  const parts = documentParts(doc);
  const [preview, setPreview] = React.useState({open: false, text: '', loading: false, error: ''});
  async function togglePreview() {
    if (preview.open) return setPreview(previous => ({...previous, open: false}));
    if (preview.text) return setPreview(previous => ({...previous, open: true}));
    setPreview({open: true, text: '', loading: true, error: ''});
    try { const data = await api('/api/documents/' + doc.id); setPreview({open: true, text: previewText(data.content || ''), loading: false, error: ''}); }
    catch (error) { setPreview({open: true, text: '', loading: false, error: error.message}); }
  }
  return <li className="library-document-row">
    <button className="library-document" onClick={() => onOpenDocument(doc.id)}>
      <span className={'document-glyph type-' + (parts.type || 'doc').toLowerCase()} aria-hidden="true">{parts.type || 'DOC'}</span>
      <div>
        <strong>{inCompany ? documentShortTitle(doc) : documentTitle(doc)}</strong>
        <small>{parts.kind}{parts.quarter ? ` · trimestre ${parts.quarter}` : ''}{parts.year ? ` · exercice ${parts.year}` : ''} · {doc.hasPdf && doc.hasText ? 'PDF original et texte extrait' : doc.hasPdf ? 'PDF original' : 'Texte extrait'}</small>
      </div>
      <span className="open-document-label">Ouvrir</span><ArrowUpRight size={15}/>
    </button>
    <button className="document-chat-link" onClick={() => onNewChat([doc.id])} disabled={busy || sending} aria-label={'Préparer un chat avec ' + documentTitle(doc)}><MessageSquare size={15}/><span>Chat PDF</span></button>
    {doc.hasText && <button type="button" className="document-chat-link" onClick={togglePreview} aria-expanded={preview.open} aria-label={(preview.open ? 'Masquer l’aperçu de ' : 'Aperçu rapide de ') + documentTitle(doc)}>{preview.open ? <EyeOff size={15}/> : <Eye size={15}/>}<span>Aperçu</span></button>}
    {preview.open && <div className="document-preview" role="region" aria-label={'Aperçu de ' + documentTitle(doc)}>{preview.loading ? 'Lecture du début du rapport…' : preview.error || (preview.text ? preview.text + '…' : 'Texte extrait vide.')}</div>}
  </li>;
}

export default function LibraryPage({workspace, view, onViewChange, busy, sending, onOpenDocument, onNewChat}) {
  const documents = workspace.documents || [], companies = workspace.companies || [];
  const {company = null, query = '', type = 'all', year = 'all'} = view;
  const needle = normalise(query.trim());
  const types = [...new Set(documents.map(doc => doc.type).filter(Boolean))].sort();
  const years = [...new Set(documents.map(doc => doc.year).filter(Boolean))].sort().reverse();
  // Recherche par mots : « Meta 2024 » trouve les rapports qui contiennent chacun des mots, dans n'importe quel ordre.
  const words = needle.split(/\s+/).filter(Boolean);
  const filtered = documents.filter(doc => (!company || doc.company === company) && (type === 'all' || doc.type === type) && (year === 'all' || doc.year === year) && (!words.length || words.every(word => searchText(doc).includes(word))));
  const filtering = Boolean(needle) || type !== 'all' || year !== 'all';
  const showList = Boolean(company) || filtering;
  const groups = [];
  for (const doc of [...filtered].sort((a, b) => String(b.year).localeCompare(String(a.year)) || a.company.localeCompare(b.company) || a.name.localeCompare(b.name))) {
    const label = doc.year || 'Sans date';
    if (groups.at(-1)?.label !== label) groups.push({label, items: []});
    groups.at(-1).items.push(doc);
  }
  const reset = () => onViewChange({query: '', type: 'all', year: 'all'});
  // Rapports consultés récemment sur cet appareil (identifiants seulement, si les préférences locales sont acceptées).
  const recent = React.useMemo(() => { try { return JSON.parse(readPreference('folio-recent-documents') || '[]').map(id => documents.find(doc => doc.id === id)).filter(Boolean).slice(0, 5); } catch { return []; } }, [documents]);
  return <div className="library-page">
    <header className="simple-heading">
      <div>
        <span className="eyebrow">01 / VOTRE BIBLIOTHÈQUE</span>
        <h1>Vos documents,<br/><em>par entreprise.</em></h1>
        <p>Ouvrez un dossier pour consulter les rapports qu’il contient, ou filtrez par type et par exercice. Les originaux ne sont jamais modifiés.</p>
      </div>
    </header>
    {recent.length > 0 && <nav className="recent-documents" aria-label="Rapports consultés récemment"><span className="eyebrow"><History size={12}/> CONSULTÉS RÉCEMMENT</span>{recent.map(doc => <button key={doc.id} type="button" onClick={() => onOpenDocument(doc.id)}>{documentTitle(doc)}</button>)}</nav>}
    <div className="library-filter" role="search">
      <label><Search size={16}/><input type="search" aria-label="Rechercher dans les documents" placeholder="Rechercher : Meta 2024, trimestriel, T2…" value={query} onChange={event => onViewChange({query: event.target.value})}/>
        {query && <button type="button" className="filter-clear" onClick={() => onViewChange({query: ''})} aria-label="Effacer la recherche"><X size={14}/></button>}
      </label>
      <div className="filter-groups">
        {types.length > 1 && <div className="filter-chips" role="group" aria-label="Type de rapport">
          <button type="button" aria-pressed={type === 'all'} onClick={() => onViewChange({type: 'all'})}>Tous les types</button>
          {types.map(value => <button type="button" key={value} aria-pressed={type === value} onClick={() => onViewChange({type: type === value ? 'all' : value})} title={TYPE_LABELS[value]}>{value}<span className="sr-only"> : {TYPE_LABELS[value]}</span></button>)}
        </div>}
        {years.length > 1 && <div className="filter-chips" role="group" aria-label="Exercice">
          <button type="button" aria-pressed={year === 'all'} onClick={() => onViewChange({year: 'all'})}>Toutes les années</button>
          {years.map(value => <button type="button" key={value} aria-pressed={year === value} onClick={() => onViewChange({year: year === value ? 'all' : value})}>{value}</button>)}
        </div>}
      </div>
      <span className="library-count" role="status">{filtering || company ? `${plural(filtered.length, 'document')} sur ${documents.length.toLocaleString('fr-FR')}` : `${plural(documents.length, 'document')} · ${plural(companies.length, 'entreprise')}`}</span>
    </div>
    {company ? <>
      <button className="back-link" onClick={() => onViewChange({company: null})}><ArrowLeft size={14}/>Toutes les entreprises</button>
      <div className="company-heading"><FolderOpen size={25}/><div><h2>{companyLabel(company)}</h2><span>{plural(filtered.length, 'document')}{filtering ? ' correspondant aux filtres' : ''}</span></div></div>
    </> : !filtering && <div className="company-folders">{companies.map(name => {
      const docs = documents.filter(doc => doc.company === name);
      const annual = docs.filter(doc => doc.type === '10-K').length, quarterly = docs.filter(doc => doc.type === '10-Q').length;
      const span = [...new Set(docs.map(doc => doc.year).filter(Boolean))].sort();
      return <button className={'company-folder company-' + name} key={name} onClick={() => onViewChange({company: name})} aria-label={`${companyLabel(name)} : ${plural(docs.length, 'document')}`}>
        <span className="folder-tab"/>
        <div className="folder-top"><Folder size={27}/><span>{String(docs.length).padStart(2, '0')}</span></div>
        <h2>{companyLabel(name)}</h2>
        <p className="folder-detail">{[annual && plural(annual, 'rapport annuel', 'rapports annuels'), quarterly && plural(quarterly, 'trimestriel', 'trimestriels')].filter(Boolean).join(' · ')}{span.length ? <><br/>{span[0] === span.at(-1) ? `Exercice ${span[0]}` : `Exercices ${span[0]} – ${span.at(-1)}`}</> : null}</p>
        <div className="folder-bottom"><span>{plural(docs.length, 'document')}</span><ArrowUpRight size={18}/></div>
      </button>;
    })}</div>}
    {showList && <div className="library-document-list">
      <div className="document-list-heading"><span>{company ? 'Documents' : 'Résultats'}</span><span>CONSULTATION</span></div>
      {groups.map(group => <section className="document-year-group" key={group.label} aria-label={'Exercice ' + group.label}>
        <h3 className="document-year">{group.label}<span>{plural(group.items.length, 'document')}</span></h3>
        <ul>{group.items.map(doc => <DocumentRow key={doc.id} doc={doc} inCompany={Boolean(company)} busy={busy} sending={sending} onOpenDocument={onOpenDocument} onNewChat={onNewChat}/>)}</ul>
      </section>)}
      {!filtered.length && <div className="simple-empty"><Search size={25}/><p>{needle ? `Aucun document ne correspond à « ${query.trim()} »` : 'Aucun document ne correspond à ces filtres'}{company ? ` chez ${companyLabel(company)}` : ''}.</p><button className="text-button" onClick={reset}>Effacer les filtres</button></div>}
    </div>}
  </div>;
}
