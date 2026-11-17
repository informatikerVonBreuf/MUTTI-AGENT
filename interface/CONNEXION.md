# Connexion de Folio

État du **15 novembre 2026**. Le choix actuel est une connexion locale provisoire, avec un raccordement Cognito préparé pour la suite AWS.

## Utiliser le compte local

Ouvrir `http://127.0.0.1:5173/#login`. Au premier démarrage, créer le compte propriétaire : adresse e-mail, mot de passe d’au moins 12 caractères et confirmation. Aucun compte ni mot de passe par défaut n’est fourni.

Après création, conserver le **code de récupération affiché une seule fois** dans son gestionnaire de mots de passe, puis ouvrir l’atelier. Les connexions suivantes utilisent l’adresse et le mot de passe. Le bouton Déconnexion ferme réellement la session côté serveur.

Depuis `#recovery`, saisir l’adresse, le code conservé et un nouveau mot de passe. Le code est remplacé après usage et toutes les anciennes sessions sont révoquées. Le nouveau code doit être conservé à son tour. Aucun faux e-mail de récupération n’est annoncé dans ce mode.

Le raccourci d’aperçu sans compte est retiré du serveur actif. Ouvrir directement `#chat` ne donne pas accès aux données : l’interface demande une connexion et les routes métier refusent les requêtes sans session.

## Stockage et protection

- Un seul propriétaire peut être créé ; l’initialisation est fermée ensuite, y compris en cas de requêtes simultanées.
- Les mots de passe utilisent scrypt avec sel aléatoire (`N=131072`, `r=8`, `p=1`) ; le mot de passe et le code de récupération ne sont pas conservés en clair.
- Le cookie de session est opaque, `HttpOnly`, `SameSite=Strict`, limité à huit heures. Seule son empreinte SHA-256 est conservée côté serveur. La déconnexion retire cette empreinte ; l’expiration est également contrôlée côté serveur.
- Le navigateur ne conserve aucun mot de passe ni jeton dans localStorage ou sessionStorage. Le code de récupération reste en mémoire le temps de son affichage.
- Six échecs de connexion entraînent une limitation de quinze minutes pour l’adresse réseau locale.
- Le serveur vérifie l’origine et refuse les appels intersites. Il écoute sur la boucle locale. Les échanges publics nécessiteront un hébergement HTTPS et la configuration adaptée.
- Depuis le 17 novembre 2026, toute modification authentifiée (et la déconnexion) exige aussi le jeton CSRF lié à la session : cookie `folio_csrf`, lisible par la page, renvoyé en en-tête `X-CSRF-Token`. Un jeton périmé est remplacé et la demande rejouée une fois par l’interface. Les connexions, échecs, récupérations et déconnexions sont inscrits au journal d’audit chaîné, sans adresse ni mot de passe.
- Les routes d’analyse sont limitées en débit par utilisateur, et les corps JSON sont validés strictement (champs inconnus refusés).

Les fichiers sont dans `.runtime/auth/owner.json`, `.runtime/auth/sessions.json` et `.runtime/auth/csrf.key`, ignorés par Git. Les conversations existantes restent à leur emplacement et ne sont ni déplacées ni supprimées. Le coffre AWS reste à raccorder ; les secrets techniques sont actuellement lus dans le fichier privé configuré.

Ce parcours protège un **atelier à propriétaire unique**. Il ne constitue pas un service multi-utilisateur avec espaces et droits distincts. L’isolation est préparée : chaque nouvelle conversation porte son propriétaire, celle d’un autre compte répond « introuvable », et `FOLIO_DOCUMENT_ACL` restreint les entreprises consultables avant la recherche. Il faudra encore des comptes multiples, un stockage par utilisateur et des tests E2E avant d’inviter plusieurs propriétaires indépendants.

## API

