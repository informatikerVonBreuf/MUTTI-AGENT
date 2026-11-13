# Archive vivante — cadrage de la démonstration

Date : 13 novembre 2026. Statut : proposition de périmètre et de validation, à affiner avec le propriétaire du projet. Ce document ne constitue ni un déploiement ni une implémentation de l’authentification.

## Objectif et contraintes

- Démonstration partageable avec quelques utilisateurs invités.
- Hébergement AWS privilégié par le propriétaire ; vérification des options du compte en cours. Gratuit si possible, sinon très peu coûteux. Les appels aux modèles IA ont un budget distinct.
- React, Vite et Node.js pour l’interface/API ; réutilisation des agents Python existants.
- Une seule identité graphique : Archive vivante, avec accueil et objets de lecture en CSS 3D.
- Tous les commits et pushes restent effectués par le propriétaire.
- La disponibilité permanente des agents dans le cloud n’est pas encore décidée. Le scénario gratuit proposé les fait fonctionner sur l’ordinateur du propriétaire pendant les démonstrations.

## Périmètre fonctionnel proposé

| Espace | Première version |
| --- | --- |
| Connexion | Page cohérente avec Archive vivante, accès sur invitation, connexion/déconnexion, récupération de compte, états d’erreur et expiration de session. |
| Bibliothèque | Dossiers d’entreprise, recherche, filtres année/type, consultation PDF/texte, téléchargement. Corpus préparé par l’administrateur. |
| Questions-réponses | Question directe en langage naturel, recherche RAG automatique dans le corpus autorisé, réponse étayée, ouverture des sources/extraits, abstention si les preuves sont insuffisantes, historique indépendant. |
| Mémoire | Points retenus liés à chaque chat, correction/oubli, importance, suppression avec la conversation. Les suggestions sémantiques sont à raccorder au modèle. |
| Résumés et comparaisons | Nouvelle session par thème ou demande comparative ; les agents recherchent eux-mêmes les documents pertinents, produisent une synthèse sourcée conservée et un export Markdown. Les mémoires de conversations ne sont associées que volontairement. |
| Transparence | Tâches, états réels, outils, références, contrôles, durée et erreurs. Annulation et reprise contrôlée des tâches. Aucun raisonnement privé exposé. |
| Administration | Invitations, révocation d’accès, préparation du corpus, quotas et lecture des erreurs techniques expurgées. |

L’exécution de résumés est limitée à une tâche active au départ. La taille des documents, le nombre de passages, les appels d’outils et la consommation IA sont bornés. Les opérations longues doivent avoir un état durable et ne pas dépendre du maintien d’un onglet ouvert.

## Recherche documentaire automatique — clarification du périmètre

La sélection manuelle de PDF n’est pas une étape obligatoire du parcours principal. La bibliothèque sert à consulter les archives et les sources. Le corpus indexé et les droits d’accès sont définis côté serveur.

### Questions-réponses

L’utilisateur écrit une question. Le RAG recherche automatiquement les passages utiles dans les documents qu’il est autorisé à consulter, puis le modèle répond à partir de ces preuves. Les critères d’entreprise, d’année, de trimestre et de type de rapport proviennent de la question et du contexte pertinent. Les sources utilisées sont montrées avec la réponse, après validation. Une précision est demandée seulement si l’ambiguïté empêche une réponse fiable.

Le parcours simple ne nécessite pas d’exécuter toute l’équipe multi-agents. Les limites de contexte et la protection contre les injections restent applicables. Rechercher dans un corpus ne signifie pas transmettre tous les PDF au modèle.

### Résumés thématiques et comparaisons

L’utilisateur décrit le résultat attendu, par exemple « Comparer les résultats de Meta et Google en 2024 ». L’orchestrateur définit les axes et les recherches ; les chercheurs récupèrent eux-mêmes les preuves via le RAG ; le contrôle des preuves puis l’éditeur préparent le résultat. La séparation du vérificateur reste à raccorder au graphe existant. Le journal indique les sources réellement retenues et les lacunes rencontrées.

Il faut vérifier la couverture de chaque entreprise et l’alignement des périodes, unités et monnaies. Le schéma actuel des filtres Python exprime notamment une entreprise unique ; il faudra effectuer des recherches distinctes ou adapter le contrat pour une comparaison multi-entreprises. La présence d’un outil de recherche automatique ne garantit pas encore la qualité d’une comparaison.

Une restriction volontaire à un document ouvert ou à une période peut rester un raccourci facultatif. Elle ne remplace jamais les droits calculés côté serveur, ne devient pas une condition d’accès au chat et ne doit pas rester activée silencieusement dans une nouvelle session.

