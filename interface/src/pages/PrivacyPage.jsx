import React from 'react';
import {ArrowLeft, Cookie, Database, Send, ShieldCheck} from 'lucide-react';
import {OPTIONAL_STORAGE, preferencesAllowed, savePrivacyChoice} from '../preferences.mjs';

export const COOKIES = [
  {name: 'folio_session', purpose: 'Garde votre session ouverte. Opaque, inaccessible au JavaScript (HttpOnly), envoyé uniquement à ce site (SameSite=Strict).', duration: '8 heures au plus'},
  {name: 'folio_csrf', purpose: 'Protège vos actions contre les requêtes forgées depuis un autre site. Lisible par la page, il ne donne aucun accès à lui seul.', duration: '8 heures'},
  {name: 'folio_oauth_state', purpose: 'Sécurise le retour de la connexion AWS Cognito, seulement si elle est activée.', duration: '10 minutes'},
];

// Page « Confidentialité et cookies » : accessible avant et après connexion.
export default function PrivacyPage({onBack}) {
  const [allowed, setAllowed] = React.useState(() => preferencesAllowed());
  const choose = value => { savePrivacyChoice(value); setAllowed(value); };
  return <div className="page privacy-page">
    {onBack && <button type="button" className="auth-back" onClick={onBack}><ArrowLeft size={14}/>Retour</button>}
    <span className="eyebrow">CONFIDENTIALITÉ / COOKIES</span>
    <h1>Ce que Folio conserve,<br/><em>et ce qu’il transmet.</em></h1>
    <p className="privacy-lead">Folio n’utilise <strong>aucun cookie publicitaire, aucune mesure d’audience et aucun traceur tiers</strong>. Seuls des cookies strictement nécessaires au fonctionnement et à la sécurité sont déposés ; ils ne demandent pas de consentement, mais vous devez savoir ce qu’ils font.</p>

    <section aria-labelledby="privacy-cookies"><h2 id="privacy-cookies"><Cookie size={17}/>Cookies strictement nécessaires</h2>
      <div className="table-scroll" role="region" aria-labelledby="privacy-cookies" tabIndex={0}><table className="privacy-table"><thead><tr><th scope="col">Cookie</th><th scope="col">Rôle</th><th scope="col">Durée</th></tr></thead>
        <tbody>{COOKIES.map(cookie => <tr key={cookie.name}><th scope="row"><code>{cookie.name}</code></th><td>{cookie.purpose}</td><td>{cookie.duration}</td></tr>)}</tbody></table></div>
    </section>

    <section aria-labelledby="privacy-local"><h2 id="privacy-local"><Database size={17}/>Préférences sur cet appareil (facultatives)</h2>
      <p>Ces réglages restent dans votre navigateur ; ils ne sont jamais envoyés au serveur. Vous pouvez les refuser : l’atelier fonctionne de la même façon, sans s’en souvenir.</p>
      <ul className="privacy-list">{OPTIONAL_STORAGE.map(item => <li key={item.key}><code>{item.key}</code> — {item.purpose} ({item.duration})</li>)}</ul>
      <div className="privacy-choice" role="group" aria-label="Préférences locales">
        <button type="button" className={allowed ? 'button-primary' : 'button-secondary'} aria-pressed={allowed} onClick={() => choose(true)}>Mémoriser mes préférences</button>
        <button type="button" className={!allowed ? 'button-primary' : 'button-secondary'} aria-pressed={!allowed} onClick={() => choose(false)}>Ne rien mémoriser</button>
      </div>
    </section>

    <section aria-labelledby="privacy-data"><h2 id="privacy-data"><Send size={17}/>Données traitées</h2>
      <ul className="privacy-list">
        <li><strong>Compte</strong> : adresse e-mail, mot de passe haché (scrypt), code de récupération haché, clé de double authentification si vous l’activez. Stockés sur le serveur de l’atelier, jamais dans le navigateur.</li>
        <li><strong>Conversations et mémoire</strong> : enregistrées sur le serveur de l’atelier jusqu’à leur suppression par vous. Supprimer une conversation retire aussi sa mémoire.</li>
        <li><strong>Analyse par l’IA</strong> : pour une question, seuls la question (courriels, téléphones, IBAN et cartes masqués), les passages retenus et vos points de mémoire admis sont envoyés à <strong>Google Gemini</strong> ; l’historique de la conversation n’est pas transmis. Pour un résumé thématique, s’y ajoutent jusqu’à huit messages récents, avec les adresses e-mail, cartes bancaires et adresses IP masquées.</li>
        <li><strong>Données de marché</strong> : pour un résumé, le serveur peut interroger Yahoo Finance (par MCP) avec les seuls symboles boursiers publics AMZN, AAPL, GOOGL ou META. Aucune question, aucun passage ni aucune donnée personnelle n’y est transmis.</li>
        <li><strong>Traces techniques</strong> : si l’administrateur active LangSmith, seuls la structure des étapes, les durées, les étapes ou rôles, les tokens et des identifiants pseudonymes partent ; questions, passages et réponses sont masqués.</li>
        <li><strong>Journal d’audit</strong> : connexions, analyses et décisions de sécurité, avec une empreinte pseudonyme de l’utilisateur. Ni question, ni passage, ni mot de passe.</li>
        <li><strong>Mesures</strong> : durées, tokens, coût et empreinte estimée de chaque analyse, sans contenu.</li>
      </ul>
    </section>

    <section aria-labelledby="privacy-security"><h2 id="privacy-security"><ShieldCheck size={17}/>Protection de votre compte</h2>
      <p>Vérification « je ne suis pas un robot » sans service tiers, verrouillage progressif après des échecs répétés, double authentification facultative, liste de vos sessions actives et déconnexion à distance. Le propriétaire de l’atelier gère les sous-comptes : il peut les désactiver, mais ne lit pas vos conversations depuis l’interface.</p>
      <p>Pour exercer vos droits (accès, rectification, suppression), adressez-vous au propriétaire de cet atelier. Cette page décrit le fonctionnement du logiciel ; elle ne remplace pas la politique de confidentialité de l’organisation qui l’héberge.</p>
    </section>
  </div>;
}

// Bandeau d'information à la première visite : uniquement des cookies nécessaires, choix pour les préférences locales.
export function PrivacyNotice() {
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    try { setVisible(!window.localStorage.getItem('folio-privacy')); } catch { setVisible(true); }
  }, []);
  if (!visible) return null;
  const close = preferences => { savePrivacyChoice(preferences); setVisible(false); };
  return <aside className="privacy-notice" role="region" aria-label="Cookies et confidentialité">
    <Cookie size={18} aria-hidden="true"/>
    <p><strong>Cookies strictement nécessaires uniquement.</strong> Session et protection contre les requêtes forgées ; aucune publicité, aucune mesure d’audience. Vos préférences d’affichage peuvent être mémorisées sur cet appareil. <a href="#privacy">En savoir plus</a></p>
    <div className="privacy-notice-actions">
      <button type="button" className="button-secondary" onClick={() => close(false)}>Ne rien mémoriser</button>
      <button type="button" className="button-primary" onClick={() => close(true)}>J’ai compris</button>
    </div>
  </aside>;
}
