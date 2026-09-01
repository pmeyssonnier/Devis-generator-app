/*
 * Tests de la logique metier. Aucun navigateur requis :
 *   node --test test/
 */
const test = require("node:test");
const assert = require("node:assert/strict");

require("../catalog.js");
require("../core.js");
const C = globalThis.DGCore;
const CATALOG = globalThis.DGCatalog;

/* ------------------------------------------------------------------ nombres */

test("parseNumber accepte les formats rencontres dans les metres", () => {
  assert.equal(C.parseNumber(240), 240);
  assert.equal(C.parseNumber("210"), 210);
  assert.equal(C.parseNumber("12,5"), 12.5);
  assert.equal(C.parseNumber("1 234,56"), 1234.56);
  assert.equal(C.parseNumber("1.234,56"), 1234.56);
  assert.equal(C.parseNumber("1,234.56"), 1234.56);
  assert.ok(Number.isNaN(C.parseNumber("")));
  assert.ok(Number.isNaN(C.parseNumber("pour memoire")));
});

test("les formules simples des cellules Excel sont evaluees", () => {
  assert.equal(C.parseNumber("=32*7.5"), 240);
  assert.equal(C.parseNumber("=140+65"), 205);
  assert.equal(C.parseNumber("=(2+3)*4"), 20);
  assert.equal(C.parseNumber("=2+3*4"), 14);
  assert.equal(C.parseNumber("=-5+8"), 3);
});

test("une formule non arithmetique n'est jamais executee", () => {
  // Le remplacement de Function() par un evaluateur dedie interdit tout code.
  globalThis.__pwned = false;
  assert.ok(Number.isNaN(C.parseNumber("=globalThis.__pwned=true")));
  assert.ok(Number.isNaN(C.parseNumber("=SUM(A1:A9)")));
  assert.ok(Number.isNaN(C.parseNumber("=1+")));
  assert.ok(Number.isNaN(C.parseNumber("=(1+2")));
  assert.equal(globalThis.__pwned, false);
});

/* ------------------------------------------------------------------- unites */

test("les unites des cahiers des charges sont ramenees a une forme commune", () => {
  assert.equal(C.normalizeUnit("m²"), "m2");
  assert.equal(C.normalizeUnit("M2"), "m2");
  assert.equal(C.normalizeUnit("ML"), "m");
  assert.equal(C.normalizeUnit("m.l."), "m");
  assert.equal(C.normalizeUnit("PC"), "pce");
  assert.equal(C.normalizeUnit("pièce"), "pce");
  assert.equal(C.normalizeUnit("FF"), "ff");
  assert.equal(C.normalizeUnit(""), "");
});

test("une unite de longueur n'est pas compatible avec une unite de surface", () => {
  assert.ok(C.unitsCompatible("m2", "m²"));
  assert.ok(!C.unitsCompatible("m", "m2"));
  assert.ok(C.unitsCompatible("FF", "m2"), "un forfait couvre n'importe quelle unite");
  assert.ok(C.unitsCompatible("m2", ""), "unite absente : on ne bloque pas");
});

/* ------------------------------------------------------------------- calcul */

test("le prix de vente suit la decomposition du cahier des charges", () => {
  const settings = { coutHoraire: 50, fraisGeneraux: 10, fraisChantier: 5, imprevus: 5, marge: 10 };
  const ouvrage = { heures: 0.5, quantiteMateriau: 2, materiel: 5 };
  const materiau = { prix: 10 };
  const calc = C.calculateOuvrage(ouvrage, settings, materiau);

  assert.equal(calc.mainOeuvre, 25);
  assert.equal(calc.matieres, 20);
  assert.equal(calc.materiel, 5);
  assert.equal(calc.direct, 50);
  assert.equal(calc.coefficientK, 1.3);
  assert.equal(C.roundMoney(calc.fraisMarge), 15);
  assert.equal(C.roundMoney(calc.vente), 65);
});

test("un ouvrage sans materiau reste calculable", () => {
  const calc = C.calculateOuvrage({ heures: 1 }, { coutHoraire: 40, marge: 0 }, undefined);
  assert.equal(calc.matieres, 0);
  assert.equal(calc.vente, 40);
});

/* -------------------------------------------------------------------- codes */

