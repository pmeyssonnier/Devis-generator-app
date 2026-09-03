import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { ecrireClasseur, lireGrille, PREMIER_POSTE, COLONNE_PU } from "./fixtures.mjs";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const CSV = path.join(ICI, "fixtures", "metre-simple.csv");
const CDN_XLSX = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
const XLSX_LOCAL = path.join(ICI, "..", "..", "node_modules", "xlsx", "dist", "xlsx.full.min.js");

let travail;
test.beforeAll(() => {
  travail = fs.mkdtempSync(path.join(os.tmpdir(), "devis-e2e-"));
});
test.afterAll(() => {
  fs.rmSync(travail, { recursive: true, force: true });
});

test.beforeEach(async ({ page, context }) => {
  // SheetJS servi depuis node_modules : la CI ne doit pas dependre d'un CDN, ni
  // rougir parce que jsdelivr a eternue.
  await context.route(CDN_XLSX, (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: fs.readFileSync(XLSX_LOCAL, "utf-8") }),
  );
  // Le service worker mettrait l'application en cache entre deux rechargements :
  // on veut mesurer IndexedDB, pas lui.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "serviceWorker", {
      value: { register: () => Promise.reject(new Error("désactivé pour les tests")) },
      configurable: true,
    });
  });
  const erreurs = [];
  page.on("pageerror", (erreur) => erreurs.push(String(erreur)));
  page.on("dialog", (dialogue) => dialogue.accept());
  page.__erreurs = erreurs;

  await page.goto("/index.html");
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(
    () =>
      new Promise((fini) => {
        const requete = indexedDB.deleteDatabase("generateur-devis");
        requete.onsuccess = requete.onerror = requete.onblocked = () => fini();
      }),
  );
  await page.reload();
  await expect(page.locator("#app-version")).toHaveText(/^v\d+\.\d+\.\d+$/);
});

test.afterEach(async ({ page }) => {
  expect(page.__erreurs, "aucune erreur JavaScript pendant le parcours").toEqual([]);
});

const etat = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("generateur-devis-v2")));

async function telecharger(page, selecteur, dossier) {
  const attente = page.waitForEvent("download");
  await page.click(selecteur);
  const telechargement = await attente;
  const cible = path.join(dossier, telechargement.suggestedFilename());
  fs.copyFileSync(await telechargement.path(), cible);
  return cible;
}

