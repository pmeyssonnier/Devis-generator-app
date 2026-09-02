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

const SETTINGS = { coutHoraire: 50, fraisGeneraux: 10, fraisChantier: 5, imprevus: 5, marge: 10 };
const MATERIAUX = [
  { id: "m1", nom: "Isolant", unite: "m2", prix: 10 },
  { id: "m2", nom: "Enduit", unite: "kg", prix: 4 },
  { id: "m3", nom: "Accessoires", unite: "m2", prix: 2.5 },
];

test("le prix de vente suit la decomposition du cahier des charges", () => {
  const ouvrage = { heures: 0.5, composants: [{ materiauId: "m1", quantite: 2 }], materiel: 5 };
  const calc = C.calculateOuvrage(ouvrage, SETTINGS, MATERIAUX);

  assert.equal(calc.mainOeuvre, 25);
  assert.equal(calc.matieres, 20);
  assert.equal(calc.materiel, 5);
  assert.equal(calc.direct, 50);
  assert.equal(calc.coefficientK, 1.3);
  assert.equal(C.roundMoney(calc.fraisMarge), 15);
  assert.equal(C.roundMoney(calc.vente), 65);
});

test("la formule du coefficient K est additive par defaut", () => {
  assert.equal(C.coefficientK(SETTINGS), 1.3);
  assert.equal(C.coefficientK({ ...SETTINGS, formuleK: "additive" }), 1.3);
  assert.equal(C.coefficientK({ ...SETTINGS, formuleK: "inconnue" }), 1.3, "une valeur inattendue retombe sur l'additif");
});

test("la formule multiplicative empile chaque taux sur la base deja majoree", () => {
  const k = C.coefficientK({ ...SETTINGS, formuleK: "multiplicative" });
  // (1+0.10) * (1+0.05) * (1+0.05) * (1+0.10) = 1.334025
  assert.equal(Math.round(k * 1e6) / 1e6, 1.334025);
  assert.ok(k > C.coefficientK(SETTINGS), "le multiplicatif est toujours au moins egal a l'additif pour des taux positifs");
});

test("un ouvrage combine plusieurs fournitures", () => {
  const ouvrage = {
    heures: 0.5,
    materiel: 5,
    composants: [
      { materiauId: "m1", quantite: 1 },
      { materiauId: "m2", quantite: 2 },
      { materiauId: "m3", quantite: 1 },
    ],
  };
  const calc = C.calculateOuvrage(ouvrage, SETTINGS, MATERIAUX);

  assert.equal(calc.matieres, 20.5, "10 + 8 + 2,5");
  assert.equal(calc.direct, 50.5);
  assert.deepEqual(
    calc.composants.map((composant) => [composant.nom, composant.montant]),
    [
      ["Isolant", 10],
      ["Enduit", 8],
      ["Accessoires", 2.5],
    ],
    "chaque fourniture reste justifiable ligne par ligne",
  );
});

test("une bibliotheque enregistree avec un seul materiau reste calculable", () => {
  const ancien = { heures: 0.5, materiauId: "m1", quantiteMateriau: 2, materiel: 5 };
  assert.deepEqual(C.composantsOf(ancien), [{ materiauId: "m1", quantite: 2 }]);
  assert.equal(C.calculateOuvrage(ancien, SETTINGS, MATERIAUX).matieres, 20);
});

test("un materiau supprime est signale, pas chiffre en silence", () => {
  const ouvrage = { heures: 1, composants: [{ materiauId: "disparu", quantite: 3 }] };
  const calc = C.calculateOuvrage(ouvrage, SETTINGS, MATERIAUX);
  assert.equal(calc.matieres, 0);
  assert.equal(calc.composants[0].introuvable, true);
});

test("les materiaux se resolvent depuis un tableau, une Map ou une fonction", () => {
  const ouvrage = { composants: [{ materiauId: "m2", quantite: 3 }] };
  const attendu = 12;
  const map = new Map(MATERIAUX.map((materiau) => [materiau.id, materiau]));
  assert.equal(C.calculateOuvrage(ouvrage, SETTINGS, MATERIAUX).matieres, attendu);
  assert.equal(C.calculateOuvrage(ouvrage, SETTINGS, map).matieres, attendu);
  assert.equal(
    C.calculateOuvrage(ouvrage, SETTINGS, (id) => MATERIAUX.find((materiau) => materiau.id === id)).matieres,
    attendu,
  );
});

test("un ouvrage sans materiau reste calculable", () => {
  const calc = C.calculateOuvrage({ heures: 1 }, { coutHoraire: 40, marge: 0 }, MATERIAUX);
  assert.equal(calc.matieres, 0);
  assert.deepEqual(calc.composants, []);
  assert.equal(calc.vente, 40);
});

