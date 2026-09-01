# Générateur de devis

Application de chiffrage pour entreprises du bâtiment. Elle mémorise la façon dont
l'entreprise travaille — coût horaire, rendements, prix des matériaux, frais et marge —
et s'en sert pour calculer des prix de vente cohérents, produire un devis client ou
compléter le métré d'un marché public.

Tout fonctionne dans le navigateur, sans serveur ni compte. Les données restent dans
le `localStorage` du poste.

## Démarrer

Ouvrir `index.html` dans un navigateur récent.

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
+ Matériaux      quantité/unité × prix du matériau
+ Matériel       forfait par unité
= Coût direct
× K              K = 1 + (frais généraux + frais de chantier + imprévus + marge) / 100
= Prix de vente
```

Chaque ouvrage affiche sa décomposition (« Justifier ce prix ») : c'est ce qui permet
de contrôler un calcul et d'expliquer un montant au client ou au pouvoir adjudicateur.

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

## Organisation du code

| Fichier | Rôle |
| --- | --- |
| `index.html` | Structure des six vues |
| `styles.css` | Mise en forme |
| `catalog.js` | Catalogue de départ et codifications connues |
| `core.js` | Logique métier pure : calcul, unités, rapprochement, lecture de métré |
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

- Un ouvrage ne référence qu'un seul matériau, complété par un forfait « matériel et
  accessoires ». Un ouvrage réel combinant plusieurs fournitures distinctes (isolant +
  enduit + accessoires) doit être décomposé ou approximé.
- Les rendements ne sont pas encore recalés sur les heures réellement prestées : la
  boucle « devis → chantier → correction de la bibliothèque » reste à construire.
- Les prix des matériaux portent une date, mais aucune alerte de péremption n'est levée.
