# Journal des versions

Les versions suivent [SemVer](https://semver.org/lang/fr/) : le premier nombre change
quand la forme des données enregistrées change, ou quand une habitude de travail change.

## 3.2.0 — 2026-09-03

### Créer l'ouvrage manquant depuis le tableau de bord

« Contrôle du dernier métré » listait les postes non reconnus sans permettre d'agir :
il fallait retourner dans le métré, retrouver la ligne, puis cliquer. Chaque alerte de
ce type porte maintenant un bouton **Créer l'ouvrage**, qui ouvre le formulaire prérempli
— recette technique comprise — et rattache le poste à l'enregistrement.

Le bouton n'apparaît que là où créer un ouvrage règle vraiment le problème : une
quantité absente ou une description manquante se corrigent dans le fichier reçu, pas
dans la bibliothèque. Il disparaît dès que le poste est rattaché.

Les alertes portent désormais le numéro du poste qu'elles désignent, et la résolution se
fait par ce numéro, jamais par le rang : les alertes sont enregistrées avec l'état, et
une réanalyse peut les avoir décalées.

## 3.1.1 — 2026-09-03

- Le numéro de version apparaît dans **Paramètres → À propos**, et plus seulement en
  haut à droite : c'est là qu'on vient le chercher.
- « Vérifier les mises à jour » dans le même panneau force la vérification du service
  worker puis recharge, pour les cas où un déploiement vient d'être publié et où
  l'écran affiche encore l'ancienne version.

## 3.1.0 — 2026-09-03

### Recettes techniques pour un poste inconnu

Dernier maillon de la chaîne de rapprochement, après le code communal, l'ouvrage proche
et la famille métier : quand le libellé décrit un ouvrage courant, l'application propose
sa composition typique — matériaux, quantités par unité, rendement, matériel — plutôt
que de laisser un formulaire vide.

Rien n'est enregistré sans accord : la proposition s'affiche en entier, avec la note
technique qui dit ce qu'elle couvre et ce qu'elle ne couvre pas, et le formulaire n'est
prérempli qu'après un « Préremplir le formulaire ». Les valeurs sont annoncées comme
indicatives, et les matériaux créés par une recette le sont sans date de prix — ils
apparaissent donc comme « prix non daté » tant qu'ils ne sont pas confirmés.

Trois recettes d'étanchéité pour commencer : joint de dilatation en toiture, solin et
couvre-mur, joint souple en façade.

### Familles métier à deux niveaux

`classifyFamily` retenait la première règle qui matchait, si bien qu'un mot générique
ajouté à une famille placée tôt dans la liste capturait tout ce qui le contient. Les
règles distinguent maintenant les mots **distinctifs** (un seul métier) des mots de
**contexte**, consultés seulement à défaut. C'est ce qui permet d'ajouter `joint`,
`toiture` et `mastic` à l'étanchéité sans lui donner « Isolation de la toiture plate »
ni « Joints de carrelage ».

### Numéro de version visible sur téléphone

Il était en pied de barre latérale, laquelle devient la barre de navigation du bas sur
téléphone : le numéro y était masqué. Il est désormais en haut à droite, sur les deux
formats.

## 3.0.0 — 2026-09-03

Cette version fait passer l'application d'un outil à un seul métré et un seul devis à un
outil qui **tient un historique** — et qui, surtout, **ne réécrit plus le passé**.

### Le devis remis devient une photographie contractuelle

Une ligne de devis ne conservait que `ouvrageId` et `quantite` : le montant était
recalculé à l'affichage. Augmenter le prix d'un matériau, corriger un rendement ou
changer la marge modifiait donc **rétroactivement un devis déjà remis au client**.

- Chaque ligne recopie désormais son nom, son unité, son prix unitaire de vente et son
  coût direct au moment du chiffrage. Le devis retient son contexte de calcul : coût
  horaire, frais généraux, frais de chantier, imprévus, marge, formule et valeur du
  coefficient K, TVA, date.
- Statut **brouillon** ou **figé** : figé, le devis refuse ajout, modification et
  suppression de ligne.
- Un bandeau annonce l'écart avec la bibliothèque du jour **sans jamais l'appliquer**.
  « Actualiser les prix » ne l'applique qu'en brouillon, sur demande explicite.
- Un métré rouvert depuis l'historique est figé au prix rendu : le classeur réexporté
  reprend exactement les montants remis. « Recalculer aux prix actuels » rebascule
  volontairement sur la bibliothèque du jour.

*Migration : les lignes des devis existants sont figées au prix d'aujourd'hui — seule
valeur disponible — et les devis repassent en brouillon.*

### Plusieurs devis, plusieurs métrés

- **Devis multiples** : numéro de la forme `2026-001` attribué par année, date, liste,
  duplication indépendante. Un nouveau devis n'écrase plus le précédent.
- **Historique des métrés** (IndexedDB) : le fichier reçu et le métré chiffré survivent
  à la fermeture du navigateur. Importer un autre marché n'efface plus le précédent, il
  rejoint la liste « Métrés déjà chiffrés ».
- **Commune obligatoire** avant analyse, et figée pour la durée de celle-ci.

### Codes de métré propres à chaque commune

Un code appris (« 09.04 ») appartient désormais à la commune qui l'a produit. Deux
marchés qui réutilisent le même numéro pour des ouvrages différents ne se contaminent
plus. Un poste laissé en attente par « Créer un ouvrage à partir de ce poste » est
retenu avec son métré : importer un autre marché entre-temps annule le rattachement et
le dit, au lieu de l'appliquer au poste de même rang du nouveau fichier.

### Import de métré : les cas limites du terrain

- CSV **Windows-1252** et fichiers **UTF-16** reconnus. Auparavant « Désignation »
  devenait « D?signation », plus aucun en-tête n'était identifié et le fichier entier
  était refusé.
- La colonne de prix unitaire n'est plus confondue avec une colonne de total ou de
  montant, ni « Prix unitaire » avec une colonne d'unité.
- Une phrase d'introduction (« Description des travaux et quantités présumées ») n'est
  plus prise pour la ligne d'en-têtes.
- Un **en-tête réparti sur deux lignes** est reconstitué, y compris quand les deux
  dernières colonnes s'appellent toutes deux « Prix » sur la ligne haute — cas où les
  prix unitaires partaient dans la colonne des totaux du fichier rendu.
- Feuilles multiples aux en-têtes différents, cellules décalées quand la feuille ne
  commence pas en A1, forfaits (`FF`) qui ne se multiplient plus par une quantité,
  TVA à 0 % conservée, arrondi unique du prix de vente.

### Ergonomie

- Flux métré utilisable sur téléphone : navigation en bas, tableau en cartes, cibles
  tactiles à 44 px, messages visibles sans défilement.
- Décisions structurantes présentées dans un `<dialog>` qui montre ce qui va être
  mémorisé, pas seulement combien.
- Thème clair / sombre / automatique, icône d'écran d'accueil, fonctionnement hors
  connexion.

### Découpage et tests

- Règle appliquée partout : **tout ce qui transforme des données vit dans `core.js`**,
  `app.js` ne garde que ce qui lit ou écrit dans la page.
- **132 tests unitaires** (contre 49 en 2.0) et **2 parcours navigateur** joués sur
  chaque pull request comme avant chaque déploiement.

### Export JSON

Le fichier ne contient plus de métré — il en emportait la moitié : les résultats de
l'analyse, mais pas les lignes du fichier reçu, de quoi relire sans pouvoir réanalyser.
Il porte la mémoire de chiffrage (bibliothèque, réglages, codes par commune, devis,
chantiers) ; le métré et son classeur restent sur l'appareil. Un import ne détruit plus
le métré en cours.

## 2.x — 2026-09-01 / 09-02

- Retour de chantier : relever les heures et les achats réels, comparer au prévu,
  recaler la bibliothèque en pondérant par les quantités.
- Alerte de péremption des prix matériaux, avec « Prix toujours valable ».
- Ouvrages composés de plusieurs fournitures ; ventilation des matériaux groupés du
  catalogue de départ.
- Réglage de la formule du coefficient K (additive ou multiplicative).
- Déploiement sur GitHub Pages, service worker, thème, icônes.

## 1.0 — 2026-09-01

Première version : bibliothèque d'ouvrages et de matériaux, calcul du prix de vente,
devis client, et complétion du métré reçu dans son classeur d'origine.
