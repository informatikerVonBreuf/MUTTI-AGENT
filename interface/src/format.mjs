// Libellés, pluriels, dates et titres partagés par toute l’interface.
// Ces fonctions ne lisent que des données réelles : elles ne fabriquent aucune valeur.

export const pageLabels = {home: 'Accueil', library: 'Bibliothèque', chat: 'Conversations', themes: 'Résumés thématiques'};
export const noteLabels = {objectif: 'Objectif', preference: 'Préférence', decision: 'Décision', contrainte: 'Contrainte', retenu: 'Point retenu'};
export const agentLabels = {planner: 'Planification', researcher: 'Recherche documentaire', verifier: 'Vérification des références', writer: 'Rédaction'};
export const toolLabels = {delegate_task: 'Répartir une tâche', retrieve_passages: 'Rechercher dans le corpus autorisé', inspect_evidence: 'Inspecter les références', compose_summary: 'Composer un résumé'};
export const runStatusLabels = {running: 'Analyse en cours', completed: 'Analyse terminée', failed: 'Échec de l’analyse', cancelled: 'Analyse arrêtée', interrupted: 'Analyse interrompue'};

const COMPANIES = {meta: 'Meta', google: 'Google', amazon: 'Amazon', apple: 'Apple'};
export const companyLabel = name => COMPANIES[name] || (name ? name.charAt(0).toUpperCase() + name.slice(1) : '');

const number = value => Number(value || 0).toLocaleString('fr-FR');
// En français, 0 et 1 s’accordent au singulier.
export const plural = (count, one, many = one + 's') => `${number(count)} ${Math.abs(count) >= 2 ? many : one}`;
export const listFormat = items => {
  try { return new Intl.ListFormat('fr', {style: 'long', type: 'conjunction'}).format(items); } catch { return items.join(', '); }
};

// « amazon 10-q q1 2025 » → Amazon, 10-Q, T1 2025.
export function documentParts(doc) {
  const name = doc?.name || '';
  const typeMatch = name.match(/\b(10-k|10-q|8-k)\b/i);
  const type = doc?.type || (typeMatch ? typeMatch[1].toUpperCase() : '');
  const quarter = name.match(/\bq([1-4])\b/i)?.[1] || '';
  const year = doc?.year || name.match(/\b(20\d{2})\b/)?.[1] || '';
  const company = companyLabel(doc?.company || '');
  const kind = type === '10-K' ? 'Rapport annuel' : type === '10-Q' ? 'Rapport trimestriel' : type === '8-K' ? 'Rapport courant' : 'Document';
  return {company, type, quarter, year, period: [quarter && 'T' + quarter, year].filter(Boolean).join(' '), kind, recognised: Boolean(typeMatch)};
}
export function documentTitle(doc) {
  const parts = documentParts(doc);
  if (!parts.recognised || !parts.company) return doc?.name || 'Document';
  return `${parts.company} — ${parts.type}${parts.period ? ' ' + parts.period : ''}`;
}
// Titre court à l’intérieur d’un dossier d’entreprise : « 10-Q · T1 2025 ».
export function documentShortTitle(doc) {
  const parts = documentParts(doc);
  if (!parts.recognised) return doc?.name || 'Document';
  return `${parts.type}${parts.period ? ' · ' + parts.period : ''}`;
}

const DAY = 86400000;
const time = date => date.toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit'});
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export function formatRelative(value, now = Date.now()) {
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp)) return '';
  const date = new Date(stamp), today = new Date(now), diff = now - stamp;
  if (diff >= 0 && diff < 60000) return 'à l’instant';
  if (diff >= 0 && diff < 3600000) return `il y a ${Math.floor(diff / 60000)} min`;
  if (sameDay(date, today)) return `aujourd’hui à ${time(date)}`;
  if (sameDay(date, new Date(now - DAY))) return `hier à ${time(date)}`;
  if (diff > 0 && diff < 6 * DAY) return `${date.toLocaleDateString('fr-FR', {weekday: 'long'})} à ${time(date)}`;
  return date.toLocaleDateString('fr-FR', {day: 'numeric', month: 'short', ...(date.getFullYear() !== today.getFullYear() ? {year: 'numeric'} : {})});
}
export function formatMessageTime(value, now = Date.now()) {
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp)) return '';
  const date = new Date(stamp), today = new Date(now);
  if (sameDay(date, today)) return time(date);
  if (sameDay(date, new Date(now - DAY))) return 'hier, ' + time(date);
  return date.toLocaleDateString('fr-FR', {day: 'numeric', month: 'short', ...(date.getFullYear() !== today.getFullYear() ? {year: 'numeric'} : {})}) + ', ' + time(date);
}
export function formatFullDate(value) {
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) ? new Date(stamp).toLocaleString('fr-FR', {dateStyle: 'full', timeStyle: 'short'}) : '';
}
// Regroupe un historique trié par date décroissante.
export function recencyGroup(value, now = Date.now()) {
  const stamp = Date.parse(value), today = new Date(now);
  if (!Number.isFinite(stamp)) return 'Plus anciennes';
  const date = new Date(stamp);
  if (sameDay(date, today)) return 'Aujourd’hui';
  if (sameDay(date, new Date(now - DAY))) return 'Hier';
  if (now - stamp < 7 * DAY) return 'Cette semaine';
  if (now - stamp < 31 * DAY) return 'Ce mois-ci';
  return 'Plus anciennes';
}
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 60000) return (ms / 1000).toLocaleString('fr-FR', {maximumFractionDigits: 1}) + ' s';
  const minutes = Math.floor(ms / 60000), seconds = Math.round((ms % 60000) / 1000);
  return `${minutes} min ${String(seconds).padStart(2, '0')} s`;
}

// État du modèle IA, tel que renvoyé par /api/workspace (backend).
export function backendState(backend = {}) {
  if (backend.connected && backend.simulated) return 'simulated';
  if (backend.connected) return 'ready';
  if (backend.state === 'checking') return 'checking';
  if (backend.state === 'disabled') return 'disabled';
  if (backend.state === 'missing_configuration' || backend.configured === false) return 'missing';
  return 'unavailable';
}
export const backendShortLabels = {ready: 'Modèle IA prêt', simulated: 'Modèle simulé', checking: 'Vérification…', disabled: 'IA désactivée', missing: 'Clé IA absente', unavailable: 'Modèle indisponible'};
export function backendSentence(backend = {}) {
  switch (backendState(backend)) {
    case 'simulated': return 'Mode simulé : les réponses sont des extraits littéraux étiquetés « [Simulé] », sans appel à un modèle ni coût. Ce mode sert aux tests de charge et aux démonstrations hors ligne.';
    case 'ready': return `Le modèle IA est prêt${backend.model ? ` (${backend.model})` : ''} : vos questions et vos résumés peuvent être lancés.`;
    case 'checking': return 'Vérification de la disponibilité du modèle IA…';
    case 'disabled': return 'Les appels au modèle IA sont désactivés pour cette session. Bibliothèque, historique et mémoire restent disponibles.';
    case 'missing': return 'La clé du modèle IA n’est pas configurée : vous pouvez consulter la bibliothèque et l’historique, mais pas lancer d’analyse.';
    default: return (backend.error?.message ? backend.error.message + ' ' : 'Le modèle IA est injoignable pour le moment. ') + 'Vos messages restent enregistrés.';
  }
}

export const slug = value => String(value || 'folio').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'folio';
