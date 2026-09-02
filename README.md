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
   la **commune / pouvoir adjudicateur**. Les feuilles multiples sont lues, la feuille
   « récapitulatif » est ignorée, les titres de lot sont rattachés aux postes qui les
   suivent, et les sous-totaux comme les tableaux de rappel en bas de feuille sont
   écartés.
2. **Vérifier les colonnes** détectées automatiquement, y compris la colonne de prix
   unitaire à compléter.
3. **Analyser** : chaque poste est rapproché d'un ouvrage, d'abord par un code de métré
   déjà appris pour **cette commune**, puis par un code du catalogue de départ partagé
   entre marchés, sinon par similarité de libellé (score affiché). Un ouvrage dont
   l'unité est incompatible n'est jamais retenu, seulement signalé.
4. **Contrôler et corriger** les correspondances. « Confirmer et mémoriser » enregistre
   le code du poste sur l'ouvrage, **propre à la commune indiquée** : au marché suivant
   de cette même commune, il sera reconnu d'emblée, sans risquer de confondre deux
   communes qui réutilisent coïncidemment le même numéro de poste pour des ouvrages
   différents. Pour un poste non reconnu, **« Créer un ouvrage à partir de ce poste »**
   pré-remplit le formulaire (libellé, unité) — avant l'enregistrement, si un ouvrage
   techniquement proche existe déjà (libellé, matériaux, rendement, matériel), l'app le
   signale et propose de le réutiliser plutôt que de créer un quasi-doublon.
5. **Compléter le fichier reçu** : les prix unitaires sont écrits dans le classeur
   d'origine. Feuilles, formules, sous-totaux et récapitulatif sont conservés — le
   pouvoir adjudicateur récupère son propre document, complété. Chaque complétion
   repart des données reçues : un rapprochement retiré après une première complétion
   ne laisse jamais de prix résiduel dans une complétion suivante.

Contrôles effectués avant production du résultat : description manquante, quantité
absente ou nulle, poste présent plusieurs fois, unité incompatible, poste non chiffrable.
Un poste dont la désignation contient « pour mémoire » ou « hors marché » est traité à
part : ni quantité ni prix n'y sont attendus, il n'est donc jamais signalé comme une
anomalie.

> Le classeur d'origine n'est gardé qu'en mémoire. Après un rechargement de la page,
> réimportez le fichier pour pouvoir le compléter — le récapitulatif Excel et le CSV
> restent disponibles sans lui. La mise en forme est préservée dans la limite de ce
> que SheetJS sait réécrire.

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
| `catalog.js` | Catalogue de départ et codifications connues |
| `core.js` | Logique métier pure : calcul, unités, rapprochement, lecture de métré, retour de chantier, péremption des prix |
| `app.js` | État, rendu, événements, imports/exports |
| `test/core.test.js` | Tests de `core.js` et cohérence du catalogue |

`core.js` ne touche pas au DOM, ce qui rend la logique de chiffrage testable hors
navigateur.

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

## Tests

```bash
node --test test/core.test.js
```

Aucune dépendance à installer. Le déploiement sur GitHub Pages exécute cette suite avant
de publier : un commit qui la casse n'est pas mis en ligne.

## Sauvegarde

« Exporter les données » produit un JSON contenant la bibliothèque, les paramètres et
le devis en cours. C'est le seul moyen de transférer la mémoire de chiffrage d'un poste
à un autre, ou de s'en prémunir contre un vidage du navigateur.

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
