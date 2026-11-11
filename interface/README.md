# Folio / Archive vivante

Interface locale React + Vite + Node.js organisée en trois espaces simples : **Bibliothèque**, **Conversations**, **Résumés thématiques**. L’identité Archive vivante est conservée, avec un petit livre 3D dans la bibliothèque.

## Utiliser l’interface

Double-cliquer sur **`Lancer-Archive-Vivante.cmd`**, laisser sa fenêtre ouverte, puis ouvrir **http://127.0.0.1:5173**.

Depuis le terminal :

```powershell
cd interface
npm.cmd ci
npm.cmd run build
npm.cmd start
```

Node.js 22.12 ou supérieur est requis. `npm.cmd run dev` active le développement. `PORT` change le port. Le serveur écoute sur la boucle locale uniquement.

## Bibliothèque

Les documents sont regroupés dans les dossiers **Meta**, **Google**, **Amazon** et **Apple**, selon le corpus présent. Chaque rapport est proposé en PDF original et en texte lorsqu’ils sont disponibles. Le PDF s’ouvre dans le lecteur du navigateur ; le texte peut être consulté et téléchargé.

Le catalogue réunit `../data/rag-data/markdown` et `../data/rag-data/pdfs`. Les identifiants sont stables ; les chemins internes ne sont pas envoyés au navigateur. Les documents d’origine restent inchangés.

## Conversations

- Chaque chat possède son titre, ses messages, son importance et sa mémoire.
- L’historique est sauvegardé côté serveur et survit aux redémarrages.
- Les chats peuvent être renommés et supprimés depuis l’historique ou leur en-tête.
- Une suppression demande confirmation, efface la conversation et sa mémoire de cet espace, et retire ses liens et ses points des sessions thématiques associées.

**Le backend IA n’est pas connecté.** Les messages sont réellement enregistrés mais aucune réponse IA n’est inventée. Les citations sont désactivées. Le chat affichera des réponses et leurs citations seulement après l’intégration d’un vrai backend.

## Mémoire et importance

La préparation locale de mémoire repère des formulations d’objectif, préférence, décision ou contrainte dans les messages de l’utilisateur. Elle repose sur des règles explicites, pas sur un modèle sémantique.

- **Retenir** permet de conserver manuellement un message.
- **Mémoire** permet de consulter, corriger, ajouter ou oublier des points.
- L’importance peut être réglée sur **Normale**, **Importante** ou **Essentielle**.
- Sans réglage manuel, les points importants aident à déterminer l’importance du chat.
- Les notes retenues manuellement sont protégées lorsque les points automatiques anciens sont renouvelés.

Le contexte prévu pour le futur backend est borné : au plus 8 points uniques de mémoire dans 3 200 caractères et 8 messages récents dans 16 000 caractères. L’historique complet reste conservé. Ce mécanisme prépare la future mémoire intelligente ; il ne prétend pas réaliser une synthèse IA.

## Résumés thématiques

Une **nouvelle session indépendante** est créée pour chaque thème. On peut choisir les conversations à associer. Seuls leurs points retenus sont repris dans la préparation, sans copier leurs historiques dans le nouveau chat.

La session possède ensuite son propre historique et sa propre mémoire. Le résumé automatique demeure en attente du backend IA : aucun résultat fictif n’est généré. Supprimer une session thématique ne supprime pas ses conversations d’origine.

## Sauvegarde

Les sessions et mémoires sont stockées dans `.runtime/conversations.json`. `FOLIO_DATA_DIR` permet d’utiliser un autre dossier de données, notamment pour les tests.

Les questions de l’ancien historique documentaire sont importées une seule fois, sans leurs réponses ou citations. Le fichier précédent `missions.json` est conservé comme archive de l’ancien fonctionnement ; il n’est pas utilisé pour réimporter une conversation supprimée. Les rapports et documents d’origine du projet ne sont pas effacés par la suppression d’un chat.

## API active

| Route | Fonction |
| --- | --- |
| `GET /api/workspace` | Catalogue, entreprises, liste des sessions et état du backend |
| `GET /api/documents/:id` | Métadonnées et texte d’un document |
| `GET /api/documents/:id/pdf` | PDF original ; `?download=1` pour télécharger |
| `POST /api/threads` | Créer une conversation ou une session thématique |
| `GET /api/threads/:id` | Historique et mémoire d’une session |
| `PATCH /api/threads/:id` | Titre, importance, épinglage ou conversations associées |
| `DELETE /api/threads/:id` | Supprimer la session et sa mémoire, nettoyer les liens |
| `POST /api/threads/:id/messages` | Enregistrer un message utilisateur |
| `POST /api/threads/:id/memory` | Retenir un point |
| `PATCH /api/threads/:id/memory/:noteId` | Corriger un point |
| `DELETE /api/threads/:id/memory/:noteId` | Oublier un point |
| `GET /api/threads/:id/context` | Contexte borné destiné à la future intégration IA |

Les anciens modules `workspace.mjs` et `retrieval.mjs` restent conservés comme travail précédent, mais leurs routes de recherche ne sont plus exposées par le serveur actif.

## Vérifier

```powershell
npm.cmd test
npm.cmd run test:ui
npm.cmd run build
```

Les tests portent notamment sur la conservation des messages, la séparation des sessions, la suppression et la mémoire, la migration, la validation et la persistance. Le serveur est destiné à un usage personnel local ; une publication multiutilisateur nécessiterait authentification et isolation des données.

Aucun script ne réalise de commit ou de push Git.
