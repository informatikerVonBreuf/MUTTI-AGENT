# Backend local — RAG et résumés

État du 13 novembre 2026. Node expose les API, conserve les historiques et contrôle la recherche. Python exécute les traitements ; Gemini produit les affirmations structurées. Aucun service AWS n’est créé.

## Parcours raccordés

**Conversation** : question enregistrée → recherche automatique → affirmations appuyées sur les passages → contrôle des références et de la cohérence → réponse et citations enregistrées.

**Résumé thématique** : planificateur → chercheur sur un à trois axes → vérificateur → assemblage du résumé. `scripts/folio_worker.py` exécute réellement ces quatre nœuds avec LangGraph. Le dernier sélectionne, par indices, un sous-ensemble des affirmations admises afin de retirer les répétitions. Le serveur assemble ces affirmations sans accepter de nouvelle prose factuelle. Ce module reprend les rôles du projet dans une chaîne bornée ; il ne lance pas les outils génériques des anciens notebooks.

Le journal expose les étapes et leur état, jamais le raisonnement privé. Une interruption après redémarrage exige une relance explicite. Rejouer un message déjà terminé ne déclenche pas un nouvel appel.

## Recherche et références

Les textes Markdown déjà extraits sont indexés localement avec BM25. Entreprise, année et type de rapport servent de filtres. Les comparaisons nommant plusieurs entreprises réservent un passage à chacune lorsqu’il en existe. Aucun choix de PDF n’est nécessaire. « Chat PDF » depuis la bibliothèque restreint volontairement la recherche au rapport ouvert ; « Utiliser tout le corpus » retire cette restriction.

**Qdrant n’est pas utilisé.** Le statut distingue sa joignabilité de son utilisation (`vector.used: false`). L’ancien serveur local n’était pas joignable lors du diagnostic. Les anciennes ressources Qdrant Cloud/AWS restent à retrouver.

Une citation exige un identifiant connu, un extrait exactement présent et la bonne année du document. Si le modèle a seulement modifié les espaces ou retours à la ligne, le worker retrouve la portion originale du document ; chiffres, mots, signes et ponctuation ne sont jamais réécrits. Le contrôle exact côté Node reste obligatoire après cette restitution. Un second appel modèle contrôle l’appui de l’affirmation par le texte, les périodes et unités. Ce contrôle peut se tromper ; `truthVerified` reste faux. Une page n’est indiquée que si l’extraction en fournit les séparateurs.

## Configuration privée

Prérequis : Node **22.22+** et Python avec `langgraph`. Le serveur lit `.env` à la racine. Les noms de clé reconnus sont `GOOGLE_API_KEY`, `GEMINI_API_KEY` et l’ancien `GOOGLE_API`. Les variables du processus priment sur le fichier. Modèle par défaut : `gemini-3.8-flash`, réglable via `FOLIO_GEMINI_MODEL` après vérification de compatibilité.

Pour réutiliser un fichier privé sans recopier ses secrets, créer localement `interface/.runtime/backend-settings.json` :

```json
{
  "environmentFile": "C:/chemin/prive/.env",
  "pythonExecutable": "C:/chemin/vers/python.exe"
}
```

`FOLIO_ENV_FILE` et `FOLIO_PYTHON` permettent aussi de choisir ces chemins. Ici, `C:/Python314/python.exe` possède LangGraph ; celui de Miniconda ne l’avait pas. Python 3.14 émet un avertissement de compatibilité Pydantic : prévoir ensuite un environnement compatible avec les versions épinglées, après validation.

`FOLIO_DISABLE_AI=1` désactive le fournisseur pour les tests. `.runtime` et `.env` sont ignorés par Git. Aucun secret ne rejoint le bundle React, les conversations ou le statut public. Le coffre AWS reste à raccorder. Le lancement utilise les certificats du système (`--use-system-ca`) sans désactiver TLS.

