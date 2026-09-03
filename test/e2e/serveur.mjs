/*
 * Serveur statique minimal pour les tests de bout en bout. Aucune dependance :
 * l'application n'a pas d'outil de build, ses tests non plus n'en demandent un.
 * Playwright le demarre et l'arrete lui-meme (voir playwright.config.mjs).
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = Number(process.env.PORT || 8123);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

http
  .createServer((requete, reponse) => {
    const chemin = decodeURIComponent(new URL(requete.url, "http://localhost").pathname);
    const cible = path.join(RACINE, chemin === "/" ? "index.html" : chemin);
    // Rien en dehors du depot, meme avec des « .. » dans l'URL.
    if (!cible.startsWith(RACINE) || !fs.existsSync(cible) || fs.statSync(cible).isDirectory()) {
      reponse.writeHead(404).end("introuvable");
      return;
    }
    reponse.writeHead(200, {
      "Content-Type": TYPES[path.extname(cible)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    fs.createReadStream(cible).pipe(reponse);
  })
  .listen(PORT, "127.0.0.1", () => console.log(`http://127.0.0.1:${PORT}`));