test("les separateurs et la casse sont uniformises, les zeros de tete conserves", () => {
  assert.equal(C.normalizeRef(" 10.01 "), "10.01");
  assert.equal(C.normalizeRef("3-04-A"), "3.04.a");
  assert.equal(C.normalizeRef("3/04/a"), "3.04.a");
});

test("un zero de tete distingue deux codifications differentes", () => {
  // Schaerbeek numerote 01.01 (lot 01, piquage) la ou Bruxelles ecrit 1.01
  // (lot 1, installation de chantier) : confondre les deux fausserait le prix.
  assert.notEqual(C.normalizeRef("01.01"), C.normalizeRef("1.01"));
});

test("le code interne suit la famille de l'ouvrage", () => {
  assert.equal(C.internalCodePrefix("Enduit de façade minéral armé"), "FAC");
  assert.equal(C.internalCodePrefix("Démolition de cloison légère"), "DEM");
  assert.equal(C.internalCodePrefix("Objet non classable"), "OUV");
  assert.equal(C.nextInternalCode(new Set(["FAC.001"]), "Enduit de façade"), "FAC.002");
});

test("stripLeadingCode retire le code place devant le libelle", () => {
  assert.equal(C.stripLeadingCode("03.02 - Enduit de façade"), "Enduit de façade");
  assert.equal(C.stripLeadingCode("Enduit de façade"), "Enduit de façade");
});

/* ------------------------------------------------------------ rapprochement */

const ouvragesTest = [
  {
    id: "a",
    nom: "Enduit de façade minéral armé",
    unite: "m2",
    refsMetre: ["03.02", "2.05"],
    motsCles: "enduit facade mineral arme crepi treillis",
  },
  {
    id: "b",
    nom: "Peinture murs intérieurs, deux couches",
    unite: "m2",
    refsMetre: ["07.01"],
    motsCles: "peinture murs interieurs deux couches",
  },
  {
    id: "c",
    nom: "Évacuation PVC diamètre 110",
    unite: "m",
    refsMetre: ["04.04"],
    motsCles: "evacuation pvc 110 descente eau pluviale",
  },
];

test("un code deja rencontre est reconnu avec certitude", () => {
  const match = C.findMatch({ poste: "2.05", numero: "2.05", description: "Libellé inconnu", unite: "m²" }, ouvragesTest, new Map());
  assert.equal(match.ouvrageId, "a");
  assert.equal(match.confidence, 1);
  assert.equal(match.reason, "code connu");
});

test("un code d'une autre codification n'est pas confondu", () => {
  // "2.05" est rattache a l'ouvrage a ; "02.05" ne l'est pas.
  const match = C.findMatch({ poste: "02.05", numero: "02.05", description: "", unite: "m2" }, ouvragesTest, new Map());
  assert.equal(match.ouvrageId, "");
});

test("a defaut de code, le libelle rapproche le bon ouvrage", () => {
  const match = C.findMatch(
    { poste: "99.99", numero: "99.99", description: "Mise en peinture des murs intérieurs", unite: "m²" },
    ouvragesTest,
    new Map(),
  );
  assert.equal(match.ouvrageId, "b");
  assert.equal(match.reason, "libellé");
  assert.ok(match.confidence > 0.3 && match.confidence < 1);
});

test("une unite incompatible empeche le rapprochement mais reste signalee", () => {
  // 10 metres de tuyauterie ne doivent pas etre chiffres avec un ouvrage au m2.
  const match = C.findMatch(
    { poste: "99.98", numero: "99.98", description: "Peinture murs intérieurs deux couches", unite: "m" },
    ouvragesTest,
    new Map(),
  );
  assert.equal(match.ouvrageId, "");
  assert.equal(match.unitWarning, true);
  assert.equal(match.suggestionId, "b", "la piste la plus proche est proposee a l'utilisateur");
});

test("un libelle sans rapport ne declenche aucune correspondance", () => {
  const match = C.findMatch(
    { poste: "50.01", numero: "50.01", description: "Fourniture de mobilier de bureau", unite: "pce" },
    ouvragesTest,
    new Map(),
  );
  assert.equal(match.ouvrageId, "");
  assert.equal(match.unitWarning, false);
});

/* ---------------------------------------------------------------- doublons */

