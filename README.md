# Générateur de devis

Application de chiffrage pour entreprises du bâtiment. Elle mémorise la façon dont
l'entreprise travaille — coût horaire, rendements, prix des matériaux, frais et marge —
et s'en sert pour calculer des prix de vente cohérents, produire un devis client ou
compléter le métré d'un marché public.

Tout fonctionne dans le navigateur, sans serveur ni compte. Les données restent dans
le `localStorage` du poste.

## Démarrer

**En ligne :** https://pmeyssonnier.github.io/Devis-generator-app/ — utilisable depuis
n'importe quel appareil, y compris un téléphone. Sur mobile, « Ajouter à l'écran
d'accueil » installe une icône propre à l'application, qui s'ouvre en plein écran sans
la barre d'adresse. Après une première visite en ligne, l'application reste utilisable
sans connexion (`sw.js`) — sauf l'import/export Excel, qui dépend d'un CDN externe ; le
CSV et le JSON restent disponibles sans réseau. Les données restent propres à chaque
appareil et à chaque navigateur (`localStorage`) : rien n'est synchronisé entre eux.

**En local :** ouvrir `index.html` dans un navigateur récent.

Le premier lancement installe un catalogue de départ : 51 ouvrages et 61 matériaux
couvrant les lots courants de rénovation, avec les codifications de métré déjà
rencontrées. Ce catalogue n'est installé qu'une fois : les ouvrages supprimés ne
reviennent pas au rechargement.

L'import et l'export Excel s'appuient sur [SheetJS](https://sheetjs.com/), chargé
depuis un CDN. Sans connexion, l'import CSV et les exports CSV/JSON restent
disponibles.

## Comment le prix est construit

```text
Main-d'œuvre     heures/unité × coût horaire
+ Matériaux      somme des fournitures : quantité/unité × prix du matériau
+ Matériel       forfait par unité
= Coût direct
× K              additive (par défaut) ou multiplicative, voir ci-dessous
= Prix de vente
```

Un ouvrage combine autant de fournitures que nécessaire — isolant, enduit, accessoires —
chacune avec sa quantité par unité d'ouvrage. Le formulaire affiche le coût matière au
fur et à mesure de la saisie.

Le coefficient K se calcule de deux façons, réglables dans **Paramètres → Calcul** :

- **Additive** (par défaut) : `K = 1 + (frais généraux + frais de chantier + imprévus +
  marge) / 100`. Chaque taux s'applique sur le seul coût direct.
- **Multiplicative** : `K = (1 + frais généraux/100) × (1 + frais de chantier/100) ×
  (1 + imprévus/100) × (1 + marge/100)`. Chaque taux s'applique sur la base déjà majorée
  par les précédents — K légèrement plus élevé à taux identiques, et l'écart grandit
  avec la somme des taux.

Changer la formule change le prix de vente de tous les ouvrages sans toucher aux taux :
à garder en tête si des taux ont été calibrés en pensant à l'une des deux formules.

Chaque ouvrage affiche sa décomposition (« Justifier ce prix ») : une ligne par
fourniture, avec sa quantité et son prix. C'est ce qui permet de contrôler un calcul et
d'expliquer un montant au client ou au pouvoir adjudicateur.

## Répondre à un marché public

