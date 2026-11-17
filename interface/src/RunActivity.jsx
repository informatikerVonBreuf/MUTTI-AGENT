import React from 'react';
import {AlertCircle, CheckCircle2, Circle, Clock3, LoaderCircle, RefreshCw, Square, XCircle} from 'lucide-react';
import {useNow} from './components/Primitives.jsx';
import {agentLabels, formatDuration, plural} from './format.mjs';

const labels = {running: 'Analyse en cours', completed: 'Analyse terminée', failed: 'Analyse interrompue', cancelled: 'Analyse arrêtée', interrupted: 'Analyse à relancer'};
const stepStates = {running: 'en cours', completed: 'terminée', failed: 'en échec', cancelled: 'arrêtée', interrupted: 'interrompue', pending: 'en attente'};
const advice = {
  NO_EVIDENCE: 'Reformulez la question, précisez l’entreprise ou la période, ou élargissez la recherche à tout le corpus.',
  MISSING_KEY: 'Ajoutez la clé du modèle IA dans la configuration privée, puis relancez.',
  AI_DISABLED: 'Les appels au modèle sont désactivés pour cette session.',
  MODEL_QUOTA: 'Le quota du fournisseur est atteint : réessayez plus tard.',
};

function StepIcon({status}) {
  if (status === 'completed') return <CheckCircle2 size={14}/>;
  if (status === 'running') return <LoaderCircle size={14} className="run-step-spinner"/>;
  if (['failed', 'cancelled', 'interrupted'].includes(status)) return <XCircle size={14}/>;
  return <Circle size={14}/>;
}

// Rend uniquement les événements réels transmis par le worker : aucune progression simulée.
export default function RunActivity({run, onRetry, onStop, disabled = false}) {
  const running = run?.status === 'running';
  const now = useNow(1000, running);
  if (!run) return null;
  const last = [...(run.events || [])].reverse().find(event => event.status === 'running');
  const steps = (run.tasks || []).filter(task => task.status !== 'not_used');
  const duration = run.startedAt && run.finishedAt ? Date.parse(run.finishedAt) - Date.parse(run.startedAt) : NaN;
  const elapsed = running && run.startedAt ? Math.max(0, now - Date.parse(run.startedAt)) : NaN;
  return <section className={'run-activity run-' + run.status} aria-live="polite" aria-label="Suivi de l’analyse">
    <div className="run-activity-heading">
      {running ? <Clock3 size={16}/> : run.status === 'completed' ? <CheckCircle2 size={16}/> : <AlertCircle size={16}/>}
      <strong>{labels[run.status] || run.status}</strong>
      <span>{run.kind === 'thematic' ? 'Quatre rôles · agents Python' : 'Recherche dans le corpus'}</span>
    </div>
    {running && <p>{last?.label ? last.label + '…' : 'Préparation du contexte documentaire…'}{Number.isFinite(elapsed) && <span className="run-elapsed"> · depuis {formatDuration(Math.floor(elapsed / 1000) * 1000)}</span>}</p>}
    {steps.length > 0 && <ol className="run-steps">{steps.map(step => <li key={step.agent} className={'run-step step-' + step.status}>
      <StepIcon status={step.status}/>
      <span>{agentLabels[step.agent] || step.agent}</span>
      <small>{Number.isFinite(step.durationMs) ? formatDuration(step.durationMs) : stepStates[step.status] || step.status}</small>
    </li>)}</ol>}
    {run.error && <p className="run-error">{run.error.message}{advice[run.error.code] && run.error.message.indexOf(advice[run.error.code]) < 0 ? ' ' + advice[run.error.code] : ''}</p>}
    {run.status === 'completed' && <p>{run.verifiedClaimCount || 0} affirmation{run.verifiedClaimCount > 1 ? 's' : ''} liée{run.verifiedClaimCount > 1 ? 's' : ''} aux passages sources.{run.evidenceCount ? ` ${plural(run.evidenceCount, 'passage consulté', 'passages consultés')}.` : ''}{run.resultStatus === 'insufficient_evidence' ? ' Les preuves disponibles sont insuffisantes.' : ''}</p>}
    {!running && run.status !== 'completed' && run.evidenceCount > 0 && <p>{plural(run.evidenceCount, 'passage consulté', 'passages consultés')} avant l’arrêt.</p>}
    {Number.isFinite(duration) && duration >= 0 && <p className="run-duration">Durée totale : {(duration / 1000).toLocaleString('fr-FR', {maximumFractionDigits: 1})} s</p>}
    <div className="run-activity-actions">
      {running ? <button type="button" onClick={onStop} disabled={disabled}><Square size={12}/>Arrêter l’analyse</button>
        : ['failed', 'cancelled', 'interrupted'].includes(run.status) && <button type="button" onClick={onRetry} disabled={disabled}><RefreshCw size={12}/>Relancer cette question</button>}
    </div>
  </section>;
}
