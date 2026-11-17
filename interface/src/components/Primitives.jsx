import React, {useEffect, useId, useRef, useState} from 'react';
import {X} from 'lucide-react';

// Les textes extraits des PDF contiennent des échappements Markdown (\_ \$ \*) : on les rend lisibles.
const unescape = text => text.replace(/\\([\\`*_{}[\]()#+\-.!|>~$&])/g, '$1');

function Inline({text}) {
  return unescape(text).split(/(\*\*[^*]+\*\*)/).map((part, index) => part.startsWith('**') && part.endsWith('**') && part.length > 4
    ? <strong key={index}>{part.slice(2, -2)}</strong>
    : part);
}

export function Markdown({text}) {
  const lines = String(text || '').split('\n');
  const output = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) continue;
    if (line.includes('|') && /^\s*\|?\s*:?-{3}/.test(lines[index + 1] || '')) {
      const rows = [line];
      index += 2;
      while (index < lines.length && lines[index].includes('|')) rows.push(lines[index++]);
      index--;
      const cells = row => row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|');
      output.push(<div className="table-scroll" key={index} tabIndex={0} role="region" aria-label="Tableau"><table>
        <thead><tr>{cells(rows[0]).map((cell, i) => <th key={i}><Inline text={cell.trim()}/></th>)}</tr></thead>
        <tbody>{rows.slice(1).map((row, i) => <tr key={i}>{cells(row).map((cell, j) => <td key={j}><Inline text={cell.trim()}/></td>)}</tr>)}</tbody>
      </table></div>);
      continue;
    }
    const trimmed = line.trim();
    const heading = line.match(/^(#{1,4})\s+(.*)/);
    if (heading) {
      const Tag = `h${Math.min(heading[1].length + 1, 5)}`;
      output.push(<Tag key={index}><Inline text={heading[2]}/></Tag>);
    } else if (/^(?:\\?[-_*]\s*){3,}$/.test(trimmed) || /^(\\_){3,}$/.test(trimmed)) output.push(<hr key={index}/>);
    else if (/^>/.test(line)) output.push(<blockquote key={index}><Inline text={line.replace(/^>\s*/, '')}/></blockquote>);
    else if (/^[-*•]\s/.test(trimmed)) output.push(<p className="markdown-bullet" key={index}><Inline text={trimmed.slice(2)}/></p>);
    else if (/^\d+[.)]\s/.test(trimmed)) output.push(<p className="markdown-bullet markdown-numbered" key={index} data-marker={trimmed.match(/^\d+/)[0]}><Inline text={trimmed.replace(/^\d+[.)]\s/, '')}/></p>);
    else output.push(<p key={index}><Inline text={line}/></p>);
  }
  return <div className="markdown">{output}</div>;
}

// Fenêtre de dialogue : piège du focus, Échap, retour du focus, titre relié par aria-labelledby.
// Sur téléphone, la feuille de style la transforme en panneau ancré en bas de l’écran.
export function Modal({title, eyebrow = 'FOLIO / ESPACE DE TRAVAIL', children, onClose, className = '', busy = false}) {
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  const titleId = useId();
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const panel = panelRef.current;
    const items = () => [...panel.querySelectorAll('button, input, textarea, select, a[href], iframe, [tabindex="0"]')].filter(el => !el.disabled && el.offsetParent !== null);
    (panel.querySelector('[data-autofocus]') || items()[0])?.focus();
    function key(event) {
      if (event.key === 'Escape') { event.stopPropagation(); closeRef.current(); }
      if (event.key === 'Tab') {
        const elements = items(), first = elements[0], last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener('keydown', key);
    const scroll = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = scroll; previous?.focus?.(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={panelRef} className={`modal ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy || undefined}>
      <header className="modal-header">
        <div><span className="eyebrow">{eyebrow}</span><h2 id={titleId}>{title}</h2></div>
        <button className="icon-button" aria-label="Fermer" title="Fermer (Échap)" onClick={onClose}><X size={20}/></button>
      </header>
      {children}
    </section>
  </div>;
}

// Horloge de rafraîchissement pour les durées et dates relatives réellement écoulées.
export function useNow(interval = 30000, active = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(timer);
  }, [interval, active]);
  return now;
}

// Compteur de caractères qui n’apparaît qu’à l’approche de la limite.
export function CharacterCount({value, max, from = 0.75, id}) {
  const length = value.length;
  if (length < max * from) return null;
  return <span id={id} className={'character-count' + (length >= max * 0.95 ? ' is-near-limit' : '')} aria-live="polite">
    {length.toLocaleString('fr-FR')} / {max.toLocaleString('fr-FR')} caractères
  </span>;
}