1. **Importer** le fichier reçu (`.xlsx`, `.xlsm`, `.xls`, `.csv`, `.tsv`), en indiquant
   la **commune / pouvoir adjudicateur** — obligatoire : sans elle, les codes du
   catalogue de départ s'appliqueraient comme des certitudes à un marché qui ne les a
   jamais employés. Les feuilles multiples sont lues, la feuille
   « récapitulatif » est ignorée, les titres de lot sont rattachés aux postes qui les
   suivent, et les sous-totaux comme les tableaux de rappel en bas de feuille sont
   écartés. Un CSV encodé en Windows-1252 (le défaut d'un ancien Excel Windows) est
   reconnu comme tel : sans cela, « Désignation » devenait « D?signation », plus aucun
   en-tête n'était identifié et le fichier entier était refusé. Les fichiers UTF-16
   exportés par Excel le sont aussi.
2. **Vérifier les colonnes** détectées automatiquement, y compris la colonne de prix
   unitaire à compléter. La détection ne confond plus un prix unitaire avec un total
   ou un montant, ni la colonne « Prix unitaire » avec une colonne d'unité, et une
   phrase d'introduction comme « Description des travaux et quantités présumées » n'est
   plus prise pour la ligne d'en-têtes — un en-tête suppose des libellés courts dans
   des cellules distinctes. Un en-tête réparti sur **deux lignes** est reconstitué,
   qu'il s'agisse d'un libellé complété en dessous (« Quantité » puis « présumée ») ou
   de colonnes réparties entre les deux lignes. Sans cela, un tableau dont les deux
   dernières colonnes s'appellent toutes deux « Prix » sur la ligne haute recevait les
   prix unitaires dans la colonne des totaux.
3. **Analyser** : chaque poste est rapproché d'un ouvrage.
   - **Commune renseignée** : d'abord un code déjà appris pour **cette commune**,
     sinon par similarité de libellé (score affiché). Un code du catalogue de
     départ, partagé entre marchés, n'est jamais appliqué comme une certitude ici —
     il pourrait appartenir à la codification d'une tout autre commune.
   - **Aucune commune renseignée** : ce cas ne se produit plus à l'analyse, la commune
     étant obligatoire ; il subsiste pour relire une session enregistrée avant cette
     règle — d'abord un code du catalogue de départ, sinon par similarité de libellé.

   Dans les deux cas, un ouvrage dont l'unité est incompatible n'est jamais retenu,
   seulement signalé. Un ouvrage **forfaitaire** n'est retenu que pour une quantité
   de 1 : un prix global ne se multiplie pas par 180 m². Les classeurs dont chaque
   feuille a ses propres en-têtes (« Description » ici, « Désignation » là) sont lus
   colonne par colonne pour chaque ligne. Un poste sans numéro reçoit un numéro
   d'affichage qui n'est jamais mémorisé comme code. La commune prise en compte est celle **au moment de l'analyse** :
   la modifier ensuite affiche un rappel de relancer l'analyse, et les confirmations
   faites entre-temps restent mémorisées pour la commune de l'analyse (les lignes ont
   été rapprochées avec sa table de codes, elles ne doivent pas atterrir ailleurs).
4. **Contrôler et corriger** les correspondances. Le bloc d'import se replie dès que
   l'analyse a tourné : le tableau prend toute la largeur, et sur téléphone chaque
   poste devient une carte. Une pastille dit ce qu'on regarde — vert « code connu »
   ou « confirmé » (certain), ambre « libellé 72 % » (proposition à vérifier), rouge
   « à traiter » (aucun ouvrage d'unité compatible) — et la légende au-dessus du
   tableau le rappelle. Les pastilles « ! » et « ? » ouvrent leur explication sous la
   ligne concernée. Quand l'app a déjà repéré l'ouvrage le plus proche et que son
   unité convient, **« Utiliser … »** l'applique en un clic ; la liste déroulante ne
   propose que les ouvrages d'unité compatible.

   « Confirmer et mémoriser » (avec le nombre de propositions en attente) enregistre
   le code du poste sur l'ouvrage, **propre à la commune indiquée** : au marché suivant
   de cette même commune, il sera reconnu d'emblée, sans risquer de confondre deux
   communes qui réutilisent coïncidemment le même numéro de poste pour des ouvrages
   différents. Pour un poste non reconnu, **« Créer un ouvrage à partir de ce poste »**
   pré-remplit le formulaire (libellé, unité) — avant l'enregistrement, si un ouvrage
   techniquement proche existe déjà (libellé, matériaux, rendement, matériel), l'app le
   signale et propose de le réutiliser plutôt que de créer un quasi-doublon. Le poste
   ainsi mis en attente est retenu avec le métré auquel il appartient : importer un
   autre marché entre-temps annule le rattachement et le dit, au lieu de l'appliquer
   au poste qui occupe le même rang dans le nouveau fichier.
5. **Compléter le fichier reçu** : les prix unitaires sont écrits dans le classeur
   d'origine. Feuilles, formules, fusions de cellules, largeurs de colonnes, sous-totaux
   et récapitulatif sont conservés — le pouvoir adjudicateur récupère son propre
   document, complété. La mise en forme (polices, fonds, bordures) ne l'est pas : la
   bibliothèque Excel utilisée ne la réécrit pas. Le prix unitaire écrit est arrondi
   au centime, et c'est ce prix arrondi que l'application multiplie partout, pour
   que récapitulatif et fichier rendu donnent le même total. Chaque complétion
   repart des données reçues : un rapprochement retiré après une première complétion
   ne laisse jamais de prix résiduel dans une complétion suivante.

Contrôles effectués avant production du résultat : description manquante, quantité
absente ou nulle, poste présent plusieurs fois, unité incompatible, poste non chiffrable.
Un poste dont la désignation contient « pour mémoire » ou « hors marché » est traité à
part : ni quantité ni prix n'y sont attendus, il n'est donc jamais signalé comme une
anomalie.

## Reprendre un marché plus tard

Le fichier reçu et le métré chiffré sont conservés sur l'appareil (IndexedDB, séparé du
`localStorage` de la bibliothèque). Concrètement :

