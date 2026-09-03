# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Application de chiffrage bâtiment (belge) : bibliothèque d'ouvrages, devis client, et
complétion de métrés de marchés publics dans leur classeur d'origine. Le code, les
commentaires, les commits et les PR sont **en français** — s'y tenir.

## Commandes

```bash
npm test                    # tests unitaires de core.js (aucune dépendance requise)
# Un sous-ensemble. Le motif doit PRÉCÉDER le fichier : placé après, Node le passe au
# fichier de test comme argument et exécute la suite entière sans rien dire.
node --test --test-name-pattern "recette" test/core.test.js
npm run test:e2e            # 4 parcours navigateur (npm ci puis npx playwright install chromium)
npm run test:all            # les deux

# Environnement fournissant déjà un Chromium :
PLAYWRIGHT_CHROMIUM=/chemin/vers/chrome npm run test:e2e

# Servir l'app localement (Playwright le fait seul via webServer)
node test/e2e/serveur.mjs   # http://127.0.0.1:8123

# Détecteur de design (déterministe, sans réseau ni clé d'API)
node .claude/skills/impeccable/scripts/detect.mjs styles.css index.html
```

Pas d'outil de build, pas de bundler, pas de lint. `npm test` doit rester exécutable
sans `npm install` : ne jamais y introduire de dépendance.

## Architecture

### Chargement et globales

`index.html` charge quatre scripts `defer` **dans cet ordre**, chacun exposant une
globale ; l'ordre est significatif et il n'y a pas de modules ES :

| Fichier | Globale | Rôle |
| --- | --- | --- |
| `catalog.js` | `DGCatalog` | Catalogue de départ, codifications connues, recettes techniques |
| `db.js` | `DGStore` | IndexedDB (`generateur-devis`) |
| `core.js` | `DGCore` | Toute la logique métier, sans DOM |
| `app.js` | — | Rendu, événements, imports/exports |

SheetJS vient d'un CDN en `async` ; `requireXlsx()` échoue proprement s'il n'est pas là.
Pas d'attribut `integrity` (le hash n'a pas pu être vérifié depuis l'environnement de
développement — c'est documenté dans un commentaire HTML, ne pas l'ajouter à l'aveugle).

### La frontière core / app

**Règle structurante du dépôt : tout ce qui transforme des données vit dans `core.js`.**
`app.js` ne garde que ce qui lit ou écrit dans la page. Cela vaut aussi pour les
opérations sur l'état complet — `analyseRows`, `normalizeState`, `memoriserCode`,
`fusionnerOuvrages`, le gel des prix. `core.js` ne touche jamais au DOM, ce qui rend
tout cela testable hors navigateur ; une fonction de `app.js` n'est couverte par rien.

Quand une fonction de `app.js` mérite un test, la déplacer dans `core.js` plutôt que
d'écrire un test de DOM.

### Modèle de prix

```
matériaux (prix unitaire)
  └── ouvrage = composants + heures + matériel
        └── coût direct = heures × coûtHoraire + matières + matériel
              └── × coefficient K  →  prix de vente
```

K se calcule depuis `settings` (frais généraux, frais de chantier, imprévus, marge),
en formule **additive** ou **multiplicative** au choix de l'utilisateur.

`calculateOuvrage` (core) rend des valeurs non arrondies ; **`priceOf` (app) est le seul
endroit qui arrondit** la vente, et c'est ce prix arrondi qui est multiplié partout, pour
que le récapitulatif et le fichier rendu donnent le même total.

### Prix figés : SNAPSHOT vs MODE ACTUEL

C'est l'invariant le plus important du produit. Un devis remis à un client ne doit pas
changer de montant parce que la bibliothèque a évolué.

- Une **ligne de devis** recopie `nom`, `unite`, `puHtva`, `coutDirect` au moment du
  chiffrage (`figerLigneDevis`). Le devis retient son `contexte` : coût horaire, frais,
  marge, formule et valeur de K, TVA, date.