test("CSV : importer, analyser, confirmer, exporter le récapitulatif", async ({ page }) => {
  await page.click('[data-view="metre"]');
  await page.setInputFiles("#metre-file", CSV);
  await expect(page.locator("#metre-status")).toContainText("3 poste(s) lu(s)");

  // La commune est obligatoire : sans elle, l'analyse doit refuser de partir.
  await page.click("#analyse-metre");
  await expect(page.locator("#toast-text")).toContainText("Indiquez la commune");
  expect((await etat(page)).metre.analysed).toHaveLength(0);

  await page.fill("#metre-commune", "Commune de test");
  await page.click("#analyse-metre");
  await expect(page.locator("#metre-lines tr")).toHaveCount(3);

  const analyse = (await etat(page)).metre;
  expect(analyse.analysedCommune).toBe("Commune de test");
  expect(analyse.analysed.map((ligne) => ligne.numero)).toEqual(["01.01", "01.02", "01.03"]);
  const rapproches = analyse.analysed.filter((ligne) => ligne.ouvrageId);
  expect(rapproches.length, "les trois libellés existent dans le catalogue de départ").toBe(3);

  // Confirmer et mémoriser : les codes doivent devenir propres à cette commune.
  await page.click("#confirm-matches");
  await expect(page.locator("#app-dialog")).toBeVisible();
  await expect(page.locator("#app-dialog-body")).toContainText("Commune de test");
  await page.click("#app-dialog-ok");
  await expect(page.locator("#toast-text")).toContainText("correspondance(s) mémorisée(s)");

  const apres = await etat(page);
  const codes = apres.mappingCommunes[Object.keys(apres.mappingCommunes)[0]];
  expect(Object.keys(codes).sort()).toEqual(["01.01", "01.02", "01.03"]);
  expect(apres.metre.analysed.every((ligne) => ligne.manual)).toBe(true);

  const fichier = await telecharger(page, "#export-metre", travail);
  // exportCsv entoure chaque champ de guillemets et sépare par « ; ».
  const lignes = fs
    .readFileSync(fichier, "utf-8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((ligne) => ligne.split(";").map((champ) => champ.replace(/^"|"$/g, "").replace(/""/g, '"')));
  expect(lignes.some((ligne) => ligne[0] === "Détail des postes")).toBe(true);

  const enTete = lignes.find((ligne) => ligne[0] === "Lot" && ligne.includes("PU HTVA"));
  expect(enTete, "l'en-tête du détail").toBeTruthy();
  const colonne = (nom) => enTete.indexOf(nom);
  const detail = lignes.find((ligne) => ligne[colonne("Poste")] === "01.01" && ligne.length === enTete.length);
  expect(detail, "la ligne de détail du poste 01.01").toBeTruthy();
  expect(detail[colonne("Description")]).toBe("Peinture des murs intérieurs, deux couches");
  expect(detail[colonne("Statut")]).toBe("OK");
  expect(Number(detail[colonne("PU HTVA")]), "prix unitaire chiffré").toBeGreaterThan(0);
  expect(Number(detail[colonne("Montant HTVA")]), "montant chiffré").toBeGreaterThan(0);
});

test("XLSX : le métré et son classeur survivent à un rechargement, et l'export retrouve la bonne colonne", async ({ page }) => {
  const source = ecrireClasseur(travail);

  await page.click('[data-view="metre"]');
  await page.setInputFiles("#metre-file", source);
  await expect(page.locator("#metre-status")).toContainText("3 poste(s) lu(s)");

  // En-tête sur deux lignes : les colonnes proposées doivent porter le libellé complet.
  await expect(page.locator("#map-quantite")).toHaveValue("Quantité présumée");
  await expect(page.locator("#map-prix")).toHaveValue("Prix unitaire HTVA");

  await page.fill("#metre-commune", "Commune de test");
  await page.click("#analyse-metre");
  await expect(page.locator("#metre-lines tr")).toHaveCount(3);
  const avant = await etat(page);
  const totalAvant = await page.locator("#metre-status").textContent();

  // Rechargement complet : rien n'est en mémoire, tout doit revenir d'IndexedDB.
  await page.reload();
  await page.click('[data-view="metre"]');
  await expect(page.locator("#metre-lines tr")).toHaveCount(3);
  const apres = await etat(page);
  expect(apres.metre.id).toBe(avant.metre.id);
  expect(apres.metre.rows).toHaveLength(3);
  expect(await page.locator("#metre-status").textContent()).toBe(totalAvant);

  // La preuve que le classeur reçu a bien été restauré : « Compléter le fichier
  // reçu » relit ces octets. Sans IndexedDB, il refuserait faute de fichier.
  const rendu = await telecharger(page, "#export-metre-source", travail);
  await expect(page.locator("#toast-text")).toContainText("prix reporté(s) dans le fichier d’origine");

  const grille = lireGrille(rendu);
  const prix = [0, 1, 2].map((decalage) => grille[PREMIER_POSTE + decalage][COLONNE_PU]);
  expect(prix.every((valeur) => typeof valeur === "number" && valeur > 0)).toBe(true);
  // La colonne voisine s'appelle aussi « Prix » : elle doit rester vide.
  expect([0, 1, 2].map((decalage) => grille[PREMIER_POSTE + decalage][COLONNE_PU + 1])).toEqual(["", "", ""]);
  // Les deux lignes d'en-tête sont intactes.
  expect(grille[4][1]).toBe("Désignation des ouvrages");
  expect(grille[5][4]).toBe("unitaire HTVA");
});