- Fermer l'application puis la rouvrir retrouve le métré en cours **et** son classeur
  d'origine : « Compléter le fichier reçu » fonctionne toujours, sans réimport.
- Importer un autre marché n'efface pas le précédent : il rejoint la liste **« Métrés
  déjà chiffrés »**, en haut de la vue Métré. Chaque entrée rappelle la commune, la
  date, le nombre de postes chiffrés et le total.
- **Rouvrir** restitue les lignes, l'analyse, les colonnes choisies et le fichier reçu —
  de quoi comparer deux marchés ou compléter un CSC rendu la semaine précédente.
  **Retirer** supprime définitivement une entrée de l'historique.
- Un métré rouvert est **figé au prix rendu** : il affiche les montants remis à
  l'époque, et réexporter le classeur y réécrit exactement les mêmes prix, quelle que
  soit la bibliothèque d'aujourd'hui. Un bandeau rappelle le coût horaire et le
  coefficient K de ce chiffrage. **Recalculer aux prix actuels** rebascule
  volontairement l'ensemble sur la bibliothèque du jour et annonce l'écart.

Un navigateur qui refuse IndexedDB (navigation privée stricte) fait simplement
retomber l'application sur son comportement d'avant : le classeur ne survit pas au
rechargement, et l'historique reste vide.

> La mise en forme du classeur est préservée dans la limite de ce que SheetJS sait
> réécrire (formules, fusions et largeurs oui ; polices, fonds et bordures non).

## Devis client

La vue **Devis** tient une liste, pas un seul document : un nouveau devis n'écrase plus
le précédent.

- **Nouveau devis** attribue un numéro de la forme `2026-001` (incrémenté par année) et
  la date du jour. Numéro et date restent modifiables si l'entreprise a sa propre
  numérotation — celle-ci est alors laissée telle quelle par la suite.
- **Dupliquer** reprend client, objet, TVA et lignes sous un nouveau numéro : pratique
  pour une variante ou un chantier voisin. Les lignes sont copiées, pas partagées —
  modifier l'un ne touche pas l'autre.
- **Ouvrir** bascule sur un autre devis, **Supprimer** en retire un (jamais le dernier).
- Les exports (Excel, CSV, JSON) portent le numéro du devis dans leur nom de fichier, et
  un devis importé en JSON s'ajoute à la liste au lieu de remplacer celui qui est ouvert.

Une bibliothèque enregistrée avant ce changement ne contenait qu'un devis : il devient
le premier de la liste, avec un numéro et une date attribués s'il n'en avait pas.

## Un devis remis ne bouge plus

Un prix remis à un client est un engagement : il ne doit pas changer parce que la
bibliothèque a évolué depuis. Chaque ligne de devis conserve donc **le prix tel qu'il a
été chiffré** — nom, unité, prix unitaire de vente et coût direct sont recopiés dans la
ligne au moment où elle est ajoutée. Le devis retient en plus le contexte du calcul :
coût horaire, frais généraux, frais de chantier, imprévus, marge, formule et valeur du
coefficient K, TVA et date.

