/*
 * db.js — stockage des donnees lourdes du metre, hors de localStorage.
 *
 * localStorage plafonne autour de 5 Mo, sert deja a toute la bibliotheque, et ne sait
 * stocker que du texte : les octets d'un classeur Excel y tiennent mal. Consequence
 * jusqu'ici : le fichier recu du pouvoir adjudicateur n'existait qu'en memoire vive,
 * et refermer l'application obligeait a le reimporter — donc a refaire toute l'analyse
 * — juste pour pouvoir le completer.
 *
 * IndexedDB garde les octets tels quels et n'a pas cette limite. On y range :
 *   - "courant"  : le classeur du metre en cours, pour survivre a un rechargement ;
 *   - "archives" : les metres deja chiffres, pour pouvoir en rouvrir un.
 *
 * Toutes les fonctions renvoient une promesse et ne jettent jamais : un navigateur qui
 * refuse IndexedDB (navigation privee stricte, quota) doit degrader l'application, pas
 * l'empecher de fonctionner. L'appelant recoit null ou un tableau vide.
 */
(function (root) {
  "use strict";

  const DB_NAME = "generateur-devis";
  const DB_VERSION = 1;
  const COURANT = "courant";
  const ARCHIVES = "archives";
  // Clef unique du classeur en cours : un seul metre est ouvert a la fois.
  const CLEF_COURANT = "source";

  let ouverture = null;

  function open() {
    if (ouverture) return ouverture;
    ouverture = new Promise((resolve) => {
      if (!root.indexedDB) return resolve(null);
      let requete;
      try {
        requete = root.indexedDB.open(DB_NAME, DB_VERSION);
      } catch {
        return resolve(null);
      }
      requete.onupgradeneeded = () => {
        const db = requete.result;
        if (!db.objectStoreNames.contains(COURANT)) db.createObjectStore(COURANT);
        if (!db.objectStoreNames.contains(ARCHIVES)) db.createObjectStore(ARCHIVES, { keyPath: "id" });
      };
      requete.onsuccess = () => resolve(requete.result);
      requete.onerror = () => resolve(null);
      requete.onblocked = () => resolve(null);
    });
    return ouverture;
  }

  function transaction(storeName, mode, action) {
    return open().then(
      (db) =>
        new Promise((resolve) => {
          if (!db) return resolve(null);
          let store;
          try {
            store = db.transaction(storeName, mode).objectStore(storeName);
          } catch {
            return resolve(null);
          }
          const requete = action(store);
          requete.onsuccess = () => resolve(requete.result ?? null);
          requete.onerror = () => resolve(null);
        }),
    );
  }

  /* ------------------------------------------------------------------ courant */

  // Le classeur recu, avec le nom de fichier et l'identifiant du metre auquel il
  // appartient : au rechargement, on ne le restaure que s'il correspond bien au metre
  // affiche (un import JSON a pu changer de marche entre-temps).
  function saveSource(metreId, fileName, arrayBuffer) {
    if (!arrayBuffer) return Promise.resolve(false);
    return transaction(COURANT, "readwrite", (store) =>
      store.put({ metreId, fileName, octets: arrayBuffer, date: Date.now() }, CLEF_COURANT),
    ).then((resultat) => resultat !== null);
  }

  function loadSource() {
    return transaction(COURANT, "readonly", (store) => store.get(CLEF_COURANT));
  }

  function clearSource() {
    return transaction(COURANT, "readwrite", (store) => store.delete(CLEF_COURANT));
  }

  /* ----------------------------------------------------------------- archives */

  // Un metre archive se suffit a lui-meme : ses lignes brutes, son analyse, son
  // mapping de colonnes et les octets du classeur. Le rouvrir doit rendre l'ecran
  // exactement dans l'etat ou il a ete quitte, export compris.
  function saveArchive(entree) {
    if (!entree || !entree.id) return Promise.resolve(false);
    return transaction(ARCHIVES, "readwrite", (store) => store.put(entree)).then((resultat) => resultat !== null);
  }

  function loadArchive(id) {
    return transaction(ARCHIVES, "readonly", (store) => store.get(id));
  }

  function deleteArchive(id) {
    return transaction(ARCHIVES, "readwrite", (store) => store.delete(id));
  }

  /*
   * Liste des archives sans leurs donnees lourdes : la vue n'a besoin que du nom, de
   * la commune, de la date et du resume. Charger les lignes de dix metres pour
   * afficher une liste ferait entrer plusieurs Mo en memoire pour rien.
   */
  function listArchives() {
    return open().then(
      (db) =>
        new Promise((resolve) => {
          if (!db) return resolve([]);
          let store;
          try {
            store = db.transaction(ARCHIVES, "readonly").objectStore(ARCHIVES);
          } catch {
            return resolve([]);
          }
          const entrees = [];
          const curseur = store.openCursor();
          curseur.onsuccess = () => {
            const position = curseur.result;
            if (!position) {
              entrees.sort((a, b) => b.date - a.date);
              return resolve(entrees);
            }
            const { id, fileName, commune, date, resume } = position.value;
            entrees.push({ id, fileName, commune, date, resume });
            position.continue();
          };
          curseur.onerror = () => resolve([]);
        }),
    );
  }

  root.DGStore = {
    saveSource,
    loadSource,
    clearSource,
    saveArchive,
    loadArchive,
    deleteArchive,
    listArchives,
  };
})(globalThis);