test("un composant sans materiau designe est ecarte", () => {
  const ouvrage = { composants: [{ materiauId: "", quantite: 5 }, { materiauId: "m1", quantite: 1 }] };
  assert.deepEqual(C.composantsOf(ouvrage), [{ materiauId: "m1", quantite: 1 }]);
});

/* ------------------------------------------------------ retour de chantier */

const OUVRAGES = [
  { id: "o1", nom: "Enduit de façade", unite: "m2", heures: 0.4, materiel: 2, composants: [{ materiauId: "m2", quantite: 3 }] },
  { id: "o2", nom: "Peinture", unite: "m2", heures: 0.15, materiel: 0, composants: [] },
];

test("un releve traduit « n personnes pendant h heures » en rendement", () => {
  const releve = { quantite: 50, personnes: 2, duree: 7 };
  assert.equal(C.heuresReleve(releve), 14);
  assert.equal(C.rendementReleve(releve), 0.28);
});

test("un releve sans quantite realisee ne produit pas de rendement", () => {
  assert.equal(C.rendementReleve({ quantite: 0, personnes: 2, duree: 7 }), 0);
});

test("le prix reellement paye se deduit de la facture", () => {
  assert.equal(C.prixAchat({ quantite: 25, montant: 85.5 }), 3.42);
  assert.equal(C.prixAchat({ quantite: 0, montant: 85.5 }), 0, "pas de division par zero");
});

test("l'ecart relatif n'a pas de sens sans prevision", () => {
  assert.equal(C.ecartRelatif(0.4, 0.5), 0.25);
  assert.equal(C.ecartRelatif(0.5, 0.4), -0.2);
  assert.equal(C.ecartRelatif(0, 0.4), null);
});

test("les rendements sont cumules sur tous les chantiers, ponderes par les quantites", () => {
  const chantiers = [
    { id: "c1", mainOeuvre: [{ id: "r1", ouvrageId: "o1", quantite: 100, personnes: 1, duree: 60 }] },
    { id: "c2", mainOeuvre: [{ id: "r2", ouvrageId: "o1", quantite: 300, personnes: 2, duree: 30 }] },
  ];
  const observation = C.observerRendements(chantiers).get("o1");

  assert.equal(observation.quantite, 400);
  assert.equal(observation.heures, 120, "60 h puis 2 × 30 h");
  assert.equal(observation.rendement, 0.3, "120 h / 400 m² — le gros chantier pèse davantage");
  assert.equal(observation.releves, 2);
  assert.equal(observation.chantiers, 2);
});

test("un releve sans ouvrage ou sans quantite est ecarte du recalage", () => {
  const chantiers = [
    {
      id: "c1",
      mainOeuvre: [
        { id: "r1", ouvrageId: "", quantite: 10, personnes: 1, duree: 5 },
        { id: "r2", ouvrageId: "o1", quantite: 0, personnes: 1, duree: 5 },
      ],
    },
  ];
  assert.equal(C.observerRendements(chantiers).size, 0);
});

test("les prix d'achat sont moyennes par les quantites facturees, et dates", () => {
  const chantiers = [
    { id: "c1", date: "2026-03-10", achats: [{ id: "a1", materiauId: "m2", quantite: 100, montant: 400 }] },
    { id: "c2", date: "2026-07-02", achats: [{ id: "a2", materiauId: "m2", quantite: 300, montant: 1500 }] },
  ];
  const observation = C.observerPrixMateriaux(chantiers).get("m2");

  assert.equal(observation.quantite, 400);
  assert.equal(observation.montant, 1900);
  assert.equal(observation.prix, 4.75);
  assert.equal(observation.date, "2026-07-02", "le prix recale porte la date du dernier achat");
});

