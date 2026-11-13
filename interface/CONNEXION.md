# Connexion — interface et prochain raccordement

État du 13 novembre 2026. Cette livraison construit l’écran et son contrat ; elle ne met pas en place un fournisseur d’identité.

## Écran disponible

- Page initiale ou `#login` : e-mail, mot de passe, affichage/masquage, erreurs de saisie, indication Verr. Maj et chargement.
- `#recovery` : parcours de récupération et retour vers la connexion.
- Accès sur invitation ; aucune inscription publique ni identité de démonstration inventée.
- Composition papier/vert profond, humain d’apparence photographique devant un livre et feuillet décoratif animé, adaptation mobile, clavier et mouvement réduit. L’image est générée et servie localement ; il ne s’agit pas d’une vidéo. Le mouvement réduit conserve une image fixe.
- L’aperçu local reste disponible sans compte sur localhost. Le bouton « Connexion » permet de revenir au formulaire.

Les identifiants restent uniquement dans l’état temporaire du formulaire. Le client ne les envoie pas lorsque le service est déclaré non configuré. Le mot de passe est effacé après une tentative. Aucun jeton ni mot de passe n’est conservé dans localStorage ou sessionStorage ; seule la préférence d’animation y est enregistrée.

## Contrat côté serveur

| Route | État actuel |
| --- | --- |
| `GET /api/auth/status` | `configured: false`, `apiProtected: false`, `authenticated: false`, mode `local_preview` |
| `GET /api/auth/session` | `authenticated: false`, `user: null` |
| `POST /api/auth/login` | HTTP 503, `AUTH_NOT_CONNECTED` ; aucune session ni cookie créés |
| `POST /api/auth/recovery` | HTTP 503, `AUTH_NOT_CONNECTED` ; aucun e-mail envoyé |

Ces routes ne renvoient pas les identifiants reçus et n’enregistrent pas leur contenu. Le navigateur refuse d’ouvrir le raccourci d’aperçu sur un nom d’hôte public. **Ce contrôle d’interface n’est pas une autorisation serveur.** Les routes documentaires et de conversation restent celles d’un espace personnel local, accessible sur la boucle locale. Elles doivent recevoir authentification et isolation avant tout hébergement partagé.

Ajouter des variables d’environnement ne suffit pas à activer la connexion : l’adaptateur du fournisseur et l’autorisation des API ne sont pas encore implémentés. `configured` ne devra devenir vrai qu’après ce raccordement. Le client préparé attendra une session confirmée par le serveur après la connexion ; il ne fait pas confiance à un simple message de succès du formulaire.

## Prérequis pour raccorder le backend

La préférence confirmée du propriétaire est de rester sur AWS. Le fournisseur envisagé est Amazon Cognito User Pools. L’écran reste indépendant de ce choix et aucun appel à Cognito n’est encore effectué.

1. Retrouver le compte AWS et vérifier région, droits, crédits et budget avant toute création. Relever l’identifiant du user pool et du client applicatif si un pool existe déjà. Ces identifiants de configuration ne remplacent pas une identité IAM autorisée pour les opérations d’administration.
2. Définir le flux supporté par le formulaire personnalisé et l’adaptateur Node. Prévoir les états Cognito utiles : invitation avec changement de mot de passe initial, récupération avec code et MFA si activé. Le formulaire actuel prépare la saisie et la demande de récupération ; il ne gère pas encore ces défis du fournisseur. Les écrans de confirmation seront ajoutés avec le contrat réel du pool.
3. Garder la création de comptes sous contrôle de l’administrateur et configurer les URL autorisées ainsi que l’envoi des messages. Aucun appel de récupération ni invitation n’est effectué dans cette livraison.
4. Ajouter les sessions côté serveur, la protection des API, l’expiration, le rafraîchissement, la déconnexion et la révocation. Vérifier les jetons Cognito auprès du bon émetteur/client et tester les limites réelles d’invalidation.
5. Associer chaque historique, mémoire et session thématique à son propriétaire. Définir les droits sur les PDF et le périmètre de recherche Qdrant avant tout partage. Le choix de la base durable AWS reste ouvert ; une clé utilisateur ne doit jamais provenir librement du corps d’une requête.
6. Utiliser le gestionnaire AWS retenu pour les clés techniques, avec identités IAM limitées et rôles d’exécution lorsque disponibles. Secrets Manager et Parameter Store seront comparés selon fonctions et coût. Aucun mot de passe utilisateur récupérable n’est stocké dans ce vault ; aucune clé AWS privilégiée ne va dans React.
7. Tester deux comptes distincts, les accès directs aux API, les invitations, l’expiration et les échecs du fournisseur avant de publier la démonstration.

Le RAG et les agents disposent désormais d’un raccordement local distinct de l’authentification : question directe, recherche automatique et suivi des étapes. Voir [BACKEND.md](BACKEND.md). Ce branchement n’active ni Cognito, ni isolation entre comptes, ni coffre AWS.

Le projet inspecté ne contient pas de configuration Cognito exploitable ; le propriétaire vérifie actuellement ses options AWS. Ne pas fournir de secret dans une conversation : les valeurs seront configurées localement ou dans le gestionnaire choisi. La création d’un projet cloud et son éventuelle facturation restent des étapes séparées.

Références : [Cognito User Pools](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools.html), [flux d’authentification](https://docs.aws.amazon.com/cognito/latest/developerguide/authentication.html), [Secrets Manager](https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html).

## Vérifications

- Tests unitaires du contrat, des champs et du client : aucun envoi sans service connecté ; aucune session sur la seule foi d’une réponse de connexion ; erreurs fournisseur expurgées ; récupération confirmée avant affichage d’un succès.
- Rendu React statique : présence des champs, masquage initial du mot de passe, parcours de récupération, invitation, aperçu et états indisponibles.
- Contrôle HTTP isolé : état non connecté, refus de connexion et récupération, absence de cookie et de mot de passe reflété, catalogue et préparation RAG toujours utilisables.
- Compilation Vite.

Le rendu statique et les requêtes HTTP ne remplacent pas un E2E dans un navigateur. Une vérification visuelle et des interactions sur téléphone réel restera à effectuer lorsqu’un navigateur de test sera disponible.

Aucun commit, push, déploiement public ou création de compte n’est effectué par ces scripts.
