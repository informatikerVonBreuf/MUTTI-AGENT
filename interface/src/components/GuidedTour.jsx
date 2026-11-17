import React from 'react';
import {ArrowLeft, ArrowRight, X} from 'lucide-react';
import {readPreference, writePreference} from '../preferences.mjs';

// Visite guidée en quatre étapes au premier lancement. Elle ne montre que des fonctions réelles,
// se ferme au clavier (Échap) et ne revient pas une fois vue (si les préférences locales sont acceptées).
const STEPS = [
  {sticker: '📚', title: 'La bibliothèque', page: 'library', text: 'Les rapports 10-K, 10-Q et 8-K de Meta, Google, Apple et Amazon, classés par entreprise, année et type. Un aperçu rapide permet de lire le début d’un rapport sans l’ouvrir.'},
  {sticker: '💬', title: 'Poser une question', page: 'chat', text: 'Écrivez votre question : la recherche dans le corpus est automatique. Chaque réponse cite mot pour mot ses sources, avec la page, ou s’abstient si les preuves manquent.'},
  {sticker: '🏗️', title: 'Le chantier des agents', page: 'themes', text: 'Pour un résumé, quatre agents se passent le travail dans des colis scellés : planificateur, chercheur, vérificateur, rédacteur. Vous voyez qui travaille, ce qu’il consulte et les barrières de sécurité déclenchées.'},
  {sticker: '🌍', title: 'Ce que cela coûte', page: 'metrics', text: 'Chaque analyse affiche son coût réel, ses tokens et une estimation de son empreinte (énergie, CO₂e, eau). La page Mesures donne les latences p50, p95 et p99.'},
];

export default function GuidedTour({onNavigate}) {
  const [index, setIndex] = React.useState(-1);
  const dialog = React.useRef(null), previousFocus = React.useRef(null);
  React.useEffect(() => { if (!readPreference('folio-tour')) setIndex(0); }, []);
  React.useEffect(() => {
    if (index < 0) return undefined;
    previousFocus.current ||= document.activeElement;
    dialog.current?.focus();
    const onKey = event => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps
  function close() { writePreference('folio-tour', 'done'); setIndex(-1); previousFocus.current?.focus?.(); }
  if (index < 0) return null;
  const step = STEPS[index], last = index === STEPS.length - 1;
  return <div className="guided-tour" role="dialog" aria-modal="false" aria-labelledby="tour-title" aria-describedby="tour-text" tabIndex={-1} ref={dialog}>
    <button type="button" className="guided-tour-close" onClick={close} aria-label="Fermer la visite guidée"><X size={16}/></button>
    <span className="sticker guided-tour-sticker" role="img" aria-hidden="true">{step.sticker}</span>
    <span className="eyebrow">VISITE GUIDÉE · {index + 1} / {STEPS.length}</span>
    <h2 id="tour-title">{step.title}</h2>
    <p id="tour-text">{step.text}</p>
    <div className="guided-tour-dots" aria-hidden="true">{STEPS.map((_, dot) => <i key={dot} className={dot === index ? 'is-current' : ''}/>)}</div>
    <div className="guided-tour-actions">
      <button type="button" className="text-button" onClick={close}>Passer la visite</button>
      {index > 0 && <button type="button" className="button-secondary" onClick={() => setIndex(index - 1)}><ArrowLeft size={14}/>Précédent</button>}
      <button type="button" className="button-secondary" onClick={() => onNavigate?.(step.page)}>Ouvrir cette page</button>
      <button type="button" className="button-primary" onClick={() => last ? close() : setIndex(index + 1)}>{last ? 'Commencer' : 'Suivant'}{!last && <ArrowRight size={14}/>}</button>
    </div>
  </div>;
}