Concrètement, augmenter le prix d'un matériau, corriger un rendement ou passer la marge
de 18 à 24 % ne touche plus un devis déjà chiffré, même rouvert trois mois plus tard.
Supprimer un ouvrage de la bibliothèque non plus : la ligne reste lisible et chiffrée.

- **Statut.** Un devis est *brouillon* tant qu'il se travaille. **Figer le devis** le
  passe en *figé* : il n'accepte plus d'ajout, de modification ni de suppression de
  ligne — c'est la version remise au client. Le bouton refait l'inverse (*Rouvrir en
  brouillon*) pour préparer une révision, ou l'on **Duplique** pour partir sur une
  variante en gardant l'original intact.
- **Écart.** Si la bibliothèque a bougé depuis, un bandeau annonce combien de lignes ne
  valent plus le même prix et de combien, et le prix du jour s'affiche sous le prix
  retenu. Le montant du devis, lui, ne change pas.
- **Actualiser les prix** (brouillon uniquement) reprend les prix d'aujourd'hui sur
  toutes les lignes, en une action explicite et annoncée. Un devis figé ne propose pas
  ce bouton.

L'export Excel du devis ajoute en pied de tableau le coût horaire, le coefficient K et
la formule utilisés : de quoi refaire le calcul plus tard sans deviner les réglages de
l'époque.

Une bibliothèque enregistrée avant ce changement voit ses lignes figées au prix
d'aujourd'hui à la première ouverture — c'est la seule valeur dont on dispose — et ses
devis repartent en brouillon.

## Corriger la bibliothèque avec les chantiers réalisés

Un devis repose sur des rendements estimés. La vue **Chantiers** sert à les confronter
au travail réellement presté, puis à corriger la bibliothèque.

1. **Créer un chantier** (nom, référence, date).
2. **Relever les heures** par ouvrage : la quantité réalisée et le temps passé, saisi
   comme il se compte sur le terrain — « 50 m² par 2 personnes pendant 7 heures » font
   14 heures, soit 0,28 h/m². Le rendement prévu et le rendement constaté sont affichés
   côte à côte, avec l'écart.
3. **Relever les achats** : quantité facturée et montant payé, d'où le prix réellement
   obtenu chez le fournisseur, comparé au prix de la bibliothèque.
4. **Lire le bilan** : recette, coût direct prévu, coût direct réel, marge prévue et
   marge réelle. Sans relevé d'achat, la marge réelle est signalée comme incomplète.
5. **Recaler la bibliothèque** : le panneau de recalage cumule tous les chantiers
   enregistrés et pondère par les quantités — un poste réalisé une fois sur 5 m² pèse
   moins qu'un poste réalisé trois fois sur 400 m². Chaque correction est proposée avec
   son écart, le volume sur lequel elle est observée et son effet sur le prix de vente.
   Rien n'est corrigé automatiquement : l'entreprise applique ce qu'elle retient.

Le tableau de bord compte les corrections en attente, c'est-à-dire les rendements et les
prix qui s'écartent de plus de 5 % des relevés.

Un relevé peut être corrigé directement dans son tableau. Supprimer un chantier retire
ses relevés du recalage, mais laisse en place les corrections déjà appliquées.

## Alerte de péremption des prix

