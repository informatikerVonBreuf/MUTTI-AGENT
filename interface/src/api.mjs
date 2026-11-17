// Accès à l’API locale de Folio. Toute erreur devient un message lisible en français.
export async function api(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new Error('Le serveur local ne répond pas. Vérifiez que la fenêtre de Folio est toujours ouverte, puis réessayez.');
  }
  let data = {};
  try {
    data = await response.json();
  } catch {
    if (response.ok) throw new Error('Le serveur a renvoyé une réponse illisible.');
  }
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