- Un devis est `brouillon` ou `fige`. Figé, il refuse ajout, modification, suppression.
- `ecartsDevis` chiffre la dérive avec la bibliothèque du jour **sans jamais l'appliquer**.
  Seul « Actualiser les prix », en brouillon, la applique.
- Un **métré rouvert** depuis l'historique porte `fige: true` : totaux et classeur
  réexporté reprennent les montants rendus. « Recalculer aux prix actuels » rebascule.

Ne jamais recalculer un prix depuis `ouvrageId` sur un devis ou un métré figé.

### Persistance : trois emplacements distincts

| Où | Quoi | Clé |
| --- | --- | --- |
| `localStorage` | Mémoire de chiffrage : bibliothèque, réglages, codes par commune, devis, chantiers | `generateur-devis-v2` |
| IndexedDB | Classeur reçu (`courant`) et historique des métrés (`archives`) | `generateur-devis` |
| Export JSON | La mémoire de chiffrage **sans le métré** (`donneesExportables`) | — |

`db.js` ne lève jamais : il rend `null` / `[]`, pour qu'un navigateur refusant IndexedDB
(navigation privée stricte) dégrade au lieu de casser.

L'export JSON ne contient jamais de métré ; à l'import, `metreApresImport` **préserve**
le métré en cours et ne reprend celui du fichier que s'il est complet. Le classeur en
mémoire n'est vidé que si le métré est effectivement remplacé — sans quoi une analyse
importée s'écrirait dans le classeur d'un autre marché.

### `normalizeState` : l'entonnoir unique des migrations

`normalizeState(source, { catalog, uid, onWarning })` remet en forme **tout** état, quelle
que soit son origine : `localStorage`, JSON importé, état neuf, archive rouverte. Toute
évolution de la forme des données passe par là, et par un test de migration.

Elle gère notamment : ancien couple `materiauId`/`quantiteMateriau` → `composants`,
devis unique → `devisList`, lignes de devis non figées → figées au prix du jour,
communes homonymes en conflit, TVA à 0 % (piège classique : `|| 25` l'écrasait).

### Chaîne de rapprochement d'un poste de métré

```
POSTE
  ↓  code déjà appris pour CETTE commune ?          → certitude
  ↓  similarité de libellé (findMatch, MATCH_THRESHOLD)
  ↓  ouvrage techniquement proche ?                 → proposition de réutilisation
  ↓  famille métier (classifyFamily)                → code interne ETA.007, MAC.012…
  ↓  recette technique (recettePourPoste)           → composition proposée
  ↓  saisie à la main
```

**Les codes appris sont propres à une commune** (`state.mappingCommunes`), jamais
globaux : deux marchés réutilisent volontiers le même numéro de poste pour des ouvrages
sans rapport. La commune est obligatoire avant analyse et figée pour sa durée
(`analysedCommune`). Le `refsMetre` du catalogue de départ n'est jamais appliqué comme
une certitude quand une commune est active.

`classifyFamily` fonctionne à **deux niveaux** : `FAMILY_RULES` ne contient que des mots
distinctifs (un seul métier), `FAMILY_HINTS` des mots de contexte consultés seulement à
défaut. C'est ce qui permet d'ajouter « joint » ou « toiture » à Étanchéité sans lui
faire voler « Isolation de la toiture plate ». La première règle qui matche gagne : un
mot générique placé dans `FAMILY_RULES` capture tout ce qui le contient.

### Lecture du classeur reçu

`rowsFromGrid` conserve la position d'origine de chaque ligne (`__sheet`, `__row`,
`__cols`) pour réécrire les prix dans le classeur sans le reconstruire. Les feuilles ont
des en-têtes différentes d'un lot à l'autre : `rowField` / `columnIndex` résolvent la
colonne **ligne par ligne**, pas une fois pour tout le classeur.

