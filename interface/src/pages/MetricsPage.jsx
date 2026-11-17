import React from 'react';
import {Activity, Gauge, Leaf, RefreshCw, Timer} from 'lucide-react';
import {api} from '../api.mjs';
import {PageHeading} from '../components/PageChrome.jsx';
import {plural} from '../format.mjs';
import {CREW} from '../components/AgentWorksite.jsx';
import {formatCo2, formatMs, formatTokens, formatUsd, formatWater, formatWh, ledEquivalent, totalTokens} from '../measures.mjs';

const KINDS = {chat: 'Questions (chat)', thematic: 'Résumés thématiques'};
const STATUS = {completed: 'terminée', failed: 'échec', cancelled: 'arrêtée', interrupted: 'interrompue'};

function Percentiles({summary}) {
  if (!summary?.count) return <span className="metric-empty">aucune mesure</span>;
  return <span className="metric-percentiles"><b>{formatMs(summary.p50)}</b><small>p50</small><b>{formatMs(summary.p95)}</b><small>p95</small><b>{formatMs(summary.p99)}</b><small>p99</small><em>n = {summary.count}</em></span>;
}

// Barre proportionnelle simple : la longueur suit la valeur réelle, le texte la donne exactement.
function Bar({value, max}) {
  const width = max > 0 && Number.isFinite(value) ? Math.max(2, Math.round(value / max * 100)) : 0;
  return <span className="metric-bar" aria-hidden="true"><i style={{inlineSize: width + '%'}}/></span>;
}

