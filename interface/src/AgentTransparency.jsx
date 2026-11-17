import React from 'react';
import {Check, CheckCircle2, ChevronRight, Circle, Clock3, Eye, LoaderCircle, LockKeyhole, MinusCircle, ShieldCheck, XCircle} from 'lucide-react';
import {formatDuration, plural, toolLabels} from './format.mjs';
import {reasonLabel} from './security-labels.mjs';
import {AgentWorksite, ConsultedSources, RunFootprint} from './components/AgentWorksite.jsx';
export {reasonLabel, securityReasons} from './security-labels.mjs';

const states = {awaiting_backend: 'PRÉVU', pending: 'EN ATTENTE', running: 'EN COURS', completed: 'TERMINÉ', failed: 'ÉCHEC', cancelled: 'ARRÊTÉ', interrupted: 'INTERROMPU', not_used: 'NON UTILISÉ'};
const planStates = {running: 'Exécution en cours', completed: 'Dernière exécution terminée', failed: 'Dernière exécution en échec', cancelled: 'Dernière exécution arrêtée', interrupted: 'Dernière exécution interrompue'};
const eventStates = {running: 'démarre', completed: 'terminée'};
const tools = toolLabels;

function StateIcon({status}) {
  if (status === 'completed') return <CheckCircle2 size={12}/>;
  if (status === 'running') return <LoaderCircle size={12} className="run-step-spinner"/>;
  if (['failed', 'cancelled', 'interrupted'].includes(status)) return <XCircle size={12}/>;
  if (status === 'not_used') return <MinusCircle size={12}/>;
  return <Circle size={12}/>;
}

