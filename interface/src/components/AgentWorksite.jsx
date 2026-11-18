import React from 'react';
import {BookOpen, ExternalLink, Leaf, LockKeyhole, Search} from 'lucide-react';
import {useNow} from './Primitives.jsx';
import {documentTitle, formatDuration, plural} from '../format.mjs';
import {formatCo2, formatMs, formatTokens, formatUsd, formatWater, formatWh, ledEquivalent, runMeasures, totalTokens} from '../measures.mjs';
import {reasonLabel, signalLabels} from '../security-labels.mjs';

// L'équipe, présentée comme un chantier. Chaque personnage ne s'anime que sur un événement réel du worker.
export const CREW = {
  planner: {sticker: '📐', name: 'Planificateur', trade: 'Chef de chantier', job: 'Trace le plan et répartit les axes de recherche.'},
  researcher: {sticker: '⛏️', name: 'Chercheur', trade: 'Carrier', job: 'Extrait les pierres : les passages utiles du corpus autorisé.'},
  verifier: {sticker: '📏', name: 'Vérificateur', trade: 'Contrôleur', job: 'Contrôle chaque pierre : citation exacte, bonne année, affirmation appuyée.'},
  writer: {sticker: '🧱', name: 'Rédacteur', trade: 'Maçon', job: 'Monte le mur avec les seules pierres vérifiées, sans en ajouter.'},
};
const ORDER = ['planner', 'researcher', 'verifier', 'writer'];
const CARGO = {trusted_instruction: 'la commande', model_plan: 'le plan', untrusted_evidence: 'des pierres brutes', verified_evidence: 'des pierres contrôlées', verified_summary: 'le mur terminé'};
const STATE = {pending: 'attend son tour', running: 'au travail', completed: 'a terminé', failed: 'à l’arrêt', cancelled: 'arrêté', interrupted: 'interrompu', not_used: 'pas mobilisé'};
const STATE_STICKER = {pending: '⏳', running: '🔨', completed: '✅', failed: '⛔', cancelled: '⏹️', interrupted: '⏸️', not_used: '💤'};
export const MARKET_STATUS = {ok: 'reçu', quarantined: 'écarté (instruction détectée)', unavailable: 'indisponible', denied: 'refusé', error: 'erreur du service'};

function Sticker({symbol, label, className = ''}) {
  return <span className={'sticker ' + className} role="img" aria-label={label}>{symbol}</span>;
}

function Handoff({handoff, waiting}) {
  if (!handoff) return <div className="worksite-handoff is-waiting" aria-hidden={waiting ? undefined : true}><span className="handoff-line"/>{waiting && <small>en attente du colis</small>}</div>;
  return <div className="worksite-handoff is-sealed">
    <span className="handoff-line"/>
    <Sticker symbol="📦" label="Colis scellé"/>
    <small><strong>Colis scellé n°{handoff.seq}</strong> · {CARGO[handoff.trust] || handoff.trust}<span className="handoff-lock"><LockKeyhole size={10}/>signature vérifiée</span></small>
  </div>;
}

