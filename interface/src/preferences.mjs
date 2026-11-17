// Préférences locales (non indispensables) : enregistrées sur cet appareil seulement si l'utilisateur l'accepte.
// Les cookies folio_session et folio_csrf sont strictement nécessaires et ne passent pas par ce module.
const CHOICE_KEY = 'folio-privacy';
const OPTIONAL_KEYS = ['folio-motion', 'folio-tour', 'folio-recent-documents'];

function storage() {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}

export function privacyChoice() {
  try { const raw = storage()?.getItem(CHOICE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
// Retenir le choix lui-même est nécessaire pour ne pas redemander à chaque visite.
export function savePrivacyChoice(preferences) {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(CHOICE_KEY, JSON.stringify({acknowledged: true, preferences: preferences ? 'on' : 'off', at: new Date().toISOString()}));
    if (!preferences) for (const key of OPTIONAL_KEYS) store.removeItem(key);
  } catch {}
}
export const preferencesAllowed = () => privacyChoice()?.preferences !== 'off';
export function readPreference(key) {
  if (!preferencesAllowed()) return null;
  try { return storage()?.getItem(key) ?? null; } catch { return null; }
}
export function writePreference(key, value) {
  if (!preferencesAllowed()) return;
  try { storage()?.setItem(key, value); } catch {}
}
export const OPTIONAL_STORAGE = [
  {key: 'folio-motion', purpose: 'Animations 3D en pause ou en marche', duration: 'jusqu’à suppression'},
  {key: 'folio-tour', purpose: 'Visite guidée déjà vue', duration: 'jusqu’à suppression'},
  {key: 'folio-recent-documents', purpose: 'Rapports consultés récemment (identifiants seulement)', duration: 'jusqu’à suppression'},
];