test("deux ouvrages proches et de meme unite sont signales comme doublons", () => {
  const ouvrages = [
    { id: "1", nom: "Enduit de façade minéral", unite: "m2" },
    { id: "2", nom: "Enduit façade minéral armé", unite: "m2" },
    { id: "3", nom: "Carrelage de sol grès cérame", unite: "m2" },
    { id: "4", nom: "Enduit de façade minéral", unite: "m" },
  ];
  const prices = { 1: 60, 2: 62, 3: 40, 4: 60 };
  const duplicates = C.findDuplicates(ouvrages, (o) => prices[o.id]);
  assert.equal(duplicates.length, 1);
  assert.deepEqual(
    duplicates[0].items.map((o) => o.id).sort(),
    ["1", "2"],
    "les unites differentes ne sont pas comparees",
  );
});

/* ------------------------------------------------------------ lecture metre */

// Reproduit la mise en page d'un inventaire avec titres de lot et sous-totaux.
const gridSchaerbeek = [
  ["Commune de Schaerbeek", "", "", "", "", "", "", ""],
  ["Référence", "CSC 2026-TP-0147", "", "", "", "", "", ""],
  ["N°", "Poste", "Désignation des ouvrages", "Nature", "Unité", "Quantité", "PU HTVA", "Montant HTVA"],
  ["LOT 00 — INSTALLATIONS DE CHANTIER", "", "", "", "", "", "", ""],
  ["1", "00.01", "Installation de chantier", "FF", "FF", "1", "", ""],
  ["2", "00.02", "Échafaudage de façade", "QP", "m2", "180", "", ""],
  ["", "", "Sous-total lot 00", "", "", "", "", ""],
  ["", "", "", "", "", "", "", ""],
  ["LOT 01 — DÉMOLITIONS ET DÉPOSES", "", "", "", "", "", "", ""],
  ["3", "01.01", "Piquage d'enduit dégradé", "QP", "m2", "160", "", ""],
  ["4", "01.02", "", "QP", "m2", "38", "", ""],
];

test("les lignes de poste sont extraites, les titres et sous-totaux ignores", () => {
  const parsed = C.rowsFromGrid(gridSchaerbeek, "MÉTRÉ");
  assert.equal(parsed.headerIndex, 2);
  assert.equal(parsed.rows.length, 3, "3 postes exploitables");
  assert.equal(parsed.skipped, 1, "le poste 01.02 sans désignation est compté comme ignoré");
  assert.deepEqual(
    parsed.rows.map((row) => row.Poste),
    ["00.01", "00.02", "01.01"],
  );
});

test("le lot courant est reporte sur les postes qui le suivent", () => {
  const parsed = C.rowsFromGrid(gridSchaerbeek, "MÉTRÉ");
  assert.match(parsed.rows[0].__lot, /LOT 00/);
  assert.match(parsed.rows[2].__lot, /LOT 01/);
});

test("la position d'origine est conservee pour pouvoir completer le fichier recu", () => {
  const parsed = C.rowsFromGrid(gridSchaerbeek, "MÉTRÉ");
  assert.equal(parsed.rows[0].__sheet, "MÉTRÉ");
  assert.equal(parsed.rows[0].__row, 4, "ligne 5 du fichier, index 4");
  assert.equal(parsed.rows[0].__cols["PU HTVA"], 6, "colonne G");
});

test("la mise en page Bruxelles (une feuille par lot) est lue aussi", () => {
  const grid = [
    ["Ville de Bruxelles", "", "", "", "", ""],
    ["Lot", "Lot 1 - Chantier et démolitions", "", "", "", ""],
    ["", "", "", "", "", ""],
    ["N° poste", "Désignation des travaux", "U", "Qté", "P.U. (€)", "Total (€)"],
    ["1.01", "Installation du chantier", "FF", "1", "", ""],
    ["1.02", "Échafaudage de façade", "m²", "240", "", ""],
  ];
  const parsed = C.rowsFromGrid(grid, "Lot 1 - Chantier et démolitions");
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].__lot, "Lot 1 - Chantier et démolitions");
  assert.equal(C.findHeader(parsed.headers, C.HEADER_CANDIDATES.prixUnitaire), "P.U. (€)");
  assert.equal(C.findHeader(parsed.headers, C.HEADER_CANDIDATES.quantite), "Qté");
  assert.equal(C.findHeader(parsed.headers, C.HEADER_CANDIDATES.poste), "N° poste");
});