export function AgentWorksite({run}) {
  const running = run?.status === 'running';
  const now = useNow(1000, running);
  if (!run) return null;
  const tasks = new Map((run.tasks || []).map(task => [task.agent, task]));
  const roles = ORDER.filter(role => tasks.has(role) && (run.kind === 'thematic' || tasks.get(role).status !== 'not_used'));
  const handoffs = run.handoffs || [];
  const measures = runMeasures(run);
  const passages = (run.retrievals || []).reduce((count, item) => count + item.passages.length, 0);
  const documents = new Set((run.retrievals || []).flatMap(item => item.passages.map(p => p.documentId))).size;
  const handoffFrom = role => handoffs.find(item => item.from === role);
  return <section className={'agent-worksite worksite-' + run.status} aria-label="Le chantier des agents">
    <header className="worksite-header">
      <Sticker symbol="🏗️" label="Chantier" className="worksite-emblem"/>
      <div>
        <span className="eyebrow">LE CHANTIER DES AGENTS</span>
        <p>{run.kind === 'thematic' ? 'Quatre rôles se passent le travail dans des colis scellés : plan, pierres brutes, pierres contrôlées, mur. Le chercheur peut compléter les rapports par des données de marché (MCP Yahoo Finance).' : 'Analyse antérieure aux étapes fixes du RAG : le chercheur extrayait les passages, le vérificateur les contrôlait.'}</p>
      </div>
    </header>
    {handoffs.some(item => item.from === 'server') && <p className="worksite-order"><Sticker symbol="📋" label="Commande"/>Commande du serveur scellée et vérifiée (n°{handoffs.find(item => item.from === 'server').seq}) : budgets et permissions fixés avant tout travail.</p>}
    <ol className="worksite-crew">{roles.map((role, index) => {
      const task = tasks.get(role), crew = CREW[role], usage = measures?.byAgent?.[role];
      const live = task.status === 'running' && task.startedAt ? Math.max(0, now - Date.parse(task.startedAt)) : NaN;
      const next = roles[index + 1];
      return <li key={role} className={'worker worker-' + role + ' is-' + task.status}>
        <div className="worker-card">
          <div className="worker-stickers">
            <Sticker symbol={crew.sticker} label={crew.trade} className="worker-sticker"/>
            <Sticker symbol={STATE_STICKER[task.status] || '⏳'} label={STATE[task.status] || task.status} className="worker-state-sticker"/>
          </div>
          <h3>{crew.name}<small>{crew.trade}</small></h3>
          <p className="worker-job">{crew.job}</p>
          <p className="worker-state"><strong>{STATE[task.status] || task.status}</strong>
            {Number.isFinite(live) && <> · depuis {formatDuration(Math.floor(live / 1000) * 1000)}</>}
            {Number.isFinite(task.durationMs) && <> · {formatDuration(task.durationMs)}</>}
          </p>
          <dl className="worker-facts">
            {role === 'researcher' && (run.retrievals || []).length > 0 && <div><dt>Consulte</dt><dd>{plural(passages, 'passage', 'passages')} · {plural(documents, 'rapport', 'rapports')}</dd></div>}
            {role === 'researcher' && (run.toolCalls || []).length > 0 && <div><dt>Marché (MCP)</dt><dd>{run.toolCalls.map(call => `📈 ${call.ticker} · ${MARKET_STATUS[call.status] || call.status}${call.cached ? ' (cache)' : ''}`).join(' · ')}</dd></div>}
            {role === 'verifier' && run.status === 'completed' && <div><dt>Valide</dt><dd>{plural(run.verifiedClaimCount || 0, 'affirmation', 'affirmations')}</dd></div>}
            {usage?.calls > 0 && <div><dt>Modèle</dt><dd>{plural(usage.calls, 'appel', 'appels')} · {formatTokens(totalTokens(usage))}</dd></div>}
            {usage?.calls > 0 && !measures.simulated && <div><dt>Coût</dt><dd>{formatUsd(usage.costUsd)}</dd></div>}
            {usage?.calls > 0 && !measures.simulated && <div><dt>Planète</dt><dd>≈ {formatWh(usage.energyWh)} · {formatCo2(usage.co2eG)}</dd></div>}
          </dl>
        </div>
        {next && <Handoff handoff={handoffFrom(role)} waiting={running}/>}
      </li>;
    })}</ol>
    {handoffs.some(item => item.to === 'server') && <p className="worksite-delivery"><Sticker symbol="🏁" label="Livraison"/>Livraison au serveur scellée (n°{handoffs.find(item => item.to === 'server').seq}) : le résultat publié est exactement celui du dernier colis vérifié.</p>}
    {run.security?.length > 0 && <ul className="worksite-barriers" aria-label="Barrières de sécurité déclenchées">{run.security.map((item, index) => <li key={index}>
      <Sticker symbol="🚧" label="Barrière de sécurité"/>
      <span>{reasonLabel(item.kind)}{item.count ? ` · ${item.count}` : ''}{item.signals?.length ? ` (${item.signals.map(signal => signalLabels[signal] || signal).join(', ')})` : ''}</span>
    </li>)}</ul>}
  </section>;
}

