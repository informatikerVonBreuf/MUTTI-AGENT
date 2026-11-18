import React from 'react';
import {AlertCircle, CheckCircle2, Clock3, RefreshCw, Search, Square} from 'lucide-react';
import {useNow} from './components/Primitives.jsx';
import {AgentWorksite, ConsultedSources, RunFootprint} from './components/AgentWorksite.jsx';
import {RagPipeline, RAG_STEPS} from './components/RagPipeline.jsx';
import {formatDuration, plural} from './format.mjs';

const labels = {running: 'Analyse en cours', completed: 'Analyse terminée', failed: 'Analyse interrompue', cancelled: 'Analyse arrêtée', interrupted: 'Analyse à relancer'};
const advice = {
  NO_EVIDENCE: 'Reformulez la question, précisez l’entreprise ou la période, ou élargissez la recherche à tout le corpus.',
  MISSING_KEY: 'Ajoutez la clé du modèle IA dans la configuration privée, puis relancez.',
  AI_DISABLED: 'Les appels au modèle sont désactivés pour cette session.',
  MODEL_QUOTA: 'Le quota du fournisseur est atteint : réessayez plus tard.',
  BUDGET_EXHAUSTED: 'Posez une question plus ciblée (une entreprise, une période) pour rester dans le budget.',
  INTEGRITY_VIOLATION: 'Relancez l’analyse ; si le problème persiste, consultez le journal d’audit.',
  INPUT_REJECTED: 'Posez une question factuelle sur les rapports annuels ou trimestriels.',
  OUTPUT_REJECTED: 'Rien n’a été publié. Reformulez la question ; le détail figure dans les étapes ci-dessous.',
};

// Rend uniquement les événements réels transmis par le worker : aucune progression simulée.
export default function RunActivity({run, onRetry, onStop, disabled = false, documents = [], onOpenDocument}) {
  const running = run?.status === 'running';
  const now = useNow(1000, running);
  if (!run) return null;
  // Chat RAG : étapes fixes (sans agent) ; résumés : agents. Les anciennes analyses du chat, antérieures aux étapes, gardent leur vue.
  const pipeline = run.kind === 'chat' && Array.isArray(run.stages);
  const runningStage = pipeline ? RAG_STEPS.find(step => run.stages.some(entry => entry.stage === step.id && entry.status === 'running')) : null;
  const last = pipeline ? (runningStage ? {label: runningStage.label} : null) : [...(run.events || [])].reverse().find(event => event.status === 'running');
  const duration = run.startedAt && run.finishedAt ? Date.parse(run.finishedAt) - Date.parse(run.startedAt) : NaN;
  const elapsed = running && run.startedAt ? Math.max(0, now - Date.parse(run.startedAt)) : NaN;
  const consulted = (run.retrievals || []).reduce((count, item) => count + item.passages.length, 0);
  const abstained = run.error?.code === 'NO_EVIDENCE';
  return <section className={'run-activity run-' + run.status} aria-live="polite" aria-label="Suivi de l’analyse">
    <div className="run-activity-heading">
      {running ? <Clock3 size={16}/> : run.status === 'completed' ? <CheckCircle2 size={16}/> : <AlertCircle size={16}/>}
      <strong>{abstained ? 'Abstention : preuves insuffisantes' : labels[run.status] || run.status}</strong>
      <span>{run.kind === 'thematic' ? 'Quatre agents · LangGraph et MCP' : pipeline ? 'RAG documentaire · étapes fixes' : 'Recherche dans le corpus'}</span>
    </div>
    {running && <p>{last?.label ? last.label + '…' : 'Préparation du contexte documentaire…'}{Number.isFinite(elapsed) && <span className="run-elapsed"> · depuis {formatDuration(Math.floor(elapsed / 1000) * 1000)}</span>}</p>}
    <details className="run-worksite" open={running || run.error?.code === 'INPUT_REJECTED' || run.error?.code === 'OUTPUT_REJECTED' || undefined}>
      <summary>{pipeline ? (running ? 'Le RAG, étape par étape, en direct' : 'Voir les étapes du RAG') : (running ? 'Le chantier des agents, en direct' : 'Voir le chantier des agents')}</summary>
      {pipeline ? <RagPipeline run={run}/> : <AgentWorksite run={run}/>}
    </details>
    {abstained ? <p className="run-abstention">Aucun passage ne permet d’affirmer une réponse vérifiable{consulted ? ` parmi les ${consulted} passages consultés` : ''}. Folio préfère s’abstenir plutôt que de compléter avec des connaissances générales. {advice.NO_EVIDENCE}</p>
      : run.error && <p className="run-error">{run.error.message}{advice[run.error.code] && run.error.message.indexOf(advice[run.error.code]) < 0 ? ' ' + advice[run.error.code] : ''}</p>}
    {run.status === 'completed' && <p>{run.verifiedClaimCount || 0} affirmation{run.verifiedClaimCount > 1 ? 's' : ''} liée{run.verifiedClaimCount > 1 ? 's' : ''} aux passages sources.{run.evidenceCount ? ` ${plural(run.evidenceCount, 'passage consulté', 'passages consultés')}.` : ''}</p>}
    {!running && run.status !== 'completed' && !abstained && run.evidenceCount > 0 && <p>{plural(run.evidenceCount, 'passage consulté', 'passages consultés')} avant l’arrêt.</p>}
    <RunFootprint run={run} compact/>
    {consulted > 0 && <details className="run-consulted"><summary><Search size={12}/>Voir {pipeline ? 'les passages consultés' : 'ce que les agents ont consulté'} ({plural(consulted, 'passage', 'passages')})</summary><ConsultedSources run={run} documents={documents} onOpenDocument={onOpenDocument}/></details>}
    {Number.isFinite(duration) && duration >= 0 && <p className="run-duration">Durée totale : {(duration / 1000).toLocaleString('fr-FR', {maximumFractionDigits: 1})} s</p>}
    <div className="run-activity-actions">
      {running ? <button type="button" onClick={onStop} disabled={disabled}><Square size={12}/>Arrêter l’analyse</button>
        : ['failed', 'cancelled', 'interrupted'].includes(run.status) && <button type="button" onClick={onRetry} disabled={disabled}><RefreshCw size={12}/>Relancer cette question</button>}
    </div>
  </section>;
}
