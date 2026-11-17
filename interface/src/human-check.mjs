// Vérification « je ne suis pas un robot » côté navigateur : preuve de travail SHA-256, sans service tiers.
// Le serveur signe un défi ; le navigateur cherche un nombre dont l'empreinte commence par N bits à zéro.

function leadingZeroBits(bytes) {
  let bits = 0;
  for (const byte of bytes) {
    if (byte === 0) { bits += 8; continue; }
    return bits + Math.clz32(byte) - 24;
  }
  return bits;
}

export async function fetchHumanChallenge(signal) {
  const response = await fetch('/api/auth/challenge', {credentials: 'same-origin', cache: 'no-store', signal});
  if (!response.ok) throw new Error(response.status === 429 ? 'Trop de tentatives : patientez avant de réessayer.' : 'La vérification est indisponible pour le moment.');
  return response.json();
}

// Résout le défi par lots pour garder la page réactive ; onProgress reçoit le nombre d'essais.
export async function solveHumanChallenge({challenge, difficulty}, {signal, onProgress} = {}) {
  const {salt} = JSON.parse(atob(challenge.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
  const encoder = new TextEncoder();
  for (let nonce = 0; ; nonce++) {
    if (signal?.aborted) throw new DOMException('Vérification annulée.', 'AbortError');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(salt + ':' + nonce)));
    if (leadingZeroBits(digest) >= difficulty) return String(nonce);
    if (nonce % 2000 === 0) { onProgress?.(nonce); await new Promise(resolve => setTimeout(resolve, 0)); }
  }
}
