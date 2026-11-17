# Rapport de validation — 17 novembre 2026

Validation de bout en bout des lots 1 à 3 : conteneurs et observabilité, sécurité agent-à-agent et comptes, interface. Elle est complétée par les défauts trouvés au tournage de la vidéo (lot 5). Machine : portable Windows 11, Docker Desktop (8 processeurs, 7,9 Go), avec d’autres piles Docker actives en parallèle, ce qui ralentit les builds et les imports Python. Les chiffres valent pour cette machine et ces jeux de données.

## Synthèse

| Domaine | Résultat |
| --- | --- |
| Tests Node (`npm test`) | 111 / 111 |
| Tests Python (`unittest`, 4 modules) | 48 tests : 47 réussis, 1 ignoré (lien symbolique refusé par Windows) ; 36 / 36 dans le conteneur avec les dépendances figées (avant les tests ajoutés au lot 5) |
| Contrôle HTTP de bout en bout (`check-rag-api.mjs`) | réussi (3 exécutions consécutives) |
| Pont Node ↔ Python réel (`check-agent-bridge.mjs`) | réussi, transferts signés vérifiés dans les deux langages |
| Validation métier hors ligne (6 cas du notebook 13) | 6 / 6, 8 contrôles de sécurité réussis |
| Validation métier avec Gemini 3.8 Flash (3 cas, 4 appels) | 3 / 3 : réponses citées et exactes, abstention correcte |
| Suite red team | 87 attaques : ASR 5,7 % ; 130 cas légitimes : 0,8 % de faux positifs ; 6 / 6 tâches légitimes |
| Charge k6, pile Docker complète (modèle simulé) | API p50 6 ms, p95 29 ms, p99 68 ms ; analyse p50 2,5 s, p95 3,2 s ; 0 % d’échec |
| Parcours navigateur réel (Edge), comptes et protections | 14 / 14 |
| Parcours navigateur réel (Edge), interface : connexion, chat, résumé, export, transparence, mesures, mobile | 19 / 19 |
| Parcours navigateur derrière nginx (CSP réelle), 7 pages | 6 / 6 : aucune violation de la CSP, aucune erreur JavaScript |
| Dépendances | `npm audit` : 0 ; `pip-audit` (worker figé) : 0 après mise à jour |

## Détails

### Validation métier hors ligne (services de l’application, notebook 13)

`validate-business-rag.mjs` en mode `offline` réutilise le catalogue, la recherche, les permissions et les contrôles de l’application, sur un historique temporaire isolé. Le notebook lui-même n’a pas été modifié.

| Cas | Passages | Sources attendues trouvées | Valeurs attendues trouvées | Résultat |
| --- | ---: | ---: | ---: | --- |
| Chiffre d’affaires Meta 2024 | 3 | 100 % | 100 % | réussi |
| Chiffre d’affaires Google 2024 | 3 | 100 % | 100 % | réussi |
| Ventes Apple 2024 | 3 | 100 % | 100 % | réussi |
| Ventes Amazon 2024 | 3 | 100 % | 100 % | réussi |
| Comparaison Meta / Google 2024 | 6 | 100 % | 100 % | réussi |
| Période future (abstention attendue) | 0 | — | — | réussi (aucun passage) |

Contrôles de sécurité du même script, tous réussis :
- instruction documentaire isolée ;
- source inventée, chiffre inventé et année incorrecte rejetés ;
- shell interdit ;
- rédacteur sans droit de recherche ;
- document hors périmètre ;
- mémoire suspecte isolée.

Ce sont des mesures documentaires, pas une précision sémantique annotée.

### Validation métier avec Gemini (mode live)

Avec l’accord du propriétaire, `validate-business-rag.mjs` a été lancé en mode `live` sur trois cas : vrai worker Python, middleware LangChain, transferts signés, Gemini 3.8 Flash, historique temporaire isolé.

| Cas | Réponse | Citations | Durée |
| --- | --- | --- | ---: |
| Chiffre d’affaires Google 2024 | 350 018 millions de dollars | 1, retrouvée mot pour mot dans le rapport | 16,3 s |
| Ventes nettes Apple 2024 | 391 035 millions de dollars | 1, retrouvée mot pour mot | 11,9 s |
| Période future de Meta | abstention (`NO_EVIDENCE`), sans appel au modèle | — | 0,2 s |

