# Audit comparatif — Devis-generator-app vs Devis-generator

Date : 2 septembre 2026

## Résumé exécutif

`Devis-generator-app` n'est pas un simple habillage de `Devis-generator`. C'est une réécriture autonome en HTML/CSS/JavaScript qui reprend une partie importante du métier, mais avec un modèle de données, une persistance et plusieurs règles différentes du moteur Python.

L'app navigateur est intéressante pour sa simplicité de diffusion : aucun serveur applicatif, GitHub Pages, fonctionnement sur téléphone, données dans `localStorage`, logique métier isolée dans `core.js` et tests Node sans dépendances.

En revanche, elle ne doit pas encore être considérée comme une version fonctionnellement équivalente du moteur Python. Plusieurs divergences peuvent modifier le résultat financier ou perdre la traçabilité.

## 1. Architecture des deux projets

### Devis-generator (Python)

Le dépôt Python est le moteur métier historique et le plus riche :

- package `chiffrage/` découpé en modules ;
- ressources, ouvrages et compositions dans des fichiers JSON ;
- moteur de prix ;
- contrôle des prix ;
- détection des colonnes ;
- import/export de métrés ;
- génération Excel ;
- justificatifs ;
- lexique métier réglable ;
- persistance/configuration par entreprise ;
- intégration GitHub ;
- Streamlit ;
- suite de tests importante.

Le modèle central est :

```
RESSOURCES -> COMPOSITION -> OUVRAGES -> BORDEREAU
```

### Devis-generator-app (JavaScript)

L'app est volontairement compacte :

- `catalog.js` : catalogue initial ;
- `core.js` : logique métier pure ;
- `app.js` : état, DOM, imports/exports, événements ;
- `index.html` : sept vues ;
- `styles.css` : présentation ;
- `test/core.test.js` : tests du cœur ;
- GitHub Pages comme hébergement.

Le navigateur devient à la fois interface, moteur et stockage.

## 2. Écart critique : calcul du coefficient K

### Moteur Python

Le moteur de référence documente :

```
K = (1 + FG) × (1 + FC) × (1 + aléas) × (1 + marge)
```

Exemple historique :

```
12 % × 5 % × 3 % × 10 % -> K = 1,3324
```

### App JavaScript

`core.js` calcule :

```js
K = 1 + (FG + FC + imprévus + marge) / 100
```

Les tests verrouillent explicitement ce comportement : avec 10 %, 5 %, 5 % et 10 %, ils attendent `K = 1.3`.

### Conséquence

Les deux applications ne produisent pas le même prix de vente pour les mêmes coûts directs.

Avec les paramètres actuels de l'app (12 %, 5 %, 4 %, 18 %) :

- formule additive : K = 1,39 ;
- formule multiplicative : environ K = 1,444.

Sur 100 000 € de déboursé direct, l'écart approche donc 5 400 €.

### Recommandation

Décider explicitement quelle formule constitue la règle métier de référence.

Si `Devis-generator` reste la référence, modifier :

- `core.js` (`coefficientK`) ;
- les tests de calcul ;
- le README de l'app ;
- tous les exemples de prix de vente.

Ne pas corriger silencieusement ce point dans une version déjà utilisée pour des devis : prévoir une migration/version et un avertissement utilisateur.

## 3. Divergence récente : péremption des prix

Le dernier changement majeur du dépôt Python pose le principe :

> un prix d'achat ne se valide pas, il périme.

L'idée est de ne pas transformer un simple clic en preuve qu'un fournisseur pratique encore ce prix.

Dans l'app JavaScript, `confirmerPrixMateriau()` permet au contraire le bouton **« Prix toujours valable »**, qui remplace simplement `datePrix` par la date du jour sans nouvelle facture ou nouvelle offre fournisseur.

C'est donc une divergence métier, et non une différence d'interface.

### Recommandation

Aligner l'app sur le dépôt Python :

- supprimer ou renommer « Prix toujours valable » ;
- ne dater un prix que lors d'une vraie mise à jour avec preuve/source ;
- ajouter une `sourcePrix` (fournisseur, facture, devis, URL/référence) ;
- conserver éventuellement un historique de prix.

## 4. Bugs / risques trouvés dans l'app

### 4.1 Suppression d'un ouvrage : références de chantier orphelines

Lorsqu'un ouvrage est supprimé, l'app :

- le retire de `state.ouvrages` ;
- retire ses correspondances de métré ;
- mais ne retire ou ne remappe pas les lignes `chantier.mainOeuvre` qui utilisent cet ouvrage.

Le moteur de bilan tolère techniquement un ouvrage absent, mais le relevé devient sémantiquement orphelin : il conserve des heures réelles alors que la recette et le coût prévu liés à l'ouvrage disparaissent.

Cela peut fausser l'analyse historique du chantier.

### 4.2 Fusion d'ouvrages incomplète

`mergeOuvrages()` transfère :

- les lignes de devis ;
- les lignes de métré analysées ;
- les codes appris.

Mais il ne transfère pas `chantier.mainOeuvre` de l'ancien ouvrage vers le nouveau.

Après fusion, des relevés historiques restent donc liés à un ID supprimé.

### 4.3 Suppression d'un matériau : achats historiques orphelins

Lorsqu'un matériau est supprimé :

- ses composants sont retirés des ouvrages ;
- mais les achats enregistrés dans les chantiers conservent l'ancien `materiauId`.

Les montants réels peuvent rester dans le bilan avec une matière devenue impossible à identifier.

### 4.4 Parseur CSV insuffisant

`parseDelimited()` fait un simple `line.split(separator)`.

Cela ne respecte pas les règles CSV :

