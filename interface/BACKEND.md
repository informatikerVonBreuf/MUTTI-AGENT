# Backend local — RAG et résumés

État du 13 novembre 2026. Node expose les API, conserve les historiques et contrôle la recherche. Python exécute les traitements ; Gemini produit les affirmations structurées. Aucun service AWS n’est créé.

## Parcours raccordés

**Conversation** : question enregistrée → recherche automatique → affirmations appuyées sur les passages → contrôle des références et de la cohérence → réponse et citations enregistrées.

**Résumé thématique** : planificateur → chercheur sur un à trois axes → vérificateur → assemblage du résumé. `scripts/folio_worker.py` exécute réellement ces quatre nœuds avec LangGraph. Le dernier assemble les affirmations admises sans ajouter de prose libre. Ce module reprend les rôles du projet dans une chaîne bornée ; il ne lance pas les outils génériques des anciens notebooks.

Le journal expose les étapes et leur état, jamais le raisonnement privé. Une interruption après redémarrage exige une relance explicite. Rejouer un message déjà terminé ne déclenche pas un nouvel appel.

## Recherche et références

Les textes Markdown déjà extraits sont indexés localement avec BM25. Entreprise, année et type de rapport servent de filtres. Les comparaisons nommant plusieurs entreprises réservent un passage à chacune lorsqu’il en existe. Aucun choix de PDF n’est nécessaire. « Chat PDF » depuis la bibliothèque restreint volontairement la recherche au rapport ouvert ; « Utiliser tout le corpus » retire cette restriction.

**Qdrant n’est pas utilisé.** Le statut distingue sa joignabilité de son utilisation (`vector.used: false`). L’ancien serveur local n’était pas joignable lors du diagnostic. Les anciennes ressources Qdrant Cloud/AWS restent à retrouver.

Une citation exige un identifiant connu, un extrait exactement présent et la bonne année du document. Un second appel modèle contrôle l’appui de l’affirmation par le texte, les périodes et unités. Ce contrôle peut se tromper ; `truthVerified` reste faux. Une page n’est indiquée que si l’extraction en fournit les séparateurs.

## Configuration privée

Prérequis : Node **22.22+** et Python avec `langgraph`. Le serveur lit `.env` à la racine. Les noms de clé reconnus sont `GOOGLE_API_KEY`, `GEMINI_API_KEY` et l’ancien `GOOGLE_API`. Les variables du processus priment sur le fichier. Modèle par défaut : `gemini-2.5-flash`, réglable via `FOLIO_GEMINI_MODEL` après vérification de compatibilité.

Pour réutiliser un fichier privé sans recopier ses secrets, créer localement `interface/.runtime/backend-settings.json` :

```json
{
  "environmentFile": "C:/chemin/prive/.env",
  "pythonExecutable": "C:/chemin/vers/python.exe"
}
```

`FOLIO_ENV_FILE` et `FOLIO_PYTHON` permettent aussi de choisir ces chemins. Ici, `C:/Python314/python.exe` possède LangGraph ; celui de Miniconda ne l’avait pas. Python 3.14 émet un avertissement de compatibilité Pydantic : prévoir ensuite un environnement compatible avec les versions épinglées, après validation.

`FOLIO_DISABLE_AI=1` désactive le fournisseur pour les tests. `.runtime` et `.env` sont ignorés par Git. Aucun secret ne rejoint le bundle React, les conversations ou le statut public. Le coffre AWS reste à raccorder. Le lancement utilise les certificats du système (`--use-system-ca`) sans désactiver TLS.

## Données et protections

Gemini reçoit la question, les passages, les notes admises et jusqu’à huit messages récents. L’utilisateur doit autoriser ce fournisseur pour ses données. Les historiques sont conservés localement ; leur contexte est néanmoins transmis lors d’une analyse. La journalisation LangSmith est désactivée dans le worker.

Une seule analyse à la fois ; jusqu’à huit passages par recherche, 1 800 caractères chacun et 12 000 au total. Jusqu’à trois recherches pour un résumé, six appels modèle admis au maximum, 35 secondes par appel et 180 secondes par traitement. Les sorties sont bornées. Arrêter coupe le worker et les requêtes en cours ; un appel déjà accepté peut rester facturé.

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
C:/Python314/python.exe -m unittest scripts.test_folio_worker scripts.test_security_boundaries -v
```

Ces tests utilisent un modèle simulé, sans appels facturés. Le pont lance réellement Python/LangGraph. Le rendu React statique ne remplace pas un test navigateur ou utilisateur. Un essai réel du fournisseur et sa latence doivent être validés séparément.

L’authentification demeure non raccordée : usage local uniquement. Cognito, l’autorisation des API, l’isolation des historiques et le coffre de secrets sont à réaliser avant un accès partagé. Aucun commit ni push n’est effectué par l’application.