Plus tôt dans la journée, deux questions réelles posées dans Docker avec traçage LangSmith avaient donné 164 501 M$ (Meta 2024) et 93 736 M$ (Apple 2024, résultat net). Elles ont coûté 0,0095 $ et 0,0079 $, avec une trace complète dans LangSmith. Au total, 8 appels réels ont servi aux validations, puis 11 au tournage de la vidéo : 19 sur les 20 autorisés.

### Parcours navigateur

Tous ont été exécutés dans Microsoft Edge par Playwright, sur un serveur isolé avec des données temporaires.

1. **Comptes et protections (14/14).**
   - Bandeau cookies, refus d’envoi sans la case anti-robot, preuve de travail résolue dans le navigateur (2,6 à 9,9 s selon la charge de la machine).
   - Création du compte, page « Mon compte », activation de la double authentification, création d’un sous-compte.
   - Second facteur demandé puis accepté.
   - Sous-compte : mot de passe imposé, puis accès limité à l’entreprise autorisée.
   - Page Confidentialité sans compte, aucune erreur JavaScript.
2. **Interface (19/19).**
   - Visite guidée, accueil « 10 secondes », aperçu de la bibliothèque, suggestions issues du corpus.
   - Chantier visible pendant l’analyse, analyse terminée par le vrai worker, indice d’appui, coût et empreinte, colis scellés, passage ouvert et surligné dans le lecteur.
   - Résumé à quatre rôles, vue Audit (chaîne intacte), export Word (5 parties XML valides), page Mesures.
   - Téléphone à 390 px sans débordement horizontal, aucune erreur JavaScript.
3. **Pile Docker derrière nginx (6/6).** En-têtes de sécurité présents, connexion avec vérification anti-robot, sept pages parcourues sans violation de la CSP ni erreur.

Captures avant/après : [docs/captures](docs/captures/README.md).

### Défauts trouvés et corrigés pendant la validation

- **Journal d’audit** : le numéro d’un transfert signé remplaçait le numéro de ligne, et la vue Audit affichait honnêtement « chaîne rompue à la ligne 3 ». Le défaut est corrigé et un test de non-régression a été ajouté.
- **Bibliothèque** : la recherche « Meta 2024 », pourtant donnée en exemple dans le champ, ne trouvait rien, car l’expression était cherchée d’un bloc. La recherche se fait désormais par mots.
- **Mode simulé** : la vérification du modèle chargeait `transformers` (jusqu’à 100 s) et affichait « modèle indisponible ». Le worker ne charge plus jamais cette bibliothèque, et les tests Python passent de 155 s à 12 s.
- **Écran de connexion** : un texte tapé avant la fin du chargement pouvait être effacé au passage en mode « création ». Les champs restent désormais inactifs pendant ce court instant.
- **Vérification anti-robot** : `crypto.subtle` n’existe pas en HTTP hors `localhost`. Une implémentation SHA-256 de secours, contrôlée sur 7 vecteurs, prend le relais.
- **Conversations sur grand écran** : la zone d’échange était trop étroite ; l’en-tête éditorial devient compact quand une conversation est ouverte.

### Défauts trouvés pendant le tournage de la vidéo (lot 5)

La première prise réelle a produit deux abstentions. Elles étaient honnêtes, mais évitables : deux défauts de recherche en étaient la cause.

- **Vocabulaire français → anglais incomplet.** « publicitaire », « ventes nettes », « résultat opérationnel » et « d’exploitation » n’étaient pas traduits. Mesures sur le vrai corpus, sans appel au modèle :

  | Question | Passages pertinents avant | Après |
  | --- | ---: | ---: |
  | « Quelles sont les ventes nettes d’Apple en 2024 ? » | 0 sur 0 | 7 sur 9 |
  | Revenus publicitaires Meta et Google 2024 | 5 sur 9, aucun de Google | 7 sur 9, dont Google |

  `retrieval.test.mjs` fixe chaque traduction : sur des pages-leurres, retirer l’une d’elles fait échouer le test (vérifié une à une). La validation métier hors ligne reste à 6 / 6, avec 8 contrôles de sécurité sur 8. Compromis mesuré : pour les revenus *publicitaires* de Meta « par région », le tableau régional quitte les passages retenus sur deux formulations sur trois. La place va à une copie exacte du tableau publicitaire, présente deux fois dans le rapport. « Chiffre d’affaires de Meta par zone géographique » le retrouve. Deux pistes ont été mesurées sans gain : un vocabulaire régional et l’élimination des tableaux en double. Elles n’ont pas été retenues.
