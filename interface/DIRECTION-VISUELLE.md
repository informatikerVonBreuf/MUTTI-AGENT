# Archive vivante — objets de lecture

Une seule identité : papier chaud, vert bouteille, oxyde, typographie de lecture et repères numérotés. Aucun sélecteur de propositions graphiques.

## Accueil

Un titre de grande taille, « Le savoir mérite d’être compris », accompagne le livre au premier plan à droite. Couverture, tranche, pages, ombre et feuillets sont construits en CSS 3D. Le livre s’ouvre au premier passage à l’écran, puis peut être refermé et rouvert au clic ou au clavier. Sur mobile, il passe sous le texte et reste accessible.

Trois cartes conduisent à la bibliothèque, au Chat PDF et à une nouvelle session thématique. Les statistiques utilisent le catalogue réel.

## Les espaces

- Bibliothèque : papier minéral, encre pétrole, ocre ; dossiers par entreprise, lecteur PDF et accès direct au chat. Une scène de lecture apparaît discrètement en fond.
- Conversations : papier chaud, vert profond, oxyde ; grand titre, historique et mémoire. Une personne recherche une information dans un livre en arrière-plan.
- Résumés thématiques : papier rosé, prune et rouge sourd ; sessions séparées, points associés et plan de travail des agents. La scène de lecture reprend les teintes de cet espace.

Les scènes de lecture en fond sont discrètes, ignorées par les lecteurs d’écran et ne captent aucun clic. Le bouton « Animations 3D » permet de mettre le lecteur et les pages en pause ; la préférence est locale. `prefers-reduced-motion` désactive la rotation et les mouvements du livre. Le changement de section actualise l’adresse et le titre du navigateur.

## Transparence

Les cartes d’agents exposent la tâche, les permissions et le livrable attendu. Le journal reçoit les événements réels du worker Python. Les citations des réponses contrôlées restent consultables même si le fournisseur devient indisponible. Le panneau de préparation RAG affiche les contrôles effectivement effectués et leurs limites.

## Adaptation aux écrans (révision de novembre 2026)

- **Navigation en trois formes.** Barre latérale à partir de 1 100 px ; rail d’icônes légendées entre 801 et 1 099 px et sur les téléphones en paysage (hauteur ≤ 500 px) ; barre d’onglets en bas d’écran sur téléphone et tablette en portrait. Un point oxyde signale sur l’onglet concerné une analyse réellement en cours.
- **Conversations.** Sur ordinateur et tablette, l’historique et l’échange occupent exactement la hauteur restante sous l’en-tête. Sur téléphone et en paysage, la liste s’affiche d’abord, puis l’échange choisi avec un retour « Toutes les conversations » ; la page défile et la zone de saisie reste collée au bas de l’écran.
- **Fenêtres de dialogue.** Centrées sur grand écran, elles deviennent des panneaux ancrés en bas sur téléphone ; le lecteur de document y occupe tout l’écran et ouvre le texte extrait par défaut, avec un accès « Nouvel onglet » pour le PDF.
- **Lisibilité.** Aucun texte d’interface sous 11 px ; les tailles sont en `rem` et suivent la préférence du navigateur ; lecture des messages à 15–16 px ; champs à 16 px au doigt pour éviter le zoom automatique. Les cibles mesurent 40 px au pointeur et 44 px au doigt. Les couleurs de texte respectent un contraste d’au moins 4,5:1 sur chaque palette.
- **Zones sûres.** Les marges intègrent `env(safe-area-inset-*)` (encoches, barre d’accueil).

## Rien sans voix

Chaque état s’explique avec des données réelles : état du modèle IA dans la barre supérieure et sur l’accueil, compteurs du corpus et de la mémoire, reprise des derniers échanges, dates relatives, étapes d’analyse avec leur durée réelle, passages consultés, sources numérotées avec page, titres de rapports lisibles (« Meta — 10-K 2024 »), filtres par type et par exercice, export Markdown des échanges, confirmation avant d’oublier un point de mémoire, compteur de caractères à l’approche des limites. Aucune progression n’est simulée.

## Scène de lecture

Le lecteur stylisé est remplacé par un humain d’apparence photographique qui consulte un livre ouvert. `public/reader-human.png` est une image générée, servie localement. Une page subdivisée en maillage 3D se courbe autour de la reliure et bascule automatiquement toutes les 6,4 secondes. Le maillage est calé sur les coordonnées du livre dans la photo ; image et page partagent le même cadrage responsive. Il ne s’agit pas d’une vidéo ni d’une personne réellement filmée en train de tourner les pages.

La connexion utilise cette image dans son panneau vert. Les pages intérieures la reprennent discrètement avec leurs palettes. Le texte garde un voile de contraste. Le grand livre interactif de l’accueil est conservé. Le petit moteur WebGL est chargé à la demande lorsque la photo est visible. Le lecteur humain reste photographique ; seul le feuillet est une géométrie animée. Un repli CSS 3D prend le relais si WebGL est indisponible.

Les animations s’arrêtent quand la scène ou l’onglet est masqué, à la demande de l’utilisateur et avec `prefers-reduced-motion`. Le feuillet reste animé sur mobile, sauf préférence de mouvement réduit. La pause s’applique au rendu WebGL comme au repli CSS. Un contrôle visuel sur navigateur et téléphone reste à faire.