test("le bilan compare ce qui etait prevu et ce qui a ete depense", () => {
  const chantier = {
    id: "c1",
    date: "2026-05-04",
    mainOeuvre: [{ id: "r1", ouvrageId: "o1", quantite: 100, personnes: 2, duree: 25 }],
    achats: [{ id: "a1", materiauId: "m2", quantite: 300, montant: 1500 }],
  };
  const bilan = C.bilanChantier(chantier, OUVRAGES, MATERIAUX, SETTINGS);

  // Prevu : 0,4 h/m² × 100 = 40 h à 50 €, 3 kg/m² à 4 €, forfait matériel 2 €/m².
  assert.equal(bilan.prevu.heures, 40);
  assert.equal(bilan.prevu.mainOeuvre, 2000);
  assert.equal(bilan.prevu.matieres, 1200);
  assert.equal(bilan.prevu.materiel, 200);
  assert.equal(bilan.prevu.direct, 3400);

  // Reel : 50 h prestees, 1 500 € de matieres facturees.
  assert.equal(bilan.reel.heures, 50);
  assert.equal(bilan.reel.mainOeuvre, 2500);
  assert.equal(bilan.reel.matieres, 1500);
  assert.equal(bilan.reel.direct, 4200);

  assert.equal(bilan.ecartDirect, 800);
  assert.equal(C.roundMoney(bilan.recette), 4420, "3 400 € de coût direct × K = 1,3");
  assert.equal(C.roundMoney(bilan.margePrevue), 1020);
  assert.equal(C.roundMoney(bilan.margeReelle), 220, "la marge fond avec le dépassement");

  const ligne = bilan.lignes[0];
  assert.equal(ligne.rendementPrevu, 0.4);
  assert.equal(ligne.rendementReel, 0.5);
  assert.equal(ligne.ecart, 0.25);
  assert.equal(bilan.achats[0].prix, 5);
  assert.equal(bilan.achats[0].prixBibliotheque, 4);
  assert.equal(bilan.achats[0].ecart, 0.25);
});

test("un chantier sans releve d'achat le signale plutot que d'afficher une marge flatteuse", () => {
  const chantier = { id: "c1", mainOeuvre: [{ id: "r1", ouvrageId: "o1", quantite: 10, personnes: 1, duree: 4 }], achats: [] };
  const bilan = C.bilanChantier(chantier, OUVRAGES, MATERIAUX, SETTINGS);
  assert.equal(bilan.achatsManquants, true);
  assert.equal(bilan.reel.matieres, 0);
});

test("un ouvrage supprime n'empeche pas le bilan du chantier", () => {
  const chantier = { id: "c1", mainOeuvre: [{ id: "r1", ouvrageId: "disparu", quantite: 10, personnes: 1, duree: 4 }], achats: [] };
  const bilan = C.bilanChantier(chantier, OUVRAGES, MATERIAUX, SETTINGS);
  assert.equal(bilan.lignes[0].ouvrage, undefined);
  assert.equal(bilan.recette, 0);
  assert.equal(bilan.reel.mainOeuvre, 200, "les heures prestées restent comptées");
});

test("les heures recalees sont arrondies sans bruit de virgule flottante", () => {
  assert.equal(C.roundHeures(0.1 + 0.2), 0.3);
  assert.equal(C.roundHeures(14 / 50), 0.28);
});

/* -------------------------------------------------------------- peremption des prix */

const AUJOURDHUI = new Date("2026-09-01T12:00:00");

test("l'age d'un prix se compte en jours pleins", () => {
  assert.equal(C.joursDepuisPrix("2026-08-02", AUJOURDHUI), 30);
  assert.equal(C.joursDepuisPrix("2026-09-01", AUJOURDHUI), 0);
});

test("un prix sans date ou invalide n'a pas d'age calculable", () => {
  assert.equal(C.joursDepuisPrix("", AUJOURDHUI), null);
  assert.equal(C.joursDepuisPrix(undefined, AUJOURDHUI), null);
  assert.equal(C.joursDepuisPrix("pas une date", AUJOURDHUI), null);
});

test("le passage a l'heure d'ete ne fait pas perdre un jour", () => {
  // Le 29 mars 2026, la Belgique passe de 2h a 3h : cette journee ne compte que
  // 23 heures reelles. Diviser un ecart de millisecondes par 86 400 000 sous-compte
  // donc d'un jour pile ce jour-la ; comparer les dates civiles (Y/M/D) n'a pas ce
  // defaut. process.env.TZ est lu a chaque construction de Date, pas seulement au
  // demarrage : le fixer ici suffit, quel que soit le fuseau du poste qui execute
  // le test (utile en CI, generalement en UTC — sans heure d'ete a traverser).
  const tzOriginal = process.env.TZ;
  process.env.TZ = "Europe/Brussels";
  try {
    const debutJourDst = new Date(2026, 2, 29, 0, 0, 0);
    const lendemain = new Date(2026, 2, 30, 0, 0, 0);
    assert.equal((lendemain - debutJourDst) / 3600000, 23, "verifie que ce cas traverse bien la journee a 23h");
    assert.equal(C.joursDepuisPrix("2026-03-29", lendemain), 1);
  } finally {
    process.env.TZ = tzOriginal;
  }
});