`detecterEnTete` accepte un en-tête sur deux lignes. `headerFor` applique
`HEADER_EXCLUSIONS` : un prix unitaire n'est jamais une colonne de total ou de montant,
et « Prix unitaire » n'est jamais une colonne d'unité. `decoderTexte` reconnaît le
Windows-1252 et l'UTF-16 avant de parser un CSV.

## Tests

`test/core.test.js` (~150 tests) couvre calcul, rapprochement, migration d'état,
invariants après remaniement, prix figés, cas limites d'import. Les deux parcours
`test/e2e/parcours.spec.mjs` couvrent ce que `core.js` ne voit pas : DOM assemblé,
IndexedDB, téléchargement réel.

Conventions des parcours navigateur : `retries: 0` (un échec intermittent ne prouve
rien), SheetJS servi depuis `node_modules` par interception de la requête CDN (la CI ne
doit pas dépendre de jsdelivr), classeur de test **écrit par le code** dans
`test/e2e/fixtures.mjs` plutôt que versionné en binaire.

Avant de pousser un changement d'interface, vérifier que le détecteur Impeccable ne
régresse pas. Deux constats connus et assumés y restent ouverts : la police Inter (voir
la section Design du README) et deux faux positifs `cramped-padding`.

## Trois listes à tenir à la main

Sans outil de build, trois endroits ne se mettent pas à jour tout seuls. Les oublier ne
casse rien à l'exécution locale — c'est ce qui les rend faciles à manquer.

1. **`APP_SHELL` dans `sw.js`.** Ajouter un fichier à l'application sans l'y déclarer le
   rend indisponible hors connexion. Et **bump `CACHE_NAME`** quand la liste change,
   sinon les visiteurs gardent l'ancien cache.
2. **Le `rm -rf` du job `deploy`** (`.github/workflows/deploy-pages.yml`). Un nouveau
   dossier d'outillage doit y être ajouté ; un fichier de l'application ne doit surtout
   pas s'y retrouver, il disparaîtrait du site publié sans que rien n'échoue.
3. **Le numéro de version**, ci-dessous.

## Version et déploiement

Le numéro vit **à deux endroits à tenir à jour ensemble à la main** : `version` dans
`package.json` et `APP_VERSION` dans `app.js`. Il s'affiche en haut à droite et dans
Paramètres → À propos. SemVer : le premier nombre change quand la forme des données
enregistrées change, ou quand une habitude de travail change. Documenter dans
`CHANGELOG.md` **pourquoi**, pas la liste des commits, et signaler les migrations qui
touchent les données existantes.

`.github/workflows/deploy-pages.yml` : les jobs `test` et `e2e` tournent sur chaque PR ;
`deploy` attend les deux et ne s'exécute jamais sur une PR. Le job `deploy` retire
l'outillage de développement de la copie qu'il publie, jamais du dépôt.

## Conventions de contribution

- Commits et PR en français, au présent, expliquant **le problème** avant la solution.
- Les commentaires de code expliquent pourquoi une décision a été prise, pas ce que fait
  la ligne — en particulier les garde-fous, qui sans cela se font « simplifier ».
- Les corrections de bug s'accompagnent d'un test qui échoue sans elles ; vérifier que le
  test sait échouer avant de le considérer comme une preuve.
- Une décision qui demande de lire un tableau passe par `askDialog`, jamais par
  `window.confirm` : le dialogue natif d'Android tronque le texte, sans colonnes ni
  alignement. `askDialog` se replie sur `window.confirm` si `<dialog>` manque.
- Les métrés réels servant de jeu d'essai local sont ignorés par git (`METRE_*.xlsx`) :
  ce sont des documents de marchés, ils ne sont pas publiés.
- Ne jamais faire disparaître une donnée silencieusement : archiver, signaler, ou refuser
  en le disant. Plusieurs bugs corrigés dans ce dépôt étaient des pertes silencieuses.