export default function MetricsPage() {
  const [state, setState] = React.useState({loading: true, data: null, error: ''});
  const load = React.useCallback(async () => {
    setState(current => ({...current, loading: true, error: ''}));
    try { setState({loading: false, data: await api('/api/metrics'), error: ''}); }
    catch (error) { setState({loading: false, data: null, error: error.message}); }
  }, []);
  React.useEffect(() => { load(); }, [load]);
  const {data, loading, error} = state;
  const runs = data?.runs, totals = runs?.totals;
  const agentMax = runs ? Math.max(...Object.values(runs.agents).map(agent => agent.duration.p95 || 0)) : 0;
  return <div className="page metrics-page">
    <PageHeading number="04" title="Ce que coûte chaque réponse." emphasis="Et ce qu’elle pèse." description="Latences mesurées (p50, p95, p99), coût réel par agent et empreinte estimée de toutes les analyses enregistrées. Aucune valeur n’est simulée : un chiffre absent reste absent."/>
    <div className="metrics-toolbar">
      <button type="button" className="button-secondary" onClick={load} disabled={loading}><RefreshCw size={14}/>{loading ? 'Actualisation…' : 'Actualiser'}</button>
      {data && <span>Mis à jour à {new Date(data.generatedAt).toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit', second: '2-digit'})}{runs.since ? ` · mesures depuis le ${new Date(runs.since).toLocaleDateString('fr-FR')}` : ''}</span>}
    </div>
    {error && <p className="simple-empty" role="alert">{error}</p>}
    {data && !runs.runs && <p className="simple-empty">Aucune analyse terminée pour l’instant. Posez une question ou lancez un résumé : ses durées, son coût et son empreinte apparaîtront ici.</p>}
    {data && <>
      <section className="metrics-cards" aria-label="Totaux">
        <article><Activity size={18}/><h2>{plural(runs.runs, 'analyse', 'analyses')}</h2><p>{runs.byKind.chat.completed + runs.byKind.thematic.completed} terminées · {runs.byKind.chat.failed + runs.byKind.thematic.failed} en échec{runs.simulatedRuns ? ` · ${runs.simulatedRuns} simulées` : ''}</p></article>
        <article><Gauge size={18}/><h2>{formatUsd(totals.costUsd)}</h2><p>{plural(totals.calls, 'appel modèle', 'appels modèle')} · {formatTokens(totalTokens(totals))}</p><small>{data.provider.simulated ? 'Modèle simulé : aucun tarif, aucun coût.' : data.pricing.known ? `Tarif ${data.pricing.model} : ${data.pricing.inputPerMTok.toLocaleString('fr-FR')} $ / ${data.pricing.outputPerMTok.toLocaleString('fr-FR')} $ par million (entrée / sortie), vérifié le ${new Date(data.pricing.checkedAt).toLocaleDateString('fr-FR')}` : `Tarif inconnu pour ${data.pricing.model} : le coût n’est pas calculé.`}</small></article>
        <article className="metrics-planet"><Leaf size={18}/><h2>≈ {formatWh(totals.energyWh)}</h2><p>≈ {formatCo2(totals.co2eG)} · ≈ {formatWater(totals.waterMl)}</p><small>{ledEquivalent(totals.energyWh) || 'Aucun appel réel au modèle.'}</small></article>
      </section>
      <section className="metrics-section" aria-labelledby="metrics-latency">
        <h2 id="metrics-latency"><Timer size={16}/>Durée des analyses complètes</h2>
        <ul className="metrics-rows">{Object.entries(runs.byKind).map(([kind, row]) => <li key={kind}><span>{KINDS[kind]}</span><Percentiles summary={row.duration}/></li>)}</ul>
      </section>
      <section className="metrics-section" aria-labelledby="metrics-agents">
        <h2 id="metrics-agents">Chaque agent : durée, appels, coût, empreinte</h2>
        <ul className="metrics-agents">{Object.entries(runs.agents).map(([role, agent]) => <li key={role}>
          <span className="sticker" role="img" aria-label={CREW[role].trade}>{CREW[role].sticker}</span>
          <strong>{CREW[role].name}</strong>
          <Percentiles summary={agent.duration}/>
          <Bar value={agent.duration.p95} max={agentMax}/>
          <span className="metric-agent-usage">{plural(agent.calls, 'appel', 'appels')} · {formatTokens(totalTokens(agent))} · {formatUsd(agent.costUsd)} · ≈ {formatWh(agent.energyWh)}</span>
        </li>)}</ul>
      </section>
      <section className="metrics-section" aria-labelledby="metrics-http">
        <h2 id="metrics-http">Latence des routes (serveur, {data.http.reduce((sum, row) => sum + row.count, 0).toLocaleString('fr-FR')} requêtes depuis le démarrage)</h2>
        <div className="table-scroll" role="region" aria-labelledby="metrics-http" tabIndex={0}><table className="metrics-table">
          <thead><tr><th scope="col">Route</th><th scope="col">Requêtes</th><th scope="col">p50</th><th scope="col">p95</th><th scope="col">p99</th><th scope="col">Erreurs 5xx</th></tr></thead>
          <tbody>{data.http.slice(0, 12).map(row => <tr key={row.route}><th scope="row"><code>{row.route}</code></th><td>{row.count.toLocaleString('fr-FR')}</td><td>{formatMs(row.p50)}</td><td>{formatMs(row.p95)}</td><td>{formatMs(row.p99)}</td><td>{row.errors}</td></tr>)}</tbody>
        </table></div>
      </section>
      {data.recent.length > 0 && <section className="metrics-section" aria-labelledby="metrics-recent">
        <h2 id="metrics-recent">Dernières analyses</h2>
        <ol className="metrics-recent">{data.recent.slice(0, 10).map(run => <li key={run.runId} className={'status-' + run.status}>
          <time dateTime={run.startedAt}>{new Date(run.startedAt).toLocaleString('fr-FR', {dateStyle: 'short', timeStyle: 'short'})}</time>
          <span>{KINDS[run.kind] || run.kind}</span><span>{STATUS[run.status] || run.status}{run.errorCode ? ` (${run.errorCode})` : ''}</span>
          <span>{formatMs(run.durationMs)}</span><span>{run.simulated ? 'simulée' : formatUsd(run.total?.costUsd)}</span>
        </li>)}</ol>
      </section>}
      <section className="metrics-method">
        <h2>Méthode et limites</h2>
        <ul>
          <li>Percentiles au rang le plus proche : p95 est la durée sous laquelle se terminent 95 % des observations. Ils ne sont fiables qu’avec assez d’échantillons.</li>
          <li>Coût : tokens renvoyés par le fournisseur × <a href={data.pricing.source} target="_blank" rel="noreferrer">tarif officiel</a> à la date de l’analyse (raisonnement facturé en sortie). Une clé gratuite n’est pas facturée.</li>
          <li>Empreinte : <strong>estimation</strong> à partir de la <a href={data.footprint.source} target="_blank" rel="noreferrer">médiane publiée par Google</a> ({data.footprint.energyWh.toLocaleString('fr-FR')} Wh, {data.footprint.co2eG.toLocaleString('fr-FR')} g CO₂e, {data.footprint.waterMl.toLocaleString('fr-FR')} mL par appel). {data.footprint.scope}</li>
          <li>Tests de charge k6 (1 → 5 → 10 utilisateurs, modèle simulé) : voir OBSERVABILITE.md et <code>docker-compose.load.yml</code>.</li>
        </ul>
      </section>
    </>}
  </div>;
}
