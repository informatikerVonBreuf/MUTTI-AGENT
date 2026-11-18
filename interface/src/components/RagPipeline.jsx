import React from 'react';
import {formatDuration, plural} from '../format.mjs';
import {formatTokens, formatUsd, runMeasures, totalTokens} from '../measures.mjs';
import {anyReasonLabel, reasonLabel, signalLabels} from '../security-labels.mjs';
import {useNow} from './Primitives.jsx';

// Le chat RAG documentaire : huit étapes fixes, sans agent. Une carte ne s'anime que sur un statut réel « running ».
export const RAG_STEPS = [
  {id: 'input_guard', sticker: '🛂', label: 'Filtre d’entrée', does: 'Bloque injection, jailbreak, demande de secret ou hors sujet avant tout appel ; masque les données personnelles.'},
  {id: 'query', sticker: '🧭', label: 'Préparation de la requête', does: 'Complète une relance avec l’entreprise et l’année de la question précédente, par règle.'},
  {id: 'retrieval', sticker: '🔎', label: 'Recherche', does: 'BM25 sur les seuls rapports vérifiés par empreinte, dans vos droits.'},
  {id: 'passage_screen', sticker: '🧪', label: 'Contrôle des passages', does: 'Second filtre sur chaque passage et sur les notes ; rien ne reste ? abstention sans appel.'},
  {id: 'generation', sticker: '✍️', label: 'Génération', does: 'Un appel, consignes fixes séparées des données, jeton témoin, réponse JSON stricte.'},
  {id: 'output_guard', sticker: '✅', label: 'Contrôle de sortie', does: 'Citation mot pour mot, année, montants, entreprise ; ni lien, ni secret, ni instruction.'},
  {id: 'correction', sticker: '🔁', label: 'Correction ou abstention', does: 'Retire les affirmations fautives ; une seule nouvelle demande si elles sont réparables.'},
  {id: 'answer', sticker: '📄', label: 'Réponse assemblée', does: 'Le serveur revérifie chaque affirmation, puis assemble réponse et citations.'},
];
const STATUS = {pending: 'en attente', running: 'en cours', completed: 'terminée', blocked: 'a bloqué', skipped: 'non nécessaire', failed: 'interrompue'};
const STATUS_STICKER = {pending: '⏳', running: '⚙️', completed: '✅', blocked: '🚧', skipped: '➖', failed: '⛔'};

// Détails réels d'une étape (compteurs transmis par le worker ou le serveur, jamais de contenu).
function stageFacts(step, entry, run, measures) {
  const d = entry?.detail || {}, facts = [];
  const usage = measures?.byStage?.[step.id];
  if (step.id === 'input_guard') {
    if (d.reasons?.length) facts.push(['Motif', d.reasons.map(anyReasonLabel).join(', ')]);
    if (d.pii) facts.push(['Masqué', plural(d.pii, 'donnée personnelle', 'données personnelles')]);
    if (d.disabled) facts.push(['Mesure', 'filtre désactivé (suite red team)']);
  }
  if (step.id === 'query' && d.follow_up) facts.push(['Relance', 'entreprise et période reprises']);
  if (step.id === 'retrieval' && Number.isInteger(d.passages)) facts.push(['Trouvé', plural(d.passages, 'passage', 'passages') + (d.quarantined ? ` · ${d.quarantined} écarté${d.quarantined > 1 ? 's' : ''}` : '') + (d.integrity ? ` · ${d.integrity} rapport modifié` : '')]);
  if (step.id === 'passage_screen' && Number.isInteger(d.eligible)) facts.push(['Retenu', plural(d.eligible, 'passage', 'passages') + (d.quarantined ? ` · ${d.quarantined} écarté${d.quarantined > 1 ? 's' : ''}` : '') + (d.memory_quarantined ? ` · ${d.memory_quarantined} note${d.memory_quarantined > 1 ? 's' : ''} écartée${d.memory_quarantined > 1 ? 's' : ''}` : '')]);
  if (step.id === 'generation' && Number.isInteger(d.claims)) facts.push(['Proposé', plural(d.claims, 'affirmation', 'affirmations')]);
  if (step.id === 'output_guard') {
    if (d.fatal) facts.push(['Rejet', anyReasonLabel(d.fatal)]);
    if (Number.isInteger(d.kept)) facts.push(['Gardé', `${d.kept} sur ${d.claims ?? d.kept}`]);
    if (d.reasons?.length) facts.push(['Retiré', d.reasons.map(anyReasonLabel).join(', ')]);
  }
  if (step.id === 'correction') {
    if (d.retry) facts.push(['Nouvelle demande', d.kept ? `réussie (${plural(d.kept, 'affirmation', 'affirmations')})` : 'sans succès']);
    if (d.abstention) facts.push(['Issue', 'abstention : preuves insuffisantes']);
    if (d.fatal) facts.push(['Rejet', anyReasonLabel(d.fatal)]);
  }
  if (step.id === 'answer') {
    if (d.fatal) facts.push(['Rejet', anyReasonLabel(d.fatal)]);
    if (Number.isInteger(d.claims)) facts.push(['Publié', plural(d.claims, 'affirmation', 'affirmations') + ` · ${plural(d.citations || 0, 'source', 'sources')}`]);
    if (d.server_dropped) facts.push(['Contrôle serveur', `${d.server_dropped} retirée${d.server_dropped > 1 ? 's' : ''}`]);
  }
  if (usage?.calls > 0) facts.push(['Modèle', `${plural(usage.calls, 'appel', 'appels')} · ${formatTokens(totalTokens(usage))}${measures.simulated ? '' : ' · ' + formatUsd(usage.costUsd)}`]);
  return facts;
}

