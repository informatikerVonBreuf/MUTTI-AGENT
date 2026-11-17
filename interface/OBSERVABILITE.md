# Observabilité, latence, coût et empreinte

État du **17 novembre 2026**. Ce document décrit ce qui est réellement mesuré, comment, et ce qui reste une estimation.

## Ce que l’application mesure

| Mesure | Source | Où la lire |
| --- | --- | --- |
| Durée de chaque étape d’agent | Événements `running`/`completed` émis par le worker Python | `lastRun.tasks[].durationMs` de chaque conversation |
| Durée totale d’une analyse | Début et fin de l’exécution côté serveur | `lastRun.durationMs`, `/api/metrics` |
| Tokens par appel modèle | `usageMetadata` renvoyé par Gemini (entrée, sortie, raisonnement, cache) | `lastRun.usage.byAgent`, `/api/metrics` |
| Coût par agent et par analyse | Tokens × tarif officiel daté, raisonnement facturé en sortie | idem, en dollars US |
| Empreinte estimée | Nombre d’appels modèle × médiane publiée par Google | idem, en Wh, g CO₂e et mL d’eau |
| Passages consultés | Chaque appel `retrieve_passages` : requête tronquée, documents, pages, court extrait | `lastRun.retrievals` |
| Passages et notes écartés | Filtre d’injection appliqué avant le modèle | `lastRun.quarantined` |
| Latence des API | Durée de chaque requête `/api/*` par route normalisée | `/api/metrics` → `http` |

`GET /api/metrics` (session requise) renvoie les percentiles **p50, p95 et p99** au rang le plus proche : p95 est la durée sous laquelle se terminent 95 % des observations. Les exécutions terminées sont conservées dans `.runtime/metrics/runs.jsonl`, **sans question, passage ni réponse** : identifiants, statuts, durées, tokens, coûts et empreinte. Les latences HTTP couvrent les 5 000 dernières requêtes depuis le démarrage du serveur.

Un appel accepté par le fournisseur est compté même si sa réponse est ensuite refusée par les contrôles : il est facturé.

## Coût