test("le tableau recapitulatif en bas de feuille n'est pas chiffre", () => {
  // Un inventaire se termine souvent par un rappel "code de lot / intitule",
  // sans unite ni quantite : le compter reviendrait a doubler les travaux.
  const grid = [
    ["N°", "Poste", "Désignation des ouvrages", "Nature", "Unité", "Quantité", "PU HTVA"],
    ["37", "07.01", "Peinture murs intérieurs, deux couches", "QP", "m2", "320", ""],
    ["", "", "Sous-total lot 07", "", "", "", ""],
    ["", "07", "Peintures et finitions", "", "", "", ""],
    ["", "08", "Menuiseries et sanitaire", "", "", "", ""],
  ];
  const parsed = C.rowsFromGrid(grid, "MÉTRÉ");
  assert.deepEqual(
    parsed.rows.map((row) => row.Poste),
    ["07.01"],
  );
  assert.equal(parsed.skipped, 2);
});

test("un poste garde sa place meme si la quantite est a determiner", () => {
  const grid = [
    ["N° poste", "Désignation des travaux", "U", "Qté", "P.U. (€)"],
    ["2.04", "Nettoyage de la façade sous haute pression", "m²", "", ""],
  ];
  const parsed = C.rowsFromGrid(grid, "Lot 2");
  assert.equal(parsed.rows.length, 1, "l'unité suffit à identifier un poste chiffrable");
  assert.equal(parsed.skipped, 0);
});

test("un fichier sans en-tete reconnaissable ne produit aucune ligne", () => {
  const parsed = C.rowsFromGrid([["a", "b"], ["1", "2"]], "Feuille");
  assert.equal(parsed.headerIndex, -1);
  assert.equal(parsed.rows.length, 0);
});

test("le separateur CSV est detecte automatiquement", () => {
  const grid = C.parseDelimited("Poste;Désignation;U;Qté\n01.01;Piquage;m2;160");
  assert.deepEqual(grid[1], ["01.01", "Piquage", "m2", "160"]);
});

/* ------------------------------------------------------------------ catalogue */

test("le catalogue de demarrage est coherent", () => {
  const unites = new Set(CATALOG.ouvrages.map((o) => C.normalizeUnit(o.unite)));
  assert.ok(unites.size > 1);

  const nomsMateriaux = new Set(CATALOG.materiaux.map((m) => m.nom));
  CATALOG.ouvrages.forEach((ouvrage) => {
    assert.ok(nomsMateriaux.has(ouvrage.materiau), `matériau inconnu : ${ouvrage.materiau}`);
  });

  const refs = CATALOG.ouvrages.map((o) => o.ref);
  assert.equal(new Set(refs).size, refs.length, "pas de référence en double");

  Object.keys(CATALOG.referencesConnues).forEach((ref) => {
    assert.ok(refs.includes(ref), `référence apprise orpheline : ${ref}`);
  });
});

test("aucun code de metre n'est rattache a deux ouvrages", () => {
  // Codes du catalogue et codes appris confondus : un meme code ne peut designer
  // qu'un seul ouvrage, sinon le chiffrage automatique devient arbitraire.
  const seen = new Map();
  const claim = (code, owner) => {
    const key = C.normalizeRef(code);
    assert.ok(!seen.has(key), `${code} est rattaché à ${seen.get(key)} et à ${owner}`);
    seen.set(key, owner);
  };
  CATALOG.ouvrages.forEach((ouvrage) => claim(ouvrage.ref, ouvrage.ref));
  Object.entries(CATALOG.referencesConnues).forEach(([ref, aliases]) => {
    aliases.forEach((alias) => claim(alias, ref));
  });
});

test("chaque ouvrage du catalogue est effectivement installe", () => {
  // Deux entrees portant le meme nom seraient fusionnees au demarrage.
  const noms = CATALOG.ouvrages.map((ouvrage) => C.normalizeText(ouvrage.nom));
  assert.equal(new Set(noms).size, noms.length, "pas de libellé en double");
});