Un prix de matériau porte une date. Passé un seuil réglable dans les paramètres
(180 jours par défaut, 0 désactive l'alerte), il est signalé comme à vérifier : sur sa
fiche dans la bibliothèque, et dans le panneau « Prix à vérifier » du tableau de bord,
trié du plus ancien au plus récent.

Deux actions depuis ce panneau : **Éditer** pour corriger le prix, ou **Prix toujours
valable** pour reconduire la date à aujourd'hui sans rien changer d'autre — la façon la
plus rapide de confirmer un prix qui n'a en fait pas bougé. Le recalage d'un prix depuis
un chantier (voir plus haut) date également le prix, sur le même principe.

Un prix sans date n'est pas concerné : rien n'indique depuis combien de temps il n'a pas
été vérifié, il reste seulement marqué « prix non daté » sur sa fiche.

## Organisation du code

| Fichier | Rôle |
| --- | --- |
| `index.html` | Structure des sept vues, sprite SVG des icônes de navigation |
| `styles.css` | Mise en forme |
| `favicon.svg` | Icône de l'onglet du navigateur |
| `manifest.webmanifest`, `icons/` | Icône d'écran d'accueil (téléphone) et nom affiché en dessous |
| `sw.js` | Service worker : cache l'application pour l'usage hors connexion |
| `db.js` | IndexedDB : classeur reçu et historique des métrés chiffrés |
| `catalog.js` | Catalogue de départ et codifications connues |
| `core.js` | Logique métier pure : calcul, unités, rapprochement, lecture et analyse de métré, migration de l'état enregistré, gel des prix d'un devis, retour de chantier, péremption des prix |
| `app.js` | Rendu, événements, imports/exports, dialogues |
| `test/core.test.js` | Tests de `core.js` et cohérence du catalogue |
| `test/e2e/` | Parcours navigateur (Playwright), serveur statique et fixtures |
| `playwright.config.mjs` | Configuration des parcours navigateur |

`core.js` ne touche pas au DOM, ce qui rend la logique testable hors navigateur. La
frontière suit une règle simple : **tout ce qui transforme des données va dans
`core.js`**, `app.js` ne garde que ce qui lit ou écrit dans la page. Cela vaut aussi
pour les opérations sur l'état complet — analyse d'un métré (`analyseRows`), migration
d'une bibliothèque enregistrée par une version antérieure (`normalizeState`),
mémorisation d'un code (`memoriserCode`), fusion et suppression d'un ouvrage — qui
vivaient dans `app.js` sans qu'aucun test ne puisse les atteindre.

## Thème clair / sombre / automatique

Le sélecteur en bas de la barre latérale choisit entre les trois. « Automatique »
(par défaut) suit le réglage du système d'exploitation, y compris s'il change pendant
que l'application est ouverte. Un choix explicite est mémorisé dans une clé de
`localStorage` séparée de celle des données de chiffrage — jamais touchée par
« Tout réinitialiser » — et prime sur le système jusqu'à revenir sur « Automatique ».

## Version

Le numéro affiché en bas de la barre latérale suit `package.json`. L'application
n'ayant pas d'outil de build, les deux sont à mettre à jour à la main ensemble
(`APP_VERSION` dans `app.js`) — utile surtout pour confirmer, une fois déployée sur
GitHub Pages, que le navigateur affiche bien la dernière version.

Les versions suivent [SemVer](https://semver.org/lang/fr/) : le premier nombre change
quand la forme des données enregistrées change, ou quand une habitude de travail change.
Ce qui a changé d'une version à l'autre est dans [CHANGELOG.md](CHANGELOG.md).

## Tests

```bash
npm test        # logique pure, aucune dépendance à installer
npm run test:e2e   # deux parcours navigateur (npm ci d'abord)
npm run test:all   # les deux
```

Les deux suites tournent sur chaque pull request et avant chaque déploiement : un commit
qui casse l'une ou l'autre n'est ni fusionné ni mis en ligne.

`npm test` n'a besoin de rien d'autre que Node. `npm run test:e2e` demande
`npm ci` puis `npx playwright install chromium` ; dans un environnement qui fournit déjà
un Chromium, `PLAYWRIGHT_CHROMIUM=/chemin/vers/chrome` évite d'en télécharger un second.

Trois familles de tests couvrent ce qui coûte le plus cher à casser :

- **Calcul et rapprochement** : prix de vente, coefficient K, unités, `findMatch`,
  lecture d'une grille de métré.
- **Migration de l'état** : une bibliothèque enregistrée par une version antérieure
  (ancien couple `materiauId`/`quantiteMateriau`, `referencesMetre`, communes
  homonymes en conflit, TVA à 0 %) doit se relire sans perte ni écrasement silencieux.
- **Export / import JSON** : le fichier ne contient jamais de métré, il contient tout
  le reste, il se relit en un état complet, et un import ne détruit pas le métré en
  cours.
- **Cas limites d'import** : CSV Windows-1252 et UTF-16, colonne de prix unitaire
  face à une colonne de total ou de montant, colonne « Prix unitaire » face à une
  colonne d'unité absente, phrase d'introduction confondue avec la ligne d'en-têtes,
  en-tête réparti sur deux lignes (et titre de lot ou premier poste qui ne doivent
  surtout pas y être absorbés).
- **Prix figés** : une ligne de devis chiffrée hier garde son prix quand la
  bibliothèque change, un ouvrage supprimé reste lisible, les totaux se lisent sur les
  valeurs figées et `ecartsDevis` chiffre la dérive sans la subir.
- **Invariants après remaniement** : après un apprentissage, une fusion ou une
  suppression d'ouvrage, aucun code de métré ne désigne deux ouvrages et aucune
  référence ne pointe vers un ouvrage disparu.

Deux **parcours navigateur** (`test/e2e/`) couvrent ce que la logique pure ne peut pas
voir — le DOM assemblé, IndexedDB, un vrai téléchargement :

1. **CSV** : importer un métré, se faire refuser l'analyse sans commune, analyser,
   confirmer les correspondances (les codes deviennent propres à la commune), exporter
   le récapitulatif et vérifier que la ligne du poste porte un prix et un montant.
2. **XLSX** : importer un classeur cumulant titre en capitales, phrase d'introduction et
   en-tête sur deux lignes, **recharger la page**, vérifier que le métré et son classeur
   reviennent d'IndexedDB, puis compléter le fichier reçu et contrôler que les prix sont
   écrits dans la colonne « Prix unitaire HTVA » — la colonne voisine, également nommée
   « Prix », devant rester vide.

Aucun des deux n'atteint le réseau : SheetJS est servi depuis `node_modules` plutôt que
depuis le CDN, pour qu'un incident chez jsdelivr ne fasse pas rougir la CI. Aucune
reprise automatique non plus : un parcours qui échoue par intermittence ne prouve rien,
il doit être vu.

## Sauvegarde

« Exporter les données » produit un JSON contenant la mémoire de chiffrage :
bibliothèque, réglages, codes appris par commune, devis et chantiers. C'est le seul
moyen de transférer cette mémoire d'un poste à un autre, ou de s'en prémunir contre un
vidage du navigateur.

Le métré en cours n'y est pas, et c'est délibéré. L'export en emportait auparavant une
moitié — les résultats de l'analyse, mais pas les lignes du fichier reçu : de quoi
relire, pas de quoi réanalyser. Le partage est maintenant net. Le JSON porte ce qui se
transporte d'un appareil à l'autre ; le métré en cours, l'historique des métrés et le
classeur d'origine vivent dans IndexedDB et restent propres à l'appareil — le JSON n'a
de toute façon jamais su porter le classeur.

Conséquence à l'import : le métré en cours **n'est pas écrasé** par le fichier importé.
Il garde ses postes, ses quantités et son classeur, donc « Compléter le fichier reçu »
fonctionne toujours ; l'application signale seulement qu'il faut relancer l'analyse pour
le rapprocher de la bibliothèque qui vient d'arriver. Un export ancien, lui, contenait
un métré amputé : il est ignoré au profit de celui de l'appareil, sauf s'il est complet.

## Limites connues

- Les ouvrages du catalogue de départ combinant plusieurs fournitures (enduit, treillis
  et accessoires ; cuvette, bâti et accessoires ; etc.) ont désormais des composants
  séparés, mais leur répartition de prix reste indicative : elle a été estimée pour
  préserver le prix groupé d'origine, pas relevée chez un fournisseur. À corriger au fil
  des prix réellement obtenus.
- Le forfait « matériel et accessoires » n'est pas relevé sur chantier : il est repris
  tel quel dans le bilan, et compte donc à l'identique du côté prévu et du côté réel.
- Le recalage remplace la valeur de la bibliothèque par la moyenne observée. Il ne
  distingue pas encore un chantier atypique d'une dérive durable : c'est le volume
  affiché en regard qui permet d'en juger.
- « Prix toujours valable » reconduit la date sans historiser l'ancienne : impossible de
  retrouver après coup depuis quand un prix est réellement resté stable.