- séparateur dans un champ entre guillemets ;
- guillemets doublés ;
- champs multilignes.

Exemple problématique :

```csv
01.01;"Enduit, préparation comprise";m2;160
```

Le cas devient encore plus critique avec une virgule comme séparateur.

Le test actuel vérifie uniquement un CSV simple sans guillemets.

### 4.5 Tests métier non exécutés dans le workflow de déploiement

`package.json` contient bien :

```
node --test test/core.test.js
```

mais le workflow GitHub Pages déploie directement après checkout, sans étape de test.

Un commit cassant `core.js` peut donc être publié en production.

### 4.6 Gros fichier `app.js`

`app.js` dépasse 80 Ko et mélange :

- stockage ;
- rendu ;
- événements ;
- import/export ;
- gestion devis ;
- chantiers ;
- métré ;
- thème.

Le risque principal n'est pas la performance mais la maintenance : une modification locale peut avoir des effets de bord éloignés et les tests couvrent principalement `core.js`, pas le comportement DOM/état.

## 5. Différences de robustesse avec le moteur Python

### Lexique métier

Le moteur Python possède un lexique métier explicite et réglable pour rapprocher des formulations différentes.

L'app JS repose davantage sur tokenisation + similarité lexicale. Elle est donc plus simple mais perd une partie de l'apprentissage métier déterministe du Python.

### Paramètres

Le Python valide fortement les paramètres et distingue les paramètres entreprise des valeurs techniques.

L'app JS normalise beaucoup de nombres avec `Number(x) || 0`, ce qui est pratique mais peut transformer silencieusement une valeur incorrecte en zéro.

### Multi-entreprise

Le moteur Python possède `CHIFFRAGE_DATA` et peut isoler les données de plusieurs entreprises.

L'app JS stocke tout dans un `localStorage` unique du navigateur. Elle est donc naturellement mono-utilisateur / mono-profil par navigateur, sans synchronisation.

## 6. Points positifs de l'app

- aucune infrastructure serveur ;
- GitHub Pages très simple à distribuer ;
- utilisable sur téléphone ;
- données locales par défaut ;
- `core.js` séparé du DOM ;
- absence de `eval`/`Function` dans l'évaluation arithmétique ;
- compatibilité avec anciennes structures de composants ;
- détection d'unités incompatibles ;
- conservation des positions du fichier Excel pour compléter l'original ;
- relevés de chantiers et recalage pondéré ;
- thème clair/sombre/automatique récemment ajouté proprement ;
- catalogue cohérent vérifié par des tests.

## 7. Carte du code proposée

### Couche 1 — données

```
catalog.js
  -> paramètres par défaut
  -> matériaux
  -> ouvrages
  -> références connues
```

### Couche 2 — domaine pur

```
core.js
  -> texte / normalisation
  -> unités
  -> nombres
  -> calcul prix
  -> retours chantier
  -> vieillissement prix
  -> codes
  -> matching
  -> doublons
  -> parsing métrés
```

### Couche 3 — état/persistance

Actuellement dans `app.js` :

```
loadState
normalizeState
seedCatalog
saveState
```

À extraire vers `state.js`.

### Couche 4 — fonctionnalités

À découper depuis `app.js` :

```
devis.js
metre.js
chantiers.js
bibliotheque.js
settings.js
import-export.js
```

### Couche 5 — interface

```
ui.js
  -> navigation
  -> notifications
  -> thème
  -> composants DOM communs
```

## 8. Refactorisation prioritaire

Ordre conseillé :

1. figer la règle de K ;
2. aligner la politique de péremption des prix ;
3. réparer les références orphelines lors des suppressions/fusions ;
4. mettre les tests avant le déploiement GitHub Pages ;
5. renforcer le parseur CSV ;
6. extraire la gestion d'état de `app.js` ;
7. extraire métré, devis et chantiers ;
8. ajouter des tests d'intégrité des IDs ;
9. rapprocher progressivement le modèle de données du moteur Python.

## 9. Tests à ajouter immédiatement

- même déboursé + mêmes coefficients => même PU dans Python et JS ;
- suppression ouvrage utilisé par un chantier ;
- fusion ouvrage utilisé par plusieurs chantiers ;
- suppression matériau présent dans des achats historiques ;
- CSV avec champ contenant `;` ;
- CSV avec champ contenant `,` ;
- CSV avec guillemets échappés ;
- sauvegarde localStorage saturé ;
- import JSON ancien / migration ;
- cohérence des références après chaque mutation.

## 10. Workflow GitHub recommandé

Avant `upload-pages-artifact` :

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 22

- name: Tests métier
  run: npm test
```

Le déploiement ne doit avoir lieu que si les tests passent.

## 11. Stratégie d'alignement des deux dépôts

Il serait risqué de continuer à faire évoluer indépendamment deux moteurs métier.

La cible recommandée est :

- **une seule spécification métier** ;
- des jeux de données de référence communs ;
- des cas de tests communs ;
- Python et JavaScript peuvent rester deux implémentations, mais doivent produire les mêmes résultats sur ces cas.

Créer par exemple :

```
spec/
  pricing_cases.json
  matching_cases.json
  units_cases.json
```

Les tests Python et JS lisent les mêmes fichiers.

## Conclusion

`Devis-generator-app` est déjà une bonne base de produit distribuable, plus facile d'accès que la version Streamlit. Son principal problème n'est pas son interface : c'est que la logique métier commence à diverger du moteur Python.

Avant d'en faire la version principale pour plusieurs entrepreneurs, il faut prioritairement réconcilier la formule de prix, la politique de fraîcheur des prix, l'intégrité des références historiques et les tests de déploiement.