// Vue « ce qui a été consulté » : passages réellement récupérés, ouvrables à la bonne page, et données de marché (MCP).
export function ConsultedSources({run, documents = [], onOpenDocument}) {
  const retrievals = run?.retrievals || [], market = run?.toolCalls || [];
  if (!retrievals.length && !market.length) return null;
  const byId = new Map(documents.map(doc => [doc.id, doc]));
  return <section className="consulted-sources" aria-label="Passages consultés">
    <header><Search size={15}/><span className="eyebrow">{run.kind === 'thematic' ? 'CE QUE LES AGENTS ONT CONSULTÉ' : 'CE QUI A ÉTÉ CONSULTÉ'}</span></header>
    {market.length > 0 && <div className="consulted-retrieval consulted-market">
      <p className="consulted-query"><span>Données de marché</span>MCP Yahoo Finance, en lecture seule<small>{market.length} appel{market.length > 1 ? 's' : ''} · tickers du corpus seulement</small></p>
      <ol className="consulted-passages">{market.map((call, index) => <li key={index}>
        <div className="consulted-source"><span className="sticker" role="img" aria-label="Données de marché">📈</span><strong>{call.ticker}</strong><span>{call.mcpTool || call.dataset} · {MARKET_STATUS[call.status] || call.status}{call.cached ? ' (cache 15 min)' : ''}{Number.isFinite(call.durationMs) ? ' · ' + formatMs(call.durationMs) : ''}</span></div>
        {call.passages?.map(passage => <blockquote key={passage.id}>{passage.excerpt}{passage.excerpt.length >= 280 ? '…' : ''}</blockquote>)}
        {call.signals?.length > 0 && <p className="consulted-blocked">🚧 {call.signals.map(signal => signalLabels[signal] || signal).join(', ')}</p>}
      </li>)}</ol>
    </div>}
    {retrievals.map((retrieval, index) => <div className="consulted-retrieval" key={index}>
      <p className="consulted-query"><span>Recherche {index + 1}</span>« {retrieval.query.length > 140 ? retrieval.query.slice(0, 140) + '…' : retrieval.query} »<small>{plural(retrieval.passages.length, 'passage', 'passages')} · {formatMs(retrieval.durationMs)}{retrieval.quarantined ? ` · ${retrieval.quarantined} écarté${retrieval.quarantined > 1 ? 's' : ''}` : ''}</small></p>
      <ol className="consulted-passages">{retrieval.passages.map(passage => {
        const doc = byId.get(passage.documentId);
        return <li key={passage.id}>
          <div className="consulted-source"><BookOpen size={13}/><strong>{doc ? documentTitle(doc) : passage.name}</strong>{passage.page ? <span>p. {passage.page}</span> : null}</div>
          <blockquote>{passage.excerpt}{passage.excerpt.length >= 280 ? '…' : ''}</blockquote>
          {doc && onOpenDocument && <button type="button" className="text-button" onClick={() => onOpenDocument(doc.id, {page: passage.page, quote: passage.excerpt})}><ExternalLink size={12}/>Ouvrir{passage.page ? ` à la page ${passage.page}` : ''}</button>}
        </li>;
      })}</ol>
    </div>)}
  </section>;
}

// Coût réel et empreinte estimée d'une exécution, avec leurs sources.
export function RunFootprint({run, compact = false}) {
  const measures = runMeasures(run);
  if (!measures || !measures.calls) return null;
  if (measures.simulated) return <p className="run-footprint is-simulated"><Leaf size={13}/>Modèle simulé : {plural(measures.calls, 'appel', 'appels')}, aucun coût ni empreinte de modèle.</p>;
  const equivalent = ledEquivalent(measures.energyWh);
  if (compact) return <p className="run-footprint"><Leaf size={13}/><span><strong>{formatUsd(measures.costUsd)}</strong> · {formatTokens(measures.tokens)} · ≈ {formatWh(measures.energyWh)}, {formatCo2(measures.co2eG)}{equivalent ? ` (${equivalent})` : ''}</span></p>;
  return <section className="run-footprint-detail" aria-label="Coût et empreinte de cette analyse">
    <header><Leaf size={15}/><span className="eyebrow">CE QUE CETTE ANALYSE A COÛTÉ</span></header>
    <dl>
      <div><dt>Coût mesuré</dt><dd>{formatUsd(measures.costUsd)}</dd><small>{plural(measures.calls, 'appel', 'appels')} · {formatTokens(measures.inputTokens)} lus, {formatTokens(measures.outputTokens)} produits · tarif {measures.pricing?.model} du {measures.pricing?.checkedAt ? new Date(measures.pricing.checkedAt).toLocaleDateString('fr-FR') : '—'}</small></div>
      <div><dt>Énergie estimée</dt><dd>≈ {formatWh(measures.energyWh)}</dd><small>{equivalent}</small></div>
      <div><dt>Climat estimé</dt><dd>≈ {formatCo2(measures.co2eG)}</dd><small>émissions du centre de données</small></div>
      <div><dt>Eau estimée</dt><dd>≈ {formatWater(measures.waterMl)}</dd><small>refroidissement</small></div>
    </dl>
    <p className="footprint-method">Le coût vient des tokens renvoyés par le fournisseur. L’empreinte est une <strong>estimation</strong> : chaque appel compte pour la médiane publiée par Google (août 2025), hors réseau, appareil et entraînement. Si votre clé est gratuite, rien n’est facturé.</p>
  </section>;
}