Autres variables : `FOLIO_PROVIDER` (`gemini` ou `simulated`), `FOLIO_TRACING=on` et `FOLIO_LANGSMITH_PROJECT` (traçage LangSmith), `FOLIO_PRICE_INPUT_PER_MTOK` et `FOLIO_PRICE_OUTPUT_PER_MTOK` (tarif négocié), `FOLIO_HOST` et `FOLIO_ALLOWED_HOSTS` (conteneur), `FOLIO_PREWARM=0` (désactive le worker de réserve), `FOLIO_MIDDLEWARE=off` (désactive le middleware LangChain, déconseillé), `FOLIO_DOCUMENT_ACL` (ACL documentaire par compte).

## Données et protections

Gemini reçoit la question, les passages, les notes admises et jusqu’à huit messages récents. L’utilisateur doit autoriser ce fournisseur pour ses données. Les historiques sont conservés localement ; leur contexte est néanmoins transmis lors d’une analyse. LangSmith reste désactivé par défaut ; avec `FOLIO_TRACING=on`, seules la structure, les durées, les rôles et les tokens partent, contenus masqués.

Une seule analyse à la fois ; jusqu’à huit passages par recherche, 1 800 caractères chacun et 12 000 au total. Jusqu’à trois recherches pour un résumé, six appels modèle admis au maximum, 35 secondes par appel et 180 secondes par traitement. Les sorties sont bornées. Gemini 3 utilise `thinkingLevel: low` et un plafond de 4 096 tokens de sortie, raisonnement compris ; l’adaptateur conserve `thinkingBudget: 0` pour une configuration explicite Gemini 2.5. Le contrôle de présence du modèle ne suffit pas à prouver qu’une génération sera acceptée : les erreurs 404 et paramètres refusés sont distinguées, et un échec du fournisseur met son statut à jour. Arrêter coupe le worker et les requêtes en cours ; un appel déjà accepté peut rester facturé.

Passages et mémoires sont traités comme données non fiables. Des règles isolent certaines instructions suspectes ; elles peuvent être contournées. Permissions, budgets et références sont contrôlés côté serveur. Ces défenses ne garantissent pas l’immunité aux injections.

## API et tests

- `GET /api/backend/status` : état du fournisseur et de la recherche, sans secret.
- `POST /api/backend/probe` : vérification des dépendances et du modèle sans génération.
- `POST /api/threads/:id/run`, corps `{ "messageId": "…" }` : analyse asynchrone.
- `GET /api/threads/:id/run` : dernières étapes et état.
- `DELETE /api/threads/:id/run` : arrêt.

L’interface suit les traitements par interrogation périodique. Messages, citations et dernière exécution sont dans `.runtime/conversations.json`. Supprimer un chat retire sa mémoire et ses liens.

```powershell
cd interface
npm.cmd test
npm.cmd run test:ui
npm.cmd run build
node scripts/check-rag-api.mjs
$env:FOLIO_TEST_PYTHON='C:/Python314/python.exe'
node scripts/check-agent-bridge.mjs
# Depuis la racine :
C:/Python314/python.exe -m unittest scripts.test_folio_worker scripts.test_security_boundaries scripts.test_observability -v
```

Ces tests utilisent un modèle simulé, sans appels facturés. Le pont lance réellement Python/LangGraph. Le rendu React statique ne remplace pas un test navigateur ou utilisateur. Les essais réels autorisés ont maintenant été effectués séparément ; leurs résultats sont ci-dessous.

Depuis le 15 novembre 2026, la connexion locale à propriétaire unique protège les API. L’adaptateur Cognito est préparé mais non activé faute de configuration AWS. L’isolation multi-utilisateur et le coffre de secrets restent à réaliser avant un accès partagé. Voir [CONNEXION.md](CONNEXION.md). Aucun commit ni push n’est effectué par l’application.

## Validation réelle — 13 novembre 2026

L’utilisateur a autorisé l’envoi des questions, extraits et contexte à Gemini avec la clé existante. Les vérifications ont utilisé les véritables routes HTTP, le corpus du dépôt MUTTI-AGENT, Python/LangGraph et Gemini 3.8 Flash. Les conversations de validation ont été stockées dans un dossier temporaire isolé, puis supprimées ; les chats de l’utilisateur n’ont pas été modifiés.

