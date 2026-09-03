/*
 * Le classeur de test est ECRIT ici plutot que versionne en binaire : sa forme est
 * ainsi lisible et modifiable dans le diff. Il cumule volontairement ce qui a deja
 * mis l'import en defaut — titre en capitales, phrase d'introduction, lignes vides,
 * en-tete reparti sur deux lignes, et deux colonnes nommees « Prix ».
 */
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

export const GRILLE_METRE = [
  ["MÉTRÉ RÉCAPITULATIF — COMMUNE DE TEST"],
  [],
  ["Description des travaux et quantités présumées"],
  [],
  ["N°", "Désignation des ouvrages", "Unité", "Quantité", "Prix", "Prix"],
  ["poste", "", "", "présumée", "unitaire HTVA", "total HTVA"],
  ["01.01", "Peinture des murs intérieurs, deux couches", "m2", 50, "", ""],
  ["01.02", "Carrelage de sol en grès cérame", "m2", 30, "", ""],
  ["01.03", "Enduit de façade sur maçonnerie", "m2", 120, "", ""],
];

// Ligne de la grille (0-based) ou commencent les postes, et colonne du prix unitaire.
export const PREMIER_POSTE = 6;
export const COLONNE_PU = 4;

export function ecrireClasseur(dossier) {
  const feuille = XLSX.utils.aoa_to_sheet(GRILLE_METRE);
  const classeur = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(classeur, feuille, "Lot 1");
  const cible = path.join(dossier, "metre-entete-double.xlsx");
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(cible, XLSX.write(classeur, { type: "buffer", bookType: "xlsx" }));
  return cible;
}

export function lireGrille(fichier) {
  const classeur = XLSX.read(fs.readFileSync(fichier), { type: "buffer" });
  const feuille = classeur.Sheets[classeur.SheetNames[0]];
  return XLSX.utils.sheet_to_json(feuille, { header: 1, raw: true, defval: null });
}
