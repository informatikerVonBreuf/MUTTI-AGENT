// Mise en forme honnête des mesures : coût réel au tarif daté, empreinte ESTIMÉE, latences mesurées.

const numberFr = (value, digits = 2) => Number(value).toLocaleString('fr-FR', {maximumFractionDigits: digits});

// Petits montants lisibles : 0,0095 $ plutôt que 0 $ ; jamais de faux zéro pour un coût inconnu.
export function formatUsd(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'coût inconnu';
  if (value === 0) return '0 $';
  if (value < 0.0001) return '< 0,0001 $';
  if (value < 1) return Number(value).toLocaleString('fr-FR', {maximumSignificantDigits: 2}) + ' $';
  return numberFr(value, 2) + ' $';
}
export const formatTokens = value => Number.isFinite(value) ? Math.round(value).toLocaleString('fr-FR') + ' tokens' : '—';
export const formatWh = value => Number.isFinite(value) ? numberFr(value, 2) + ' Wh' : '—';
export const formatCo2 = value => Number.isFinite(value) ? numberFr(value, 3) + ' g CO₂e' : '—';
export const formatWater = value => Number.isFinite(value) ? numberFr(value, 2) + ' mL d’eau' : '—';
export function formatMs(value) {
  if (!Number.isFinite(value)) return '—';
  if (value < 1000) return Math.round(value) + ' ms';
  return numberFr(value / 1000, value < 10000 ? 1 : 0) + ' s';
}

// Équivalence purement arithmétique (aucun facteur externe) : durée d'éclairage d'une ampoule LED de 10 W.
export function ledEquivalent(wh) {
  if (!Number.isFinite(wh) || wh <= 0) return '';
  const seconds = wh / 10 * 3600;
  if (seconds < 90) return `≈ ${Math.round(seconds)} s d’une ampoule LED de 10 W`;
  if (seconds < 5400) return `≈ ${Math.round(seconds / 60)} min d’une ampoule LED de 10 W`;
  return `≈ ${numberFr(seconds / 3600, 1)} h d’une ampoule LED de 10 W`;
}

export function totalTokens(usage) {
  if (!usage) return 0;
  return (usage.inputTokens || 0) + (usage.outputTokens || 0) + (usage.thoughtTokens || 0);
}

// Résumé d'une exécution : ce qui est mesuré (tokens, coût, durée) et ce qui est estimé (empreinte).
export function runMeasures(run) {
  const usage = run?.usage;
  if (!usage) return null;
  const total = usage.total || {};
  return {
    simulated: Boolean(usage.simulated),
    calls: total.calls || 0,
    tokens: totalTokens(total),
    inputTokens: total.inputTokens || 0,
    outputTokens: (total.outputTokens || 0) + (total.thoughtTokens || 0),
    costUsd: total.costUsd,
    energyWh: total.energyWh || 0,
    co2eG: total.co2eG || 0,
    waterMl: total.waterMl || 0,
    modelMs: total.modelMs || 0,
    pricing: usage.pricing,
    footprint: usage.footprint,
    byAgent: usage.byAgent || {},
  };
}
