# Générateur de devis

Application de chiffrage pour entreprises du bâtiment. Elle mémorise la façon dont
l'entreprise travaille — coût horaire, rendements, prix des matériaux, frais et marge —
et s'en sert pour calculer des prix de vente cohérents, produire un devis client ou
compléter le métré d'un marché public.

Tout fonctionne dans le navigateur, sans serveur ni compte. Les données restent dans
le `localStorage` du poste.

## Démarrer

**En ligne :** https://pmeyssonnier.github.io/Devis-generator-app/ — utilisable depuis
n'importe quel appareil, y compris un téléphone. Les données restent propres à chaque
appareil et à chaque navigateur (`localStorage`) : rien n'est synchronisé entre eux.

**En local :** ouvrir `index.html` dans un navigateur récent.

Le premier lancement installe un catalogue de départ : 51 ouvrages et 38 matériaux
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
× K              K = 1 + (frais généraux + frais de chantier + imprévus + marge) / 100
= Prix de vente
```

Un ouvrage combine autant de fournitures que nécessaire — isolant, enduit, accessoires —
chacune avec sa quantité par unité d'ouvrage. Le formulaire affiche le coût matière au
fur et à mesure de la saisie.

Chaque ouvrage affiche sa décomposition (« Justifier ce prix ») : une ligne par
fourniture, avec sa quantité et son prix. C'est ce qui permet de contrôler un calcul et
d'expliquer un montant au client ou au pouvoir adjudicateur.

## Répondre à un marché public

1. **Importer** le fichier reçu (`.xlsx`, `.xlsm`, `.xls`, `.csv`, `.tsv`). Les
   feuilles multiples sont lues, la feuille « récapitulatif » est ignorée, les titres
   de lot sont rattachés aux postes qui les suivent, et les sous-totaux comme les
   tableaux de rappel en bas de feuille sont écartés.
2. **Vérifier les colonnes** détectées automatiquement, y compris la colonne de prix
   unitaire à compléter.
3. **Analyser** : chaque poste est rapproché d'un ouvrage, d'abord par code de métré
   déjà connu (certitude), sinon par similarité de libellé (score affiché). Un ouvrage
   dont l'unité est incompatible n'est jamais retenu, seulement signalé.
4. **Contrôler et corriger** les correspondances. « Confirmer et mémoriser » enregistre
   les codes du cahier des charges sur les ouvrages : au marché suivant utilisant la
   même codification, ils seront reconnus d'emblée.
5. **Compléter le fichier reçu** : les prix unitaires sont écrits dans le classeur
   d'origine. Feuilles, formules, sous-totaux et récapitulatif sont conservés — le
   pouvoir adjudicateur récupère son propre document, complété.

Contrôles effectués avant production du résultat : description manquante, quantité
absente ou nulle, poste présent plusieurs fois, unité incompatible, poste non chiffrable.

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

## Organisation du code

| Fichier | Rôle |
| --- | --- |
| `index.html` | Structure des sept vues |
| `styles.css` | Mise en forme |
| `catalog.js` | Catalogue de départ et codifications connues |
| `core.js` | Logique métier pure : calcul, unités, rapprochement, lecture de métré, retour de chantier |
| `app.js` | État, rendu, événements, imports/exports |
| `test/core.test.js` | Tests de `core.js` et cohérence du catalogue |

`core.js` ne touche pas au DOM, ce qui rend la logique de chiffrage testable hors
navigateur.

## Tests

```bash
node --test test/core.test.js
```

Aucune dépendance à installer.

## Sauvegarde

« Exporter les données » produit un JSON contenant la bibliothèque, les paramètres et
le devis en cours. C'est le seul moyen de transférer la mémoire de chiffrage d'un poste
à un autre, ou de s'en prémunir contre un vidage du navigateur.

## Limites connues

- Le catalogue de départ ne déclare encore qu'une fourniture par ouvrage, et certains de
  ses matériaux restent des lots groupés (« enduit, treillis et accessoires ») dont le
  prix n'est pas ventilé. L'application sait les décomposer : c'est un travail de saisie
  à faire au fil des prix réellement obtenus.
- Le forfait « matériel et accessoires » n'est pas relevé sur chantier : il est repris
  tel quel dans le bilan, et compte donc à l'identique du côté prévu et du côté réel.
- Le recalage remplace la valeur de la bibliothèque par la moyenne observée. Il ne
  distingue pas encore un chantier atypique d'une dérive durable : c'est le volume
  affiché en regard qui permet d'en juger.
- Les prix des matériaux portent une date, mais aucune alerte de péremption n'est levée.