export function RagPipeline({run}) {
  const running = run?.status === 'running';
  const now = useNow(1000, running);
  if (!run?.stages) return null;
  const byId = new Map(run.stages.map(entry => [entry.stage, entry]));
  const measures = runMeasures(run);
  const rejected = run.rejectedClaims || [];
  return <section className={'rag-pipeline pipeline-' + run.status} aria-label="Le RAG documentaire, étape par étape">
    <header className="worksite-header">
      <span className="sticker worksite-emblem" role="img" aria-label="Chaîne fixe">🛤️</span>
      <div>
        <span className="eyebrow">LE RAG DOCUMENTAIRE, ÉTAPE PAR ÉTAPE</span>
        <p>Aucun agent : des étapes fixes et des règles déterministes. {run.attempts === 2 ? 'La règle de correction a demandé une seconde réponse.' : 'Un seul appel au modèle.'}</p>
      </div>
    </header>
    <ol className="pipeline-steps">{RAG_STEPS.map(step => {
      const entry = byId.get(step.id) || {status: 'pending'};
      const live = entry.status === 'running' && entry.startedAt ? Math.max(0, now - Date.parse(entry.startedAt)) : NaN;
      const facts = stageFacts(step, entry, run, measures);
      return <li key={step.id} className={'worker pipeline-step is-' + entry.status}>
        <div className="worker-card">
          <div className="worker-stickers">
            <span className="sticker worker-sticker" role="img" aria-label={step.label}>{step.sticker}</span>
            <span className="sticker worker-state-sticker" role="img" aria-label={STATUS[entry.status] || entry.status}>{STATUS_STICKER[entry.status] || '⏳'}</span>
          </div>
          <h3>{step.label}</h3>
          <p className="worker-job">{step.does}</p>
          <p className="worker-state"><strong>{STATUS[entry.status] || entry.status}</strong>
            {Number.isFinite(live) && <> · depuis {formatDuration(Math.floor(live / 1000) * 1000)}</>}
            {Number.isFinite(entry.durationMs) && entry.status !== 'skipped' && <> · {formatDuration(entry.durationMs)}</>}
          </p>
          {facts.length > 0 && <dl className="worker-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
        </div>
      </li>;
    })}</ol>
    {rejected.length > 0 && <div className="pipeline-rejected">
      <span className="eyebrow">AFFIRMATIONS RETIRÉES PAR LES RÈGLES</span>
      <ul>{rejected.map((item, index) => <li key={index}><span className="sticker" role="img" aria-label="Retirée">✂️</span>{item.by === 'server' ? 'Contrôle serveur' : 'Contrôle de sortie'}{Number.isInteger(item.index) ? ` · affirmation ${item.index + 1}` : ''} : {(item.reasons || []).map(anyReasonLabel).join(', ')}</li>)}</ul>
    </div>}
    {run.security?.length > 0 && <ul className="worksite-barriers" aria-label="Barrières de sécurité déclenchées">{run.security.map((item, index) => <li key={index}>
      <span className="sticker" role="img" aria-label={item.decision === 'allowed' ? 'Information' : 'Barrière de sécurité'}>{item.decision === 'allowed' ? '🛡️' : '🚧'}</span>
      <span>{reasonLabel(item.kind)}{item.reason && !['instruction_in_passage', 'instruction_in_document', 'instruction_in_memory'].includes(item.reason) ? ' — ' + item.reason.split('+').map(anyReasonLabel).join(', ') : ''}{item.count ? ` · ${item.count}` : ''}{item.signals?.length ? ` (${item.signals.map(signal => signalLabels[signal] || anyReasonLabel(signal)).join(', ')})` : ''}</span>
    </li>)}</ul>}
  </section>;
}
