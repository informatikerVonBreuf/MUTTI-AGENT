import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

function Inline({ text }) {
  return text.split(/(\*\*[^*]+\*\*)/).map((part, index) => part.startsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : part);
}
export function Markdown({ text }) {
  const lines = text.split('\n');
  const output = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) continue;
    if (line.includes('|') && /^\s*\|?\s*:?-{3}/.test(lines[index + 1] || '')) {
      const rows = [line]; index += 2;
      while (index < lines.length && lines[index].includes('|')) rows.push(lines[index++]);
      index--;
      const cells = row => row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|');
      output.push(<div className="table-scroll" key={index}><table><thead><tr>{cells(rows[0]).map((cell, i) => <th key={i}><Inline text={cell} /></th>)}</tr></thead><tbody>{rows.slice(1).map((row, i) => <tr key={i}>{cells(row).map((cell, j) => <td key={j}><Inline text={cell} /></td>)}</tr>)}</tbody></table></div>); continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)/);
    if (heading) { const Tag = `h${Math.min(heading[1].length + 1, 5)}`; output.push(<Tag key={index}><Inline text={heading[2]} /></Tag>); }
    else if (/^>/.test(line)) output.push(<blockquote key={index}><Inline text={line.replace(/^>\s*/, '')} /></blockquote>);
    else if (/^[-*]\s/.test(line.trim())) output.push(<p className="markdown-bullet" key={index}><Inline text={line.trim().slice(2)} /></p>);
    else if (/^---+$/.test(line.trim())) output.push(<hr key={index} />);
    else output.push(<p key={index}><Inline text={line} /></p>);
  }
  return <div className="markdown">{output}</div>;
}
export function Modal({ title, children, onClose, className = '' }) {
  const panelRef = useRef();
  useEffect(() => {
    const previous = document.activeElement;
    const panel = panelRef.current;
    const items = () => [...panel.querySelectorAll('button, input, textarea, select, a[href], [tabindex="0"]')].filter(el => !el.disabled);
    items()[0]?.focus();
    function key(event) {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const elements = items(); const first = elements[0]; const last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener('keydown', key);
    const scroll = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = scroll; previous?.focus(); };
  }, [onClose]);
  return <div className="modal-backdrop" onClick={onClose}><section ref={panelRef} className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={title} onClick={event => event.stopPropagation()}><header className="modal-header"><div><span className="eyebrow">FOLIO / ESPACE DE TRAVAIL</span><h2>{title}</h2></div><button className="icon-button" aria-label="Fermer" onClick={onClose}><X size={20} /></button></header>{children}</section></div>;
}