export default function AgentTransparency({plan, run, threadId, documents = [], onOpenDocument}) {
  if (!plan) return null;
  const executed = plan.status !== 'prepared_not_executed';
  const totalMs = run?.startedAt && run?.finishedAt ? Date.parse(run.finishedAt) - Date.parse(run.startedAt) : NaN;
  return <section className="agent-transparency" aria-labelledby="agent-transparency-title">
    <header>
      <div><span className="eyebrow">TRANSPARENCE / PLAN DE TRAVAIL</span><h2 id="agent-transparency-title">Quatre rôles.<br/><em>Un résumé traçable.</em></h2></div>
      <span className={'plan-status plan-' + plan.status}><Clock3 size={13}/>{plan.status === 'prepared_not_executed' ? 'Plan préparé · non exécuté' : planStates[plan.status] || states[plan.status] || plan.status}</span>
    </header>
    <p className="transparency-description">Les rôles exécutent des tâches limitées. Les événements ci-dessous proviennent du traitement réel : aucune étape en attente n’est présentée comme réalisée.</p>
    {executed && run && <dl className="agent-run-summary">
      {run.startedAt && <div><dt>Lancée</dt><dd>{new Date(run.startedAt).toLocaleString('fr-FR', {dateStyle: 'medium', timeStyle: 'short'})}</dd></div>}
      {Number.isFinite(totalMs) && totalMs >= 0 && <div><dt>Durée</dt><dd>{formatDuration(totalMs)}</dd></div>}
      <div><dt>Passages retenus</dt><dd>{(run.evidenceCount || 0).toLocaleString('fr-FR')}</dd></div>
      <div><dt>Affirmations vérifiées</dt><dd>{(run.verifiedClaimCount || 0).toLocaleString('fr-FR')}</dd></div>
    </dl>}
    <ol className="agent-task-grid">{plan.tasks.map(task => <li className={'agent-task task-' + task.id + ' state-' + task.status} key={task.id}>
      <div className="agent-task-index"><span>{String(task.order).padStart(2, '0')}</span><span className="agent-task-state"><StateIcon status={task.status}/>{states[task.status] || task.status}</span></div>
      <h3>{task.name}</h3>
      {Number.isFinite(task.durationMs) && <small className="agent-duration">Durée : {formatDuration(task.durationMs)}</small>}
      <p>{task.task}</p>
      <div className="agent-task-permission"><LockKeyhole size={12}/>{task.canReadDocuments ? 'Corpus autorisé uniquement' : 'Aucun accès direct aux fichiers'}</div>
      <details><summary>Outils et résultat attendu<ChevronRight size={12}/></summary><ul>{task.tools.map(tool => <li key={tool}>{tools[tool] || tool}<code>{tool}</code></li>)}</ul><span className="task-output">Livrable : {task.outputs.join(', ')}</span></details>
    </li>)}</ol>
    <div className="agent-controls">
      <div><ShieldCheck size={17}/><span><strong>Permissions bornées</strong><small>Aucun outil shell. Au plus {plan.policies?.toolBudget || 12} appels d’outils et {plan.policies?.maxDocuments || 8} documents par analyse.</small></span></div>
      <div><Check size={17}/><span><strong>Contrôles des preuves</strong><small>Citations exactes contrôlées ; vérification de cohérence assistée par le modèle, sans garantie absolue.</small></span></div>
      <div><Eye size={17}/><span><strong>Journal d’exécution</strong><small>{plan.events.length ? plural(plan.events.length, 'événement enregistré', 'événements enregistrés') + '.' : 'Aucun événement : aucun agent n’a encore été exécuté.'}</small></span></div>
    </div>
    {plan.error && <p className="plan-error" role="status">{plan.error.message}</p>}
    {plan.events.length > 0 && <ol className="agent-event-log" aria-label="Journal d’exécution">{plan.events.map((event, index) => <li key={index}>
      <time dateTime={event.at}>{new Date(event.at).toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit', second: '2-digit'})}</time>
      <strong>{event.label}</strong>
      <span>{eventStates[event.status] || states[event.status] || event.status}{event.tool ? ` · ${tools[event.tool] || event.tool}` : ''}</span>
    </li>)}</ol>}
    {executed && run && <AgentWorksite run={run}/>}
    {executed && run && <RunFootprint run={run}/>}
    {executed && run && <ConsultedSources run={run} documents={documents} onOpenDocument={onOpenDocument}/>}
    {executed && run && <AuditTrail threadId={threadId} run={run}/>}
  </section>;
}

const auditActions = {auth: 'Connexion', run_start: 'Début d’analyse', run_end: 'Fin d’analyse', tool_call: 'Appel d’outil', model_call: 'Appel au modèle', handoff: 'Transfert signé', security: 'Décision de sécurité', policy: 'Politique'};
const roleNames = {server: 'Serveur', planner: 'Planificateur', researcher: 'Chercheur', verifier: 'Vérificateur', writer: 'Rédacteur'};
const trustNames = {trusted_instruction: 'consigne du serveur', model_plan: 'plan du modèle', untrusted_evidence: 'preuves non vérifiées', verified_evidence: 'preuves vérifiées', verified_summary: 'synthèse vérifiée'};

// Vue « Audit » : journal chaîné du serveur pour la dernière exécution, et intégrité de la chaîne.
export function AuditTrail({threadId, run}) {
  const [state, setState] = React.useState({loading: false, data: null, error: ''});
  const runKey = run?.id + ':' + run?.status;
  React.useEffect(() => {
    if (!threadId || !run?.id || run.status === 'running') return undefined;
    let cancelled = false;
    setState(current => ({...current, loading: true, error: ''}));
    fetch(`/api/threads/${threadId}/audit`, {credentials: 'same-origin'}).then(response => response.ok ? response.json() : Promise.reject(new Error()))
      .then(data => { if (!cancelled) setState({loading: false, data, error: ''}); })
      .catch(() => { if (!cancelled) setState({loading: false, data: null, error: 'Journal d’audit indisponible pour le moment.'}); });
    return () => { cancelled = true; };
  }, [threadId, runKey]);
  if (!run?.id) return null;
  const {data, loading, error} = state;
  return <section className="agent-audit" aria-labelledby="agent-audit-title">
    <header>
      <span className="eyebrow">AUDIT / JOURNAL CHAÎNÉ</span>
      <h3 id="agent-audit-title">Qui a fait quoi, avec quels documents.</h3>
      {data?.chain && <span className={'audit-chain ' + (data.chain.valid ? 'is-valid' : 'is-broken')} role="status">
        {data.chain.valid ? <ShieldCheck size={13}/> : <XCircle size={13}/>}
        {data.chain.valid ? `Chaîne intacte · ${plural(data.chain.entries, 'entrée', 'entrées')} · empreinte ${String(data.chain.lastHash || '').slice(0, 10)}…` : `Chaîne rompue à la ligne ${data.chain.brokenAt}`}
      </span>}
    </header>
    <p className="transparency-description">Chaque ligne contient l’empreinte de la précédente : une modification ou une suppression devient détectable. Aucune question, aucun passage, aucun secret n’y figure.</p>
    {run.handoffs?.length > 0 && <ol className="audit-handoffs" aria-label="Transferts signés entre agents">{run.handoffs.map(handoff => <li key={handoff.seq}>
      <span className="handoff-seq">#{handoff.seq}</span>
      <strong>{roleNames[handoff.from] || handoff.from} → {roleNames[handoff.to] || handoff.to}</strong>
      <span>{trustNames[handoff.trust] || handoff.trust}</span>
      <span className="handoff-verified"><LockKeyhole size={11}/>signature vérifiée · {handoff.payloadHash}</span>
    </li>)}</ol>}
    {run.security?.length > 0 && <ul className="audit-security" aria-label="Décisions de sécurité">{run.security.map((item, index) => <li key={index} className={'decision-' + item.decision}>
      <XCircle size={12}/><span>{reasonLabel(item.kind)}{item.count ? ` · ${item.count}` : ''}{item.signals?.length ? ` · ${item.signals.join(', ')}` : ''}</span>
    </li>)}</ul>}
    {loading && <p className="audit-loading">Lecture du journal d’audit…</p>}
    {error && <p className="audit-loading" role="status">{error}</p>}
    {data?.entries?.length > 0 && <ol className="audit-entries">{data.entries.map(entry => <li key={entry.seq} className={'audit-' + entry.action + (entry.decision === 'blocked' ? ' is-blocked' : '')}>
      <time dateTime={entry.at}>{new Date(entry.at).toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit', second: '2-digit'})}</time>
      <strong>{auditActions[entry.action] || entry.action}</strong>
      <span>{[entry.agent && (roleNames[entry.agent] || entry.agent), entry.tool && (tools[entry.tool] || entry.tool), entry.from && `${roleNames[entry.from] || entry.from} → ${roleNames[entry.to] || entry.to}`,
        entry.decision === 'blocked' ? 'bloqué' : entry.decision === 'allowed' ? 'autorisé' : '', entry.reason && entry.action === 'security' ? reasonLabel(entry.reason) : entry.outcome || '',
        entry.documents?.length ? plural(entry.documents.length, 'document', 'documents') : '', Number.isFinite(entry.inputTokens) ? `${entry.inputTokens.toLocaleString('fr-FR')} + ${(entry.outputTokens || 0).toLocaleString('fr-FR')} tokens` : '',
        Number.isFinite(entry.costUsd) ? `${entry.costUsd.toLocaleString('fr-FR', {maximumSignificantDigits: 3})} $` : '', Number.isFinite(entry.durationMs) ? formatDuration(entry.durationMs) : ''].filter(Boolean).join(' · ')}</span>
      <code title={'Empreinte : ' + entry.hash}>{String(entry.hash).slice(0, 8)}</code>
    </li>)}</ol>}
  </section>;
}

export function RagPreparationView({packet, loading}) {
  return <section className="rag-preparation-view"><span className="eyebrow">CHAT PDF / PRÉPARATION DU CONTEXTE</span><h2>Des passages,<br/><em>avec des limites explicites.</em></h2>{loading ? <p>Recherche et contrôle du contexte sélectionné…</p> : packet ? <><div className="rag-metrics"><span><b>{packet.metrics.documents}</b>documents</span><span><b>{packet.metrics.passages}</b>passages retenus</span><span><b>{packet.metrics.quarantinedPassages + packet.metrics.quarantinedMemory}</b>éléments isolés</span></div><p>Le périmètre des documents, la taille du contexte et la lecture seule sont contrôlés par le code. La détection des instructions suspectes utilise ici des règles heuristiques ; elle ne garantit pas la protection contre toute injection.</p><ul className="rag-checks"><li><Check size={14}/>Recherche automatique dans le corpus autorisé</li><li><Check size={14}/>Passages et mémoire marqués comme données non fiables</li><li><Check size={14}/>Contexte limité à {packet.metrics.contextCharacters.toLocaleString('fr-FR')} caractères de passages</li><li><Clock3 size={14}/>Contrôle local du contexte ; la génération est exécutée séparément</li></ul>{packet.metrics.passages === 0 && <div className="preparation-empty">Aucun passage éligible pour cette question dans les documents choisis. Essayez un autre périmètre.</div>}<div className="rag-no-answer">Ce contrôle prépare les données. Il ne génère pas de réponse et n’active pas les citations dans le chat.</div></> : <p>Écrivez une question pour préparer des passages limités à cette sélection.</p>}</section>;
}