### État actuel et changement à réaliser

L’ancien outil Python `hybrid_search` extrait déjà automatiquement des filtres de la question et recherche dans Qdrant. Les instructions de l’orchestrateur prévoient des chercheurs par thème et un éditeur. Ces éléments devront être raccordés à l’interface.

Le prototype Node actuel demande encore une sélection pour préparer son contexte local, et l’interface affiche « Choisir des PDF ». Ce comportement sera adapté : recherche automatique par défaut, sélection explicite facultative. Cette modification du cadrage ne prétend pas avoir déjà changé le serveur, l’interface ou connecté l’IA.

## Connexion et droits

Deux rôles initiaux : administrateur et utilisateur invité. La bibliothèque de démonstration peut être partagée ; conversations, mémoires et sessions thématiques sont privées par défaut. Un lien d’invitation ou l’URL du site ne suffit pas à autoriser l’accès aux données.

La préférence confirmée est AWS. Amazon Cognito User Pools constitue la piste d’authentification à raccorder à l’écran personnalisé. Le flux de connexion, les défis éventuels et la récupération seront arrêtés après vérification du compte AWS et de la configuration du pool. L’inscription publique n’est pas prévue.

À implémenter : vérification de l’identité côté API, politiques d’accès en base, contrôle des fichiers et du périmètre Qdrant, déconnexion, expiration, révocation, limitation des tentatives et messages qui ne révèlent pas l’existence d’un compte. Un administrateur n’obtient pas automatiquement la lecture des chats privés.

La session sera définie explicitement pour l’architecture React/Node. Si Node porte la session, utiliser des cookies Secure, HttpOnly et une politique SameSite adaptée, avec traitement de CSRF et des origines. Les tests devront couvrir l’expiration des jetons et les limites réelles de révocation du fournisseur retenu. Ne pas considérer qu’un JWT déjà émis devient immédiatement invalide après une action de déconnexion sans l’avoir vérifié.

## Mots de passe et vault

Il faut distinguer les informations de connexion des secrets techniques :

| Information | Gestion prévue |
| --- | --- |
| Mot de passe d’un utilisateur | Hachage géré par le fournisseur d’authentification ; aucun stockage réversible dans un vault applicatif. |
| Identité, rôle et droit sur une ressource | Auth et tables applicatives avec autorisation vérifiée côté serveur/base. |
| Clés IA, clé Qdrant, accès techniques à la base | Gestionnaire de secrets, accès restreint au serveur ou au worker qui en a besoin. |
| Sessions | Mécanisme de session documenté, durée et invalidation testées ; jamais dans les journaux ou le contexte IA. |

Pour AWS : évaluer Secrets Manager pour les secrets techniques et Parameter Store SecureString selon les besoins et coûts. L’accès du serveur et du worker doit utiliser des identités IAM limitées, avec rôles d’exécution lorsque l’hébergement le permet. Le premier accès au gestionnaire ne doit pas être résolu en exposant des clés AWS dans le navigateur.

Si un vault central accessible à Node et au worker est retenu, prévoir des identités techniques distinctes et des droits limités par secret. Son choix dépendra de l’hébergement et du coût. Sur AWS, évaluer Secrets Manager ; Parameter Store SecureString est une autre possibilité avec des limites différentes et des coûts KMS potentiels. Aucun serveur HashiCorp Vault supplémentaire n’est requis par le cadrage actuel.

Les secrets sont séparés entre développement, test et démonstration, exclus du dépôt et des bundles React. Les variables Vite publiques ne doivent contenir aucune clé privilégiée. Les clés publiques expressément conçues pour le navigateur restent soumises aux règles d’autorisation en base. Prévoir rotation, révocation, traitement d’une fuite et journalisation sans valeur secrète. Les documents, messages et agents n’ont jamais accès au vault en tant qu’outil.

