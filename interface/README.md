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

## Accès et fonctionnalités

La page initiale et `#login` ouvrent le formulaire ; `#recovery` prépare la récupération. **L’authentification AWS n’est pas raccordée.** Aucun compte, cookie de connexion ou e-mail n’est créé. Le client ne transmet pas le mot de passe tant que le service est non configuré.

« Parcourir l’aperçu local » permet d’utiliser bibliothèque et analyses sur localhost. Les API ne sont pas encore isolées par utilisateur. Le raccordement Cognito et le coffre de secrets sont décrits dans [CONNEXION.md](CONNEXION.md).

La bibliothèque regroupe PDF et Markdown de `../data/rag-data` sans modifier les documents originaux. Les espaces sont accessibles par `#home`, `#library`, `#chat` et `#themes`.

Une question lance automatiquement la recherche et la réponse si le fournisseur est configuré. Aucun choix de PDF n’est imposé. « Chat PDF » depuis un rapport ouvre volontairement un échange ciblé ; « Utiliser tout le corpus » retire cette restriction. Les citations contrôlées ouvrent les sources et montrent leurs extraits.

Chaque résumé possède une session indépendante. Ses quatre rôles exécutés sont planification, recherche, vérification et assemblage. Le journal affiche les événements réels et les erreurs. L’utilisateur peut arrêter ou relancer une analyse. Aucun raisonnement privé ni avancement fictif n’est affiché.

La recherche actuelle est **BM25 sur le corpus local**. Qdrant n’est pas utilisé ; ses anciennes ressources restent à retrouver. Gemini reçoit questions et extraits lors des analyses autorisées. Lire [BACKEND.md](BACKEND.md) pour la configuration privée, les transmissions, les API et les limites.

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
```

Depuis la racine : `C:/Python314/python.exe -m unittest scripts.test_folio_worker scripts.test_security_boundaries -v`.

Ces contrôles déterministes n’appellent pas de fournisseur payant. Le pont lance réellement Python/LangGraph avec un modèle simulé. Le rendu React statique et les requêtes HTTP ne remplacent pas un E2E navigateur ni un test utilisateur. Voir aussi [la note de sécurité](SECURITE-RAG-AGENTS-2026.md).
