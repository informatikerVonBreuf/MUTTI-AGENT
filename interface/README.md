# Folio / Archive vivante

Interface React + Vite + Node.js : bibliothèque par entreprise, conversations RAG et résumés thématiques avec suivi des agents Python/LangGraph. Le fond présente un humain d’apparence photographique devant un livre, avec pages automatiquement tournées par un maillage 3D calé sur le livre. Le livre interactif de l’accueil est conservé.

## Lancer

Double-cliquer sur `Lancer-Archive-Vivante.cmd`, garder sa fenêtre ouverte et ouvrir **http://127.0.0.1:5173**.

```powershell
cd interface
npm.cmd ci
npm.cmd run build
npm.cmd start
```

Node 22.22+ est requis. `npm.cmd run dev` active le développement. Le serveur écoute uniquement sur la boucle locale. Les scripts utilisent les certificats du système sans désactiver TLS.

### Avec Docker

Depuis la racine du dépôt : `docker compose up --build`, puis ouvrir **http://localhost:8080** et créer le compte propriétaire du conteneur.

- `frontend` : build Vite servi par nginx non root, avec CSP, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` et HSTS lorsque la connexion est en HTTPS. Seul ce service est publié, et uniquement sur `127.0.0.1`.
- `backend` : serveur Node et worker Python/LangGraph dans le même conteneur, utilisateur non root, dépendances Python figées par empreinte, système de fichiers en lecture seule, `cap_drop: [ALL]`.
- `qdrant` : déclaré pour la suite, sur le réseau interne uniquement ; la recherche reste BM25.
- Le `.env` de la racine est monté comme secret Docker ; il n’est copié dans aucune image. Les conversations vivent dans le volume `runtime`, le corpus est monté en lecture seule.
- `FOLIO_TRACING=on docker compose up` active LangSmith (contenus masqués). Voir [OBSERVABILITE.md](OBSERVABILITE.md) pour les mesures, le coût, l’empreinte et les tests de charge k6.

## Accès et fonctionnalités

La page initiale et `#login` ouvrent la connexion locale. Au premier démarrage, créer le compte propriétaire et conserver le code de récupération affiché une seule fois. Aucun mot de passe par défaut n’est fourni. Les API métier exigent désormais une session ; le raccourci d’aperçu anonyme est retiré.

Déconnexion et récupération par code sont actives. Les mots de passe sont hachés, les sessions utilisent un cookie HttpOnly et les fichiers d’authentification restent dans `.runtime`, ignoré par Git. L’atelier est prévu pour un propriétaire unique. L’adaptateur Cognito est préparé et testé avec des réponses simulées ; son activation réelle et le coffre AWS restent à configurer. Voir [CONNEXION.md](CONNEXION.md).

La bibliothèque regroupe PDF et Markdown de `../data/rag-data` sans modifier les documents originaux. Les espaces sont accessibles par `#home`, `#library`, `#chat` et `#themes`.

Une question lance automatiquement la recherche et la réponse si le fournisseur est configuré. Aucun choix de PDF n’est imposé. « Chat PDF » depuis un rapport ouvre volontairement un échange ciblé ; « Utiliser tout le corpus » retire cette restriction. Les citations contrôlées ouvrent les sources et montrent leurs extraits.

Chaque résumé possède une session indépendante. Ses quatre rôles exécutés sont planification, recherche, vérification et assemblage. Le journal affiche les événements réels et les erreurs. L’utilisateur peut arrêter ou relancer une analyse. Aucun raisonnement privé ni avancement fictif n’est affiché.

La recherche actuelle est **BM25 sur le corpus local**. Qdrant n’est pas utilisé ; ses anciennes ressources restent à retrouver. Gemini 3.8 Flash reçoit questions et extraits lors des analyses autorisées. Le chat et les quatre étapes du résumé ont été validés avec de véritables appels, des citations retrouvées dans les sources et un historique de test isolé. Les mesures ponctuelles étaient d’environ 8 secondes pour la question et 35 secondes pour le résumé. Lire [BACKEND.md](BACKEND.md) pour la configuration privée, les transmissions, les API et les limites.