Références : [Cognito User Pools](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools.html), [Secrets Manager](https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html), [Parameter Store SecureString](https://docs.aws.amazon.com/systems-manager/latest/userguide/what-is-a-parameter.html), [tarifs Secrets Manager](https://aws.amazon.com/secrets-manager/pricing/).

## Latence et charge

Les mesures devront distinguer l’attente avant une tâche et le temps d’exécution. La durée d’un résumé multi-agents ne doit pas être confondue avec celle d’une requête API ordinaire.

Mesures proposées :

- Affichage de la page et de la bibliothèque, ouverture d’un PDF, réactivité des actions, coût des animations 3D sur mobile.
- Connexion, validation de session, lecture et enregistrement d’un chat.
- Calcul de l’embedding de la question, recherche documentaire, génération et vérification.
- Premier token du fournisseur, premier contenu vérifié affiché à l’utilisateur, fin de réponse. Une simple animation d’attente ne compte pas comme une réponse.
- Temps dans la file des résumés, étapes par agent et durée totale.
- Taux d’échec, erreurs de quota, délais dépassés, annulations et coût par opération.

Comparer 1, 5 puis 10 utilisateurs virtuels avec un parcours et des pauses réalistes, un corpus fixe, une taille de question comparable et une limite de concurrence IA. Un utilisateur connecté n’équivaut pas à une requête IA exécutée en permanence.

Mesurer séparément : serveur disponible et serveur redémarrant après mise en veille ; accès ordinateur/mobile ; mémoire/contexte courts et longs ; variations de modèle ou de région lorsqu’elles sont pertinentes. Pour un résumé exécuté sur l’ordinateur du propriétaire, afficher et mesurer explicitement l’indisponibilité du worker.

Présenter médiane (p50), p95, nombre d’échantillons, taux d’erreur et débit. p95 désigne le délai sous lequel se terminent 95 % des observations. Une cible initiale proposée est un p95 inférieur à une seconde pour les petites API hors IA sur serveur déjà démarré ; elle devra être confirmée par les premières mesures. Les objectifs de génération seront fixés à partir d’une base mesurée, sans promettre le même délai pour le chat et le résumé.

Instrumenter avec un identifiant de requête/tâche et des durées par étape. Les journaux ne doivent pas contenir mots de passe, jetons ou contenu intégral des conversations. Les appels réels au fournisseur IA sont limités en nombre et en coût ; le gros de la charge utilise un fournisseur simulé avec un délai représentatif. Ces mesures sont rapportées séparément des appels IA réels.

Outil proposé : [k6 en local](https://grafana.com/oss/k6/) pour les scénarios de charge, avec [seuils de réussite/échec](https://grafana.com/docs/k6/latest/using-k6/thresholds/). [Locust](https://docs.locust.io/en/stable/what-is-locust.html) est une alternative Python avec interface de suivi. Un seul outil de charge sera nécessaire au départ. Aucun test de charge cloud ou appel payant n’est lancé par ce document.

## Stratégie de tests

| Niveau | Contrôles prioritaires | Exécution envisagée |
| --- | --- | --- |
| Unitaires | Règles d’accès, validation des entrées, portée des documents, mémoire, références, contrats d’outils, limites et gestion des erreurs. | Tests Node existants, tests Python existants ; tests de composants React lorsqu’un comportement le justifie. |
| Intégration | Auth/API/base/stockage, création et suppression, persistance, filtres documentaires, file de tâches et agent sans appel extérieur non prévu. | Environnement local ou de test isolé ; API IA simulée dans la majorité des cas. |
| E2E | Connexion, accès refusé, PDF, conversation, reprise d’historique, mémoire, résumé et déconnexion. | [Playwright](https://playwright.dev/docs/intro), comptes de test distincts, données dédiées, ordinateur et mobile. |
| Sécurité | Isolation utilisateur A/B, accès par identifiant deviné, jeton invalide/expiré, fichiers privés, injection documentaire, fuite de secret et outil interdit. | Régressions déterministes puis campagnes adversariales bornées lors du raccordement IA. |
| Charge | Délais, erreurs, quotas, files et annulations à 1/5/10 utilisateurs virtuels. | k6 local, d’abord sans génération réelle puis un petit lot réel contrôlé. |
| Accessibilité | Navigation clavier, focus des modales et du formulaire, libellés, annonces d’erreurs, contraste et mouvement réduit. | Contrôles automatisés ciblés et vérification humaine. |
| Utilisateurs | Compréhension des sources, de la mémoire, des états des agents et de l’attente. | Première série de 3 à 5 personnes, puis corrections et nouvelle observation. |

Les tests E2E sont nécessaires pour les parcours critiques de cette application. Ils ne doivent pas tenter de couvrir chaque détail graphique. L’émulation mobile ne remplace pas une vérification sur un téléphone réel. Stabiliser ou mettre en pause les animations dans les captures de comparaison, tout en vérifiant séparément leur contrôle utilisateur.

Parcours d’acceptation prioritaires :

1. Un visiteur non connecté ne peut consulter ni l’API privée ni les fichiers protégés.
2. Un invité valide entre, un compte révoqué ou une session expirée est traité conformément à la politique retenue.
3. L’utilisateur A ne peut lire, modifier ou supprimer les chats et mémoires de B, y compris en appelant directement l’API.
4. Une recherche automatique reste limitée au corpus autorisé pour l’utilisateur, sans accès à un document privé d’un autre compte.
5. Un message et ses points retenus restent présents après rechargement et reconnexion.
6. Supprimer un chat retire sa mémoire et ses liens thématiques selon le comportement annoncé.
7. Une réponse sans preuve suffisante s’abstient ; une fausse référence n’est pas publiée comme citation valide.
8. Un résumé présente uniquement des événements réels, peut être arrêté et ne se duplique pas après une nouvelle tentative.
9. Un worker indisponible, un fournisseur en erreur ou un quota dépassé produit un état explicite, sans faux résultat.
10. Aucun secret privilégié n’apparaît dans le JavaScript distribué, les erreurs, les journaux ou les réponses IA.
11. Une comparaison Meta/Google recherche des éléments pour les deux entreprises sur des périodes comparables ; une source ou une période manquante est signalée.
12. Une question est traitable sans choisir de document au préalable ; le mode automatique ne dépend pas d’une sélection manuelle persistée.

Les tests existants couvrent déjà une partie du stockage local, de la mémoire, du périmètre documentaire et des régressions de sécurité. Ils ne constituent pas encore des tests d’une authentification, d’une base distante ou d’un système génératif connecté. Le rendu React statique existant n’est pas un E2E navigateur.

## Utilisateurs simulés et tests humains

Trois usages distincts doivent rester identifiables dans les rapports :

- k6/Locust simulent une charge et des requêtes. Ils ne prouvent pas que l’interface est compréhensible.
- Playwright exécute des parcours programmés dans un navigateur. Il vérifie un comportement attendu, sans représenter la perception d’un utilisateur humain.
- Les personas IA peuvent explorer des hypothèses et des parcours. Leur retour est une simulation, à confronter à des observations humaines.

Plateformes à examiner, sans abonnement engagé : [Synthetic Users](https://www.syntheticusers.com/) pour des études avec répondants synthétiques ; [Finch de Seldon, anciennement Blok](https://www.seldon.com/products/finch) pour des parcours simulés sur des interfaces ; [Maze](https://maze.co/features/live-website-testing/) pour organiser des tests de site avec de vrais participants. Les capacités sont celles annoncées par les fournisseurs ; aucun résultat de ces outils n’a été validé sur Archive vivante. Les prix, modalités d’accès et conditions de données devront être vérifiés avant utilisation.

Pour notre budget, commencer avec quelques personnes invitées et une grille commune : trouver un rapport de Meta, poser une question, retrouver la source, retenir puis oublier une information, préparer un thème et expliquer l’état d’un agent. Observer réussite sans aide, temps, erreurs, hésitations et compréhension. Cette première série sert à repérer des problèmes ; elle ne fournit pas une estimation statistique de toute la population.

N’utiliser dans les services de recherche externes que des comptes et données de démonstration. Les comptes réels et historiques privés ne font pas partie du jeu de test. Toute capture ou tout enregistrement de participant est annoncé et recueilli avec son accord.

## Hébergement et données : décision encore ouverte

Le propriétaire souhaite rester sur AWS et vérifie les options de son compte. Prévoir Cognito pour les comptes, S3 pour les fichiers et un gestionnaire de secrets AWS. L’hébergement Node/Python, le stockage durable des conversations et l’emplacement de Qdrant restent à décider selon les crédits, le budget, les droits disponibles et les mesures de ressources. Aucun niveau gratuit ni crédit ne doit être supposé acquis. Un worker local pendant les démonstrations reste une possibilité de réduction du coût, sans disponibilité permanente.

Une ancienne URL Qdrant Cloud en région AWS us-west-1 a été retrouvée dans le notebook d’ingestion. Elle ne démontre ni l’existence actuelle du cluster ni l’hébergement précédent du site. Les accès AWS/Qdrant sont à retrouver. Aucun nouveau service ne doit être créé en supposant disponibles les anciennes données ou des crédits gratuits.

## Ordre de réalisation proposé

1. Arrêter le parcours de connexion, les droits, l’emplacement des secrets et les critères d’acceptation.
2. Préparer des comptes/données de test et la migration des historiques locaux.
3. Raccorder authentification et stockage durable, avec tests unitaires et d’intégration.
4. Ajouter les E2E des parcours critiques et les contrôles d’isolation.
5. Connecter le chat PDF puis les résumés et événements réels des agents.
6. Mesurer latence/coût, effectuer la petite étude utilisateur et corriger les blocages.
7. Partager la démonstration limitée ; le propriétaire conserve les commandes de commit, push et déploiement.

Pour automatiser les vérifications, une CI peut être prévue après les pushes du propriétaire. Les tests rapides précèdent les E2E ; les appels IA réels restent dans un lot séparé à quota explicite. Aucun déploiement automatique n’est autorisé par ce cadrage.

