/*
 * Service worker : rend l'application disponible hors connexion apres une
 * premiere visite en ligne. Bump CACHE_NAME si la liste des fichiers change.
 *
 * Strategie : reseau d'abord (avec un delai de 4 s), secours sur le cache. En ligne, l'utilisateur a
 * toujours la derniere version deployee (coherent avec le deploiement
 * automatique sur GitHub Pages) ; hors ligne, la derniere version mise en
 * cache pendant une visite reussie reste disponible.
 *
 * Le CDN SheetJS (xlsx) n'est pas mis en cache : l'import/export Excel reste
 * documente comme dependant d'une connexion, l'import/export CSV et JSON
 * restant disponibles sans elle.
 */
const CACHE_NAME = "devis-shell-v2";

const APP_SHELL = [
  "./",
  "index.html",
  "app.js",
  "core.js",
  "catalog.js",
  "styles.css",
  "favicon.svg",
  "manifest.webmanifest",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Fichier par fichier plutot que cache.addAll : celui-ci echoue en bloc si une
      // seule ressource repond 404, et l'application perdait alors tout le mode hors
      // ligne a cause d'une icone manquante.
      Promise.all(APP_SHELL.map((url) => cache.add(url).catch(() => {}))),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(networkFirst(event.request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const sameOrigin = new URL(request.url).origin === self.location.origin;
  try {
    // fetch(request) peut sinon etre servi depuis le cache HTTP du navigateur
    // (selon les en-tetes Cache-Control de GitHub Pages) sans repasser par le
    // reseau : le "network first" ne garantissait alors pas vraiment la
    // derniere version deployee. On force une requete fraiche pour les
    // fichiers de l'application (pas pour le CDN externe, laisse inchange).
    const response = sameOrigin ? await fetchAvecDelai(cacheBustedUrl(request.url)) : await fetch(request);
    if (response.ok && sameOrigin) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    // Page jamais visitee hors ligne : au moins ouvrir l'app plutot que rien.
    if (request.mode === "navigate") {
      const fallback = await cache.match("index.html");
      if (fallback) return fallback;
    }
    throw new Error("hors ligne et rien en cache pour cette ressource");
  }
}

/*
 * Un reseau qui ne repond pas n'est pas une absence de reseau : portail captif d'hotel,
 * 3G qui decroche sur un chantier. Sans delai, "reseau d'abord" attendait indefiniment
 * au lieu de servir le cache, et l'application restait blanche.
 */
function fetchAvecDelai(url, delai = 4000) {
  return Promise.race([
    fetch(url),
    new Promise((_, reject) => setTimeout(() => reject(new Error("délai réseau dépassé")), delai)),
  ]);
}

function cacheBustedUrl(url) {
  const busted = new URL(url);
  busted.searchParams.set("_sw", Date.now().toString());
  return busted.toString();
}