## Organisation du front

- `src/App.jsx` : coquille (navigation, barre supérieure, messages, état global et appels API) ; `src/api.mjs` et `src/format.mjs` (dates, pluriels, titres de rapports, état du modèle) ; `src/export.mjs` (export Markdown).
- `src/pages/` : accueil, bibliothèque, conversations, résumés thématiques. `src/modals/Dialogs.jsx` : fenêtres de dialogue. `src/components/` : primitives (Markdown, Modal, compteurs), en-têtes de page, garde-fou d’erreur.
- `src/styles/` : `tokens.css` (échelle typographique, gabarit, cibles), puis une feuille par zone (`base`, `modal`, `shell`, `home`, `library`, `chat`, `themes`, `auth`). L’ordre d’import dans `main.jsx` fait partie de la cascade.

Les règles d’adaptation aux écrans sont décrites dans [DIRECTION-VISUELLE.md](DIRECTION-VISUELLE.md).

## Historique et mémoire

Les sessions conservent messages, importance, notes, citations et dernière exécution dans `.runtime/conversations.json`. Supprimer un chat retire aussi sa mémoire et ses liens thématiques. `FOLIO_DATA_DIR` change le dossier de stockage. Les anciennes questions de `missions.json` sont importées une fois sans effacer ce fichier.

La mémoire utilise des règles locales pour repérer objectifs, préférences et décisions. « Retenir » conserve un message ; le panneau Mémoire permet de corriger ou oublier une note. Le contexte est limité à huit notes dans 3 200 caractères et huit messages récents dans 16 000 caractères. La synthèse sémantique de mémoire reste à ajouter.

Ne pas versionner `.runtime`, `.env`, `node_modules` ni les caches. Aucun script ne réalise de stage, commit ou push Git.

## Vérifier

```powershell
npm.cmd test
npm.cmd run test:ui
npm.cmd run build
node scripts/check-rag-api.mjs
$env:FOLIO_TEST_PYTHON='C:/Python314/python.exe'
node scripts/check-agent-bridge.mjs
npm.cmd run test:redteam
npm.cmd run audit:chain
npm.cmd run audit:deps
```

Depuis la racine : `C:/Python314/python.exe -m unittest scripts.test_folio_worker scripts.test_security_boundaries scripts.test_observability scripts.test_agent_security -v`.

La sécurité agent-à-agent (politiques imposées par le serveur, transferts signés, journal d’audit chaîné, middleware LangChain, filtre d’injections à deux niveaux, CSRF, limitation de débit, isolation préparée) et les résultats de la suite d’attaques sont décrits dans [SECURITE-RAG-AGENTS-2026.md](SECURITE-RAG-AGENTS-2026.md).

Ces contrôles déterministes n’appellent pas de fournisseur payant. Le pont lance réellement Python/LangGraph avec un modèle simulé. Le rendu React statique et les requêtes HTTP ne remplacent pas un E2E navigateur ni un test utilisateur. Voir aussi [la note de sécurité](SECURITE-RAG-AGENTS-2026.md).

## Notebook de validation métier

Ouvrir [13 Validation RAG sur les documents metiers.ipynb](<../13 Validation RAG sur les documents metiers.ipynb>). Il réutilise les services de l’application pour les rapports Meta, Google, Apple et Amazon : recherche automatique, périmètre, valeurs attendues, provenance, abstention et contrôles de sécurité. `RUN_LIVE` est désactivé par défaut pour éviter les appels facturés involontaires ; il ajoute le chat Gemini et le résumé à quatre rôles. Les historiques de test sont isolés.

Les cas sont dans `data/rag-validation/business-cases.json` et le lanceur Node dans `interface/scripts/validate-business-rag.mjs`. Les mesures documentaires sont définies dans le notebook ; elles ne sont pas présentées comme des scores de vérité ou une précision sémantique annotée.