| Route | Comportement |
| --- | --- |
| `GET /api/auth/status` | Fournisseur, initialisation nécessaire et méthode de récupération, sans secret |
| `GET /api/auth/session` | Session confirmée ou utilisateur nul |
| `POST /api/auth/setup` | Création du premier propriétaire, code affiché une fois et cookie |
| `POST /api/auth/login` | Vérification du mot de passe et rotation de session |
| `POST /api/auth/reset` | Récupération par code, remplacement du mot de passe et révocation des sessions |
| `POST /api/auth/logout` | Révocation de la session et suppression du cookie |
| `GET /api/auth/redirect` | Début du parcours Cognito si configuré |
| `GET /api/auth/callback` | Retour Cognito, validation puis création de la session locale |

Catalogue, textes, PDF, conversations, mémoire, état IA et lancement des agents exigent une session et renvoient HTTP 401 sans elle. `health`, les métadonnées publiques de connexion et ses parcours restent accessibles pour permettre de se connecter.

## Préparer Cognito sans changer les écrans métier

L’adaptateur est présent mais **aucun pool AWS n’a été créé ni utilisé pour une connexion réelle**. Les tests Cognito emploient des réponses simulées et des clés RSA de test. Quand le compte AWS et le pool seront disponibles, renseigner ces valeurs localement ou dans le gestionnaire de secrets retenu :

```dotenv
FOLIO_AUTH_MODE=cognito
FOLIO_COGNITO_REGION=eu-west-3
FOLIO_COGNITO_USER_POOL_ID=eu-west-3_EXEMPLE
FOLIO_COGNITO_CLIENT_ID=identifiantDuClient
FOLIO_COGNITO_DOMAIN=https://votre-domaine.auth.eu-west-3.amazoncognito.com
FOLIO_COGNITO_REDIRECT_URI=http://localhost:5173/api/auth/callback
FOLIO_COGNITO_OWNER_EMAIL=proprietaire@exemple.fr
# Seulement si le client Cognito possède un secret, à garder côté serveur :
# FOLIO_COGNITO_CLIENT_SECRET=...
```

Configurer côté Cognito le flux **authorization code**, les scopes `openid email`, l’URL de retour exacte ci-dessus et l’URL de déconnexion `http://localhost:5173/`. AWS accepte HTTP pour `localhost` à des fins de test ; utiliser HTTPS pour un déploiement. Le serveur actuel reste limité aux hôtes locaux et aux domaines Cognito gérés des régions commerciales.

Le formulaire affiche alors « Continuer avec AWS ». Mot de passe, MFA et récupération sont gérés sur la page Cognito. Le serveur échange le code avec PKCE S256, vérifie `state` et `nonce`, puis contrôle signature RS256, clés du pool, émetteur, audience, usage ID, dates et e-mail vérifié. Seule l’adresse propriétaire explicitement configurée est admise. Les clés publiques sont rechargées en cas de rotation. Les jetons AWS ne vont pas dans le stockage du navigateur et le refresh token n’est pas conservé.

La session de l’application expire au plus tard avec l’ID token, avec un plafond de huit heures. Une révocation distante Cognito n’est pas interrogée à chaque requête ; la déconnexion locale est immédiate. Une configuration Cognito incomplète garde les API fermées et n’active pas de repli anonyme. `FOLIO_AUTH_MODE=local` conserve le parcours provisoire.

Références : [autorisation et callbacks](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html), [échange du code](https://docs.aws.amazon.com/cognito/latest/developerguide/token-endpoint.html), [vérification des jetons et rotation des clés](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-verifying-a-jwt.html).

## Vérifier

`npm.cmd test`, `npm.cmd run test:ui`, `npm.cmd run build` et `node scripts/check-rag-api.mjs` depuis `interface`. Les comptes des tests sont créés dans des répertoires temporaires isolés. Le contrôle HTTP teste initialisation, connexion, déconnexion, récupération, refus sans session et refus des origines externes. Le rendu React statique vérifie les parcours local et AWS ; il ne remplace pas un test navigateur.

Le [notebook de validation métier](<../13 Validation RAG sur les documents metiers.ipynb>) appelle directement les mêmes services RAG dans un stockage temporaire. Il ne contourne pas l’authentification des API HTTP.