Tarif standard payant de **Gemini 3.8 Flash**, vérifié le 17 novembre 2026 sur la [page officielle des tarifs](https://ai.google.dev/gemini-api/docs/pricing) :

| Période | Entrée / million de tokens | Sortie (raisonnement compris) / million | Entrée en cache / million |
| --- | ---: | ---: | ---: |
| Jusqu’au 31 décembre 2026 | 0,75 $ | 3,75 $ | 0,075 $ |
| À partir du 1er janvier 2027 | 1,50 $ | 7,50 $ | 0,15 $ |

Le tarif appliqué est celui de la date de l’analyse. Un autre modèle n’a pas de tarif connu : le coût est alors affiché comme inconnu (`null`), jamais comme zéro. `FOLIO_PRICE_INPUT_PER_MTOK` et `FOLIO_PRICE_OUTPUT_PER_MTOK` permettent de déclarer un tarif négocié ; la source devient alors « configuration ».

Si la clé utilisée relève de l’offre gratuite, aucun montant n’est facturé : le chiffre affiché est le coût au tarif payant standard, utile pour comparer et budgéter.

## Empreinte pour la planète

Il n’existe pas de mesure publique de l’énergie consommée par **nos** appels. L’application affiche donc une **estimation** fondée sur la [méthode publiée par Google en août 2025](https://cloud.google.com/blog/products/infrastructure/measuring-the-environmental-impact-of-ai-inference) pour le prompt texte médian de Gemini Apps :

- 0,24 Wh d’énergie, 0,03 g CO₂e et 0,26 mL d’eau par appel ;
- périmètre : machines actives et inactives, refroidissement et surcoût du centre de données ;
- exclus : réseau, appareil de l’utilisateur, entraînement du modèle, stockage, ordinateur qui exécute Folio.

Chaque appel modèle compte pour une médiane. Un appel de vérification court ou une longue synthèse peuvent s’en écarter dans les deux sens. Google indique que ces chiffres n’ont pas été vérifiés par un tiers. Les exécutions simulées affichent zéro, avec la mention « simulé ».

## Fournisseur simulé

`FOLIO_PROVIDER=simulated` remplace Gemini par des réponses déterministes : chaque affirmation est un extrait littéral du passage, préfixé « [Simulé] ». Le statut, la barre supérieure et les messages l’indiquent. Coût et empreinte valent zéro. Ce mode sert aux tests de charge et aux démonstrations hors ligne ; il n’est jamais activé par défaut. `FOLIO_SIMULATED_DELAY_MS` (350 ms par défaut) représente la latence d’un appel.

## Traçage LangSmith

Désactivé par défaut. `FOLIO_TRACING=on` et `LANGSMITH_API_KEY` dans le `.env` l’activent ; le projet est `folio-dev` (`FOLIO_LANGSMITH_PROJECT`). LangSmith Cloud est utilisé, l’auto-hébergement exigeant une licence Enterprise.

- **Contenus masqués** : `LANGSMITH_HIDE_INPUTS` et `LANGSMITH_HIDE_OUTPUTS` sont toujours activés. Questions, passages, mémoire et réponses ne partent pas.
- **Envoyé** : arbre d’exécution (graphe LangGraph, rôles, appels modèle, recherches), durées, erreurs, tokens, coût par appel.
- **Tags et métadonnées** : `user:<empreinte>`, `thread:<id>`, `run:<id>`, `role:<planner|researcher|verifier|writer>`, `mode:<chat|thematic>`. L’utilisateur est une empreinte SHA-256 tronquée, jamais l’adresse e-mail.
- Le worker ne reçoit la clé LangSmith que si le traçage est actif, et ne reçoit jamais la clé Gemini : les appels modèle passent par le serveur.

Une indisponibilité de LangSmith ne bloque pas l’analyse ; l’envoi final est borné à 8 secondes.

**Langfuse auto-hébergé** reste une option gratuite possible : sa version 3 demande six services (web, worker, PostgreSQL, ClickHouse, Redis, stockage objet). Elle n’est pas ajoutée à la pile pour ne pas alourdir la démonstration ; elle n’a pas été testée ici.

## LangGraph Studio

`langgraph.json` (racine) expose le graphe de résumé thématique : planificateur → chercheur → vérificateur → rédacteur, avec ses bornes. Studio n’a pas accès au serveur Node : `scripts/folio_studio.py` fournit une recherche lexicale locale sur `data/rag-data/markdown` et un modèle hors ligne déterministe (`FOLIO_STUDIO_MODEL=offline`). `FOLIO_STUDIO_MODEL=gemini` appelle Gemini directement avec `GOOGLE_API_KEY` (facturé).

```powershell
pip install "langgraph-cli[inmem]"
langgraph dev
```

## Tests de charge k6

`interface/load/folio.k6.js`, exécuté par Docker contre une pile dédiée (fournisseur simulé, volume séparé, compte de test jetable) :

```powershell
docker compose -f docker-compose.yml -f docker-compose.load.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.load.yml run --rm k6
docker compose -f docker-compose.yml -f docker-compose.load.yml down
```

- Scénario `api` : 1, puis 5, puis 10 utilisateurs virtuels qui consultent l’atelier, un document, une conversation et les mesures, avec pauses de 1 à 5 secondes.
- Scénario `ai` : une analyse à la fois (règle du serveur), suivie jusqu’à la fin.
- Seuils : API p95 < 1 s et p99 < 2 s, moins de 1 % d’échecs ; analyse simulée complète p95 < 15 s et p99 < 20 s.
- Le résumé est écrit dans `interface/load/results/summary.json` (ignoré par Git).

Ces chiffres mesurent le serveur et le worker avec un modèle simulé. Ils ne mesurent ni la latence de Gemini, ni l’interface, ni la perception d’un utilisateur.

## Résultats mesurés le 17 novembre 2026

Machine : ordinateur portable Windows 11, Docker Desktop (8 processeurs, 7,9 Go), d’autres piles Docker actives en parallèle. Corpus monté depuis Windows.

**Charge k6, fournisseur simulé (350 ms par appel), 2 minutes :**

| Mesure | p50 | p95 | p99 | Échantillons |
| --- | ---: | ---: | ---: | ---: |
| API de lecture (1 → 5 → 10 utilisateurs) | 9 ms | 441 ms | 1 753 ms | 304 |
| Analyse complète simulée (une à la fois) | 3,7 s | 5,6 s | 5,9 s | 17 |

Tous les seuils sont respectés, sans échec HTTP ni analyse refusée. Une première mesure dépassait les seuils (p95 1 031 ms, p99 2 902 ms). Côté serveur, trois causes : le texte complet d’un rapport relu et sérialisé à chaque ouverture, les connexions scrypt qui occupent les fils de travail de Node, et l’index BM25 construit à la première question. Corrections : réponse mise en cache, `ETag`, `UV_THREADPOOL_SIZE=8` et index préchauffé au démarrage. La lecture à froid d’un rapport reste la requête la plus lente (p95 serveur 1,7 s ; p50 20 ms une fois en cache), à cause du disque partagé entre Windows et Docker.

**Deux questions réelles avec Gemini 3.8 Flash dans Docker, traçage activé :**

| Question | Durée | Recherche | Vérification | Tokens entrée / sortie | Coût | Empreinte estimée |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Chiffre d’affaires Meta 2024 | 41,3 s | 27,2 s | 0,6 s | 11 846 / 158 | 0,0095 $ | 0,48 Wh · 0,06 g CO₂e · 0,52 mL |
| Résultat net Apple 2024 | 33,1 s | 22,6 s | 0,9 s | 9 314 / 253 | 0,0079 $ | 0,48 Wh · 0,06 g CO₂e · 0,52 mL |

**Charge k6 après le lot de sécurité (CSRF, validation, audit, middleware LangChain), même machine, 3 minutes :**

| Mesure | p50 | p95 | p99 | Échantillons |
| --- | ---: | ---: | ---: | ---: |
| API de lecture (1 → 5 → 10 utilisateurs) | 6 ms | 55 ms | 114 ms | 289 |
| Analyse complète simulée, avec 15 à 25 s de lecture entre deux questions | 3,2 s | 7,2 s | 8,5 s | 8 |

Tous les seuils sont respectés, sans échec. Le premier passage après l’ajout des contrôles dépassait largement les seuils (analyse p50 21,8 s, API p95 4,2 s). Quatre corrections expliquent l’écart :
- l’agent LangChain et sa pile de middleware sont compilés une fois par processus au lieu d’un graphe par appel (1,9 s → 0,08 s par appel) ;
- un worker de réserve charge LangGraph et LangChain à l’avance (16,3 s → 1,9 s pour une question simulée sur ce poste), chaque analyse gardant son propre processus ;
- le texte des rapports est compressé une fois en gzip à la mise en cache, et nginx compresse les fichiers statiques et le JSON ;
- tous les rapports sont mis en cache au démarrage.

Deux analyses enchaînées sans pause n’ont pas le temps de bénéficier du worker de réserve ; elles paient alors l’import de Python, de quelques secondes à 20 s sur une machine saturée.

Les réponses obtenues (164 501 M$ et 93 736 M$) sont citées et contrôlées. Les deux durées incluent la construction de l’index à froid, corrigée ensuite par le préchauffage. Pour le second run, LangSmith a reçu l’arbre complet : racine, chercheur, recherche, deux appels modèle avec leurs tokens et leur coût, vérificateur. Les entrées et sorties étaient vides. Deux mesures ponctuelles ne constituent pas un benchmark.
