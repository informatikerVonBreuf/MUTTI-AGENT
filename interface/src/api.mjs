// Accès à l’API locale de Folio. Toute erreur devient un message lisible en français.

// Jeton CSRF : déposé par le serveur dans le cookie folio_csrf (lié à la session), renvoyé en en-tête
// sur chaque modification. Un cookie HttpOnly porte la session ; celui-ci ne donne aucun accès seul.
export function csrfToken() {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith('folio_csrf='));
  return match ? match.slice('folio_csrf='.length) : '';
}
export function withCsrf(options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return options;
  const token = csrfToken();
  return token ? {...options, headers: {...(options.headers || {}), 'X-CSRF-Token': token}} : options;
}

export async function api(url, options, retried = false) {
  let response;
  try {
    response = await fetch(url, withCsrf(options));
  } catch {
    throw new Error('Le serveur local ne répond pas. Vérifiez que la fenêtre de Folio est toujours ouverte, puis réessayez.');
  }
  let data = {};
  try {
    data = await response.json();
  } catch {
    if (response.ok) throw new Error('Le serveur a renvoyé une réponse illisible.');
  }
  // Jeton périmé (redémarrage, nouvelle session) : le serveur vient d’en déposer un nouveau, une seule nouvelle tentative.
  if (response.status === 403 && data.code === 'CSRF_INVALID' && !retried) return api(url, options, true);
  if (response.status === 401) window.dispatchEvent(new Event('folio-auth-expired'));
  if (!response.ok) {
    const error = new Error(data.error || `Le serveur a refusé la demande (code ${response.status}).`);
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
}

export const json = (method, data) => ({
  method,
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify(data),
});