Le fichier de configuration pointait vers un ancien `.env` devenu vide. Le pointeur privé utilise maintenant le `.env` existant du dépôt actif, sans recopier les clés. Ce fichier et `.runtime` restent ignorés par Git.

| Parcours | État | Durée observée | Citations | Événements |
| --- | --- | ---: | ---: | ---: |
| Question RAG : revenu annuel Meta 2024 | Terminé | 8,0 s | 1 | 4 |
| Résumé : comparaison Meta / Google 2024 | Terminé | 35,1 s | 2 | 8 |

Chaque citation a été retrouvée textuellement dans le document exposé par l’API et chaque réponse a été retrouvée dans le stockage persistant isolé. Les quatre rôles du résumé ont réellement terminé ; aucun événement n’est simulé. Ces deux mesures ponctuelles ne constituent pas un benchmark ni une garantie de latence. Le rendu navigateur n’a pas été revalidé dans cette étape.

Google refusait la génération Gemini 2.5 Flash pour cette clé bien que sa fiche soit consultable. Le choix actuel est fondé sur la [liste officielle des modèles](https://ai.google.dev/gemini-api/docs/models) et les [paramètres de raisonnement de generateContent](https://ai.google.dev/gemini-api/docs/generate-content/thinking). Le passage à l’API Interactions n’est pas nécessaire au fonctionnement validé ici.

Qdrant reste non utilisé : la recherche est BM25 locale. L’authentification locale protège désormais les API ; Cognito reste non activé. L’isolation multi-utilisateur et le coffre AWS restent à connecter avant un accès partagé. Aucun commit, push ou déploiement public n’a été effectué.

## Observabilité et conteneurs — 17 novembre 2026

- Chaque appel modèle est attribué au rôle qui l’a demandé ; le serveur refuse un rôle sans droit d’appel dans le parcours (par exemple le planificateur dans un chat).
- Tokens réels, coût au tarif daté et empreinte estimée sont conservés par agent dans `lastRun.usage`. Les passages consultés à chaque recherche sont conservés dans `lastRun.retrievals` (références et extrait de 280 caractères). Les passages écartés par le filtre sont comptés dans `lastRun.quarantined`.
- `GET /api/metrics` renvoie p50, p95 et p99 des analyses, des agents et des routes HTTP, plus les totaux de coût et d’empreinte. Le journal `.runtime/metrics/runs.jsonl` ne contient aucun contenu.
- Le worker reçoit un environnement minimal. La clé Gemini ne lui est plus transmise : les appels modèle passent par le serveur. La clé LangSmith ne lui est transmise que si `FOLIO_TRACING=on`.
- `FOLIO_PROVIDER=simulated` fournit des réponses littérales étiquetées pour les tests de charge, sans coût.
- L’index BM25 est préchauffé au démarrage, et le texte des rapports est mis en cache avec un `ETag`.

Détails, méthodes et mesures : [OBSERVABILITE.md](OBSERVABILITE.md). Lancement en conteneurs : [README.md](README.md#avec-docker).

## Validation reproductible et connexion — 15 novembre 2026

Le notebook `13 Validation RAG sur les documents metiers.ipynb` réutilise exactement le catalogue, la recherche, les permissions, le connecteur et le worker de cette application via `interface/scripts/validate-business-rag.mjs`. Six cas métier couvrent les quatre entreprises, une comparaison et une période absente. Les valeurs attendues proviennent des rapports locaux. Le mode live exige un indicateur explicite et n’utilise aucun historique personnel.

Le serveur expose maintenant `sessions-v5` : les routes métier exigent une session réelle, y compris les PDF et les lancements IA. Les vérifications HTTP créent un propriétaire jetable dans un dossier temporaire ; aucun compte de test n’est installé dans l’atelier réel. Le notebook appelle la couche métier par CLI locale, sous l’autorité du compte système qui possède le dépôt, et n’ouvre pas de chemin HTTP anonyme.