- **Relances sans contexte.** « Et quel est le résultat opérationnel sur la même période ? » était cherché sans entreprise ni année, puis vérifié sans savoir de quelle période il s’agissait. Une relance qui ne nomme pas à la fois une entreprise et une année reçoit désormais ce qui lui manque. Chacune vient de la question précédente la plus récente qui la nomme, et les tickers comptent comme des noms d’entreprise. La recherche et le vérificateur en bénéficient. Sur le vrai corpus, sans appel au modèle :

  | Enchaînement | Avant | Après |
  | --- | --- | --- |
  | Amazon 2024, puis « le résultat opérationnel sur la même période » | tout le corpus, 0 passage *operating income* sur 9 | Amazon 2024, 5 sur 9 |
  | Amazon 2024, puis « Et pour Apple ? » | — | Apple 2024 seul, 8 passages *net sales* sur 9 |
  | Amazon 2024, « Et pour Apple ? », puis « Et le résultat opérationnel ? » | — | Apple 2024, 6 passages *operating income* sur 9 |

  Sept tests couvrent ces cas : changement d’entreprise, chaîne de relances, préambule long, question précédente piégée (elle ne prête que ses noms), borne de 4 000 caractères comptée comme le serveur.
- **Écrans peu hauts (1280 × 720, 1366 × 768).** La zone de messages ne mesurait que 150 px environ, entre l’en-tête de page, celui de la conversation et la saisie. Une conversation ouverte resserre maintenant ses bandeaux et masque visuellement l’en-tête éditorial, qui reste lu par les lecteurs d’écran. La zone atteint 276 px à 1280 × 720. Mesures dans Edge à huit tailles, de 390 × 844 à 1440 × 900 : historique et échange alignés, aucun défilement de page sur ordinateur, saisie au-dessus de la barre d’onglets entre 701 et 800 px de large.

Une revue indépendante de ces corrections a confirmé cinq défauts. Tous sont corrigés et testés :
- tickers non reconnus dans les relances ;
- question précédente tronquée au point de perdre son entreprise ;
- test de recherche qui passait sans la traduction ;
- hauteur fixe du panneau qui glissait sous la barre d’onglets ;
- script de tournage qui prenait un port occupé pour un démarrage réussi.

Après correction, les chapitres concernés ont été retournés. Le résumé publicitaire a abouti en 4 appels : Google 264 590 M$, Meta 160 633 M$. Le résultat d’exploitation d’Amazon a abouti en 2 appels : 68 593 M$, 10-K p. 27. Les deux réponses sont citées mot pour mot. Détails : [demo/SCRIPT-VIDEO.md](demo/SCRIPT-VIDEO.md).

### Limites

- Pas de test sur un vrai téléphone : l’affichage mobile est simulé dans Edge.
- La suite red team utilise un modèle simulé ou supposé compromis ; elle n’évalue pas un attaquant adaptatif contre le vrai modèle.
- Les mesures de charge utilisent un modèle simulé ; la latence de Gemini (12 à 16 s par question) n’en fait pas partie.
- Seuls 3 des 6 cas métier ont été rejoués avec Gemini, pour respecter le budget d’appels.
- La console LangSmith n’a pas été consultée directement ; les traces ont été vérifiées par l’API LangSmith.
- La recherche reste lexicale : une question très éloignée du vocabulaire anglais des rapports peut encore manquer le bon passage, comme le tableau régional de Meta ci-dessus.
- Les corrections des relances ont été vérifiées sur la recherche réelle et par les tests, mais pas rejouées avec Gemini : le budget de 20 appels réels était atteint (19 utilisés).

### Suite red team

Voir [le rapport complet](../scripts/redteam/results/report.md).
- 87 attaques : 5 réussies (ASR 5,7 %) ;
- échecs connus : chinois, arabe, consignes découpées sur plusieurs notes ;
- 130 cas légitimes : 1 faux positif ;
- 0 passage légitime écarté sur 46 lors de vraies recherches ;
- 6 tâches légitimes sur 6 réussies de bout en bout, avec le worker réel et toutes les défenses actives.