test("un prix n'est perime qu'au-dela du seuil, et seulement s'il est date", () => {
  const recent = { datePrix: "2026-08-15" }; // 17 jours
  const ancien = { datePrix: "2026-01-10" }; // > 180 jours
  const sansDate = { datePrix: "" };

  assert.equal(C.prixPerime(recent, AUJOURDHUI, 180).perime, false);
  assert.equal(C.prixPerime(ancien, AUJOURDHUI, 180).perime, true);
  assert.equal(C.prixPerime(sansDate, AUJOURDHUI, 180).perime, false, "pas de date, pas d'age : c'est deja signale ailleurs");
});

test("un seuil a zero desactive l'alerte, quel que soit l'age du prix", () => {
  const tresAncien = { datePrix: "2020-01-01" };
  assert.equal(C.prixPerime(tresAncien, AUJOURDHUI, 0).perime, false);
});

test("les materiaux perimes sont tries du plus ancien au plus recent", () => {
  const materiaux = [
    { id: "m1", nom: "Recent", datePrix: "2026-08-01" },
    { id: "m2", nom: "Tres ancien", datePrix: "2025-01-01" },
    { id: "m3", nom: "Non date", datePrix: "" },
    { id: "m4", nom: "Ancien", datePrix: "2026-02-01" },
  ];
  const perimes = C.materiauxPerimes(materiaux, AUJOURDHUI, 180);
  assert.deepEqual(perimes.map((item) => item.materiau.nom), ["Tres ancien", "Ancien"]);
  assert.ok(perimes[0].jours > perimes[1].jours);
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

test("un code connu ne suffit pas si l'unite ne correspond plus", () => {
  // "2.05" est bien rattache a l'ouvrage a, mais celui-ci se chiffre au m2, pas au m :
  // l'unite est eliminatoire, meme pour un code deja rencontre.
  const match = C.findMatch({ poste: "2.05", numero: "2.05", description: "Libellé inconnu", unite: "m" }, ouvragesTest, new Map());
  assert.equal(match.ouvrageId, "", "aucun prix ne doit etre calculable pour ce poste");
  assert.equal(match.unitWarning, true);
  assert.equal(match.suggestionId, "a", "le code reste propose comme piste, pas comme correspondance appliquee");
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

test("un separateur a l'interieur de guillemets ne coupe pas le champ", () => {
  const grid = C.parseDelimited('Poste;Désignation;U;Qté\n01.01;"Enduit, préparation comprise";m2;160');
  assert.deepEqual(grid[1], ["01.01", "Enduit, préparation comprise", "m2", "160"]);
});

test("meme avec la virgule comme separateur, une virgule entre guillemets reste dans le champ", () => {
  const grid = C.parseDelimited('Poste,Désignation,U,Qté\n01.01,"Enduit, préparation comprise",m2,160');
  assert.deepEqual(grid[1], ["01.01", "Enduit, préparation comprise", "m2", "160"]);
});

test("des guillemets doubles a l'interieur d'un champ deviennent un guillemet litteral", () => {
  const grid = C.parseDelimited('Poste;Désignation\n01.01;"Dit ""le grand"" portail"');
  assert.deepEqual(grid[1], ["01.01", 'Dit "le grand" portail']);
});

test("un champ entre guillemets peut contenir un retour a la ligne", () => {
  const grid = C.parseDelimited('Poste;Désignation;U\n01.01;"Enduit\nsur deux couches";m2');
  assert.deepEqual(grid[1], ["01.01", "Enduit\nsur deux couches", "m2"]);
  assert.equal(grid.length, 2, "le retour a la ligne du champ ne cree pas de ligne supplementaire");
});

test("les lignes entierement vides sont ecartees", () => {
  const grid = C.parseDelimited("Poste;Désignation\n01.01;Piquage\n\n02.01;Maçonnerie\n");
  assert.equal(grid.length, 3);
});

/* ------------------------------------------------------------------ catalogue */

test("le catalogue de demarrage est coherent", () => {
  const unites = new Set(CATALOG.ouvrages.map((o) => C.normalizeUnit(o.unite)));
  assert.ok(unites.size > 1);

  const nomsMateriaux = new Set(CATALOG.materiaux.map((m) => m.nom));
  CATALOG.ouvrages.forEach((ouvrage) => {
    assert.ok(ouvrage.composants.length > 0, `ouvrage sans composant : ${ouvrage.ref}`);
    ouvrage.composants.forEach((composant) => {
      assert.ok(nomsMateriaux.has(composant.materiau), `matériau inconnu : ${composant.materiau}`);
      assert.ok(Number(composant.quantite) > 0, `quantité manquante : ${ouvrage.ref}`);
    });
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
