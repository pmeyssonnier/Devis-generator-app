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

test("un poste \"pour memoire\" ou \"hors marche\" est repere quelle que soit la casse ou les accents", () => {
  assert.ok(C.isPourMemoire("Mobilier de vestiaire (pour mémoire, hors marché)"));
  assert.ok(C.isPourMemoire("POUR MEMOIRE"));
  assert.ok(C.isPourMemoire("Ouvrage hors marché"));
  assert.ok(!C.isPourMemoire("Mise à la terre et liaisons équipotentielles RGIE"));
  assert.ok(!C.isPourMemoire(""));
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

test("un code appris pour une commune est prioritaire, meme absent du refsMetre du catalogue", () => {
  const communeCodes = { "09.04": "c" };
  const match = C.findMatch(
    { poste: "09.04", numero: "09.04", description: "", unite: "m" },
    ouvragesTest,
    new Map(),
    communeCodes,
  );
  assert.equal(match.ouvrageId, "c");
  assert.equal(match.confidence, 1);
  assert.equal(match.reason, "code connu (commune)");
});

test("deux communes peuvent reutiliser le meme numero de poste sans se marcher dessus", () => {
  // "09.04" designe l'ouvrage c pour la commune X, l'ouvrage b pour la commune Y :
  // chaque table de commune reste independante, sans effet sur l'autre.
  const matchX = C.findMatch(
    { poste: "09.04", numero: "09.04", description: "", unite: "m" },
    ouvragesTest,
    new Map(),
    { "09.04": "c" },
  );
  const matchY = C.findMatch(
    { poste: "09.04", numero: "09.04", description: "", unite: "m2" },
    ouvragesTest,
    new Map(),
    { "09.04": "b" },
  );
  assert.equal(matchX.ouvrageId, "c");
  assert.equal(matchY.ouvrageId, "b");
});

test("un code appris pour une commune reste soumis au garde-fou d'unite", () => {
  const communeCodes = { "09.04": "a" }; // ouvrage a se chiffre au m2
  const match = C.findMatch(
    { poste: "09.04", numero: "09.04", description: "", unite: "m" },
    ouvragesTest,
    new Map(),
    communeCodes,
  );
  assert.equal(match.ouvrageId, "", "aucun prix ne doit etre calculable pour ce poste");
  assert.equal(match.unitWarning, true);
  assert.equal(match.suggestionId, "a");
});

test("sans table de commune, le comportement est inchange (retro-compatibilite)", () => {
  const match = C.findMatch({ poste: "2.05", numero: "2.05", description: "", unite: "m2" }, ouvragesTest, new Map());
  assert.equal(match.ouvrageId, "a");
  assert.equal(match.reason, "code connu");
});

test("une commune active ne retombe jamais sur le refsMetre global pour un code qu'elle ne connait pas encore", () => {
  // "2.05" est un code connu du catalogue (rattache a l'ouvrage a), mais la commune
  // en cours n'a encore rien appris ({} : aucune entree, pas "pas de commune du
  // tout"). Le refsMetre global appartient peut-etre a une tout autre codification :
  // il ne doit pas etre applique comme une certitude ici.
  const match = C.findMatch({ poste: "2.05", numero: "2.05", description: "", unite: "m2" }, ouvragesTest, new Map(), {});
  assert.notEqual(match.ouvrageId, "a", "le refsMetre global ne doit pas s'appliquer des qu'une commune est active");
  assert.equal(match.reason === "code connu", false);
});

test("une commune active retombe sur le libelle, pas sur le refsMetre global, pour un code inconnu d'elle", () => {
  // Meme scenario, mais avec un libelle qui permet un vrai rapprochement par
  // similarite : la commune ne connait pas "2.05", le refsMetre global est ignore,
  // mais le libelle retrouve tout de meme le bon ouvrage — legitimement cette fois.
  const match = C.findMatch(
    { poste: "2.05", numero: "2.05", description: "Peinture des murs intérieurs", unite: "m2" },
    ouvragesTest,
    new Map(),
    {},
  );
  assert.equal(match.ouvrageId, "b");
  assert.equal(match.reason, "libellé");
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

/* ------------------------------------------------ proximite technique ouvrage */

const facadeExistante = {
  id: "fac003",
  nom: "Enduit de façade minéral armé",
  unite: "m2",
  motsCles: "enduit facade mineral arme crepi treillis",
  heures: 0.42,
  materiel: 4.5,
  composants: [
    { materiauId: "mortier", quantite: 8.5 },
    { materiauId: "treillis", quantite: 1.1 },
    { materiauId: "primaire", quantite: 0.2 },
  ],
};

test("une composition quasi identique donne un score de proximite tres eleve", () => {
  // Meme exemple que la discussion : un ecart de rendement/matiere minime ne doit
  // pas suffire a justifier un nouvel ouvrage.
  const brouillon = {
    nom: "Enduit extérieur minéral armé avec treillis fibre, ép. 10 mm",
    unite: "m2",
    heures: 0.43,
    materiel: 4.5,
    composants: [
      { materiauId: "mortier", quantite: 8.7 },
      { materiauId: "treillis", quantite: 1.1 },
      { materiauId: "primaire", quantite: 0.2 },
    ],
  };
  const score = C.ouvrageProximity(brouillon, facadeExistante);
  assert.ok(score >= 0.85, `score attendu tres eleve, obtenu ${score}`);
});

test("une composition sensiblement differente donne un score plus bas", () => {
  const brouillon = {
    nom: "Enduit extérieur minéral armé avec profilés",
    unite: "m2",
    heures: 0.7,
    materiel: 4.5,
    composants: [
      { materiauId: "mortier", quantite: 12 },
      { materiauId: "treillis", quantite: 2.2 },
      { materiauId: "profiles", quantite: 1 },
    ],
  };
  const score = C.ouvrageProximity(brouillon, facadeExistante);
  const scoreProche = C.ouvrageProximity(
    { ...facadeExistante, heures: 0.43, composants: [{ materiauId: "mortier", quantite: 8.7 }, { materiauId: "treillis", quantite: 1.1 }, { materiauId: "primaire", quantite: 0.2 }] },
    facadeExistante,
  );
  assert.ok(score < scoreProche, "un ecart reel de composition doit se voir dans le score");
});

test("memes matieres mais dosages sans rapport : le score chute malgre un libelle et un rendement identiques", () => {
  // Cas critique signale : mêmes materiauId (mortier/treillis/primaire), même
  // libellé, même rendement et matériel, mais des quantités trois fois plus
  // fortes. Un indice de Jaccard seul sur la presence des matieres donnerait
  // 100 % ici — la proximite des quantites doit tirer le score vers le bas.
  const brouillon = {
    nom: facadeExistante.nom,
    unite: "m2",
    heures: facadeExistante.heures,
    materiel: facadeExistante.materiel,
    composants: [
      { materiauId: "mortier", quantite: 20 },
      { materiauId: "treillis", quantite: 3 },
      { materiauId: "primaire", quantite: 1 },
    ],
  };
  const score = C.ouvrageProximity(brouillon, facadeExistante);
  // Le nom, le rendement et le matériel sont ici volontairement identiques : le
  // score global reste donc porté par ces signaux-là (65 % du poids). Ce qui compte
  // est que la composition, elle, ne mente plus : elle ne doit plus valoir 100 %.
  assert.ok(score < 0.9, `un dosage 3x plus fort doit se voir dans le score global, obtenu ${score}`);

  const brouillonProche = {
    ...brouillon,
    composants: [
      { materiauId: "mortier", quantite: 8.7 },
      { materiauId: "treillis", quantite: 1.1 },
      { materiauId: "primaire", quantite: 0.2 },
    ],
  };
  const scoreProche = C.ouvrageProximity(brouillonProche, facadeExistante);
  assert.ok(
    score < scoreProche - 0.1,
    `un dosage tres different doit scorer nettement moins bien qu'un dosage quasi identique (${score} vs ${scoreProche})`,
  );
});

test("une unite differente elimine toute proximite, quel que soit le libelle", () => {
  const brouillon = { nom: "Enduit de façade minéral armé", unite: "m", heures: 0.42, composants: facadeExistante.composants };
  assert.equal(C.ouvrageProximity(brouillon, facadeExistante), 0);
});

test("ouvrageProximityDetail expose le score par signal, pas seulement le total", () => {
  // Meme cas critique que ci-dessus : le detail doit montrer que seule la
  // composition s'ecarte, pas juste renvoyer un pourcentage global qui les noie.
  const brouillon = {
    nom: facadeExistante.nom,
    unite: "m2",
    heures: facadeExistante.heures,
    materiel: facadeExistante.materiel,
    composants: [
      { materiauId: "mortier", quantite: 20 },
      { materiauId: "treillis", quantite: 3 },
      { materiauId: "primaire", quantite: 1 },
    ],
  };
  const detail = C.ouvrageProximityDetail(brouillon, facadeExistante);
  assert.ok(detail.textScore >= 0.98, "libelle identique");
  assert.equal(detail.rendementScore, 1, "rendement identique");
  assert.equal(detail.materielScore, 1, "materiel identique");
  assert.ok(detail.composantScore < 0.7, `composition tres differente, obtenu ${detail.composantScore}`);
  assert.equal(detail.score, C.ouvrageProximity(brouillon, facadeExistante), "coherent avec ouvrageProximity");
});

test("bestOuvrageMatch retient le candidat le plus proche parmi le catalogue", () => {
  const autre = { id: "other", nom: "Carrelage de sol grès cérame", unite: "m2", composants: [], heures: 0.5, materiel: 5 };
  const best = C.bestOuvrageMatch(
    { nom: "Enduit extérieur minéral armé", unite: "m2", heures: 0.42, composants: facadeExistante.composants },
    [facadeExistante, autre],
  );
  assert.equal(best.ouvrage.id, "fac003");
  assert.ok(best.detail, "le detail par signal doit accompagner le meilleur candidat");
  assert.equal(best.detail.score, best.score);
});

test("bestOuvrageMatch renvoie null s'il n'y a aucun candidat de meme unite", () => {
  const best = C.bestOuvrageMatch({ nom: "Enduit de façade minéral armé", unite: "pce", heures: 0, composants: [] }, [facadeExistante]);
  assert.equal(best, null);
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

test("un ouvrage \"pour memoire\" du catalogue ne pre-enregistre aucun code de metre", () => {
  // Un code de metre comme "09.04" n'est qu'un numero de lot/poste propre au marche
  // d'origine : le reutiliser comme code connu pour un ouvrage "pour memoire, hors
  // marche" (prix quasi nul) ferait disparaitre, avec une confiance de 100 %, un
  // poste bien reel d'un tout autre marche qui reutilise coincidemment ce numero.
  const pourMemoire = CATALOG.ouvrages.filter((ouvrage) => /pour mémoire|hors marché/i.test(ouvrage.nom));
  assert.ok(pourMemoire.length > 0, "cet exemple doit toujours exister dans le catalogue");
  pourMemoire.forEach((ouvrage) => {
    assert.equal(ouvrage.ref, "", `${ouvrage.nom} ne doit avoir aucun code de metre pre-enregistre`);
  });
});

/* ------------------------------------------------------- forfaits et quantites */

test("un forfait n'est compatible avec une autre unite que pour une quantite de 1", () => {
  assert.equal(C.unitsCompatible("FF", "m2"), true, "sans quantite connue : joker historique");
  assert.equal(C.unitsCompatible("FF", "m2", 1), true);
  assert.equal(C.unitsCompatible("m2", "FF", 1), true);
  assert.equal(C.unitsCompatible("FF", "m2", 180), false, "un prix global ne se multiplie pas par 180");
  assert.equal(C.unitsCompatible("pce", "FF", 12), false);
  assert.equal(C.unitsCompatible("FF", "FF", 12), true, "meme unite des deux cotes : toujours compatible");
  assert.equal(C.unitsCompatible("FF", "m2", 0), true, "quantite absente : la ligne n'est pas chiffrable de toute facon");
  assert.equal(C.isForfaitUnit("Forfait"), true);
  assert.equal(C.isForfaitUnit("m2"), false);
});

test("un ouvrage forfaitaire n'est plus rapproche d'un poste a quantite, meme par code connu", () => {
  const ouvrages = [
    { id: "ff", nom: "Installation de chantier, amenée et repli", unite: "FF", refsMetre: ["1.01"], motsCles: "installation chantier amenee repli" },
  ];
  const parCode = C.findMatch({ poste: "1.01", numero: "1.01", description: "Installation de chantier", unite: "m2", quantite: 180 }, ouvrages, new Map());
  assert.equal(parCode.ouvrageId, "", "180 m2 x un forfait : jamais applique");
  assert.equal(parCode.unitWarning, true);
  assert.equal(parCode.suggestionId, "ff", "mais propose comme piste, pour que l'utilisateur comprenne");

  const parLibelle = C.findMatch({ poste: "X", numero: "X", description: "Installation de chantier", unite: "pce", quantite: 12 }, ouvrages, new Map());
  assert.equal(parLibelle.ouvrageId, "");
  assert.equal(parLibelle.unitWarning, true);

  const unite = C.findMatch({ poste: "1.01", numero: "1.01", description: "Installation de chantier", unite: "pce", quantite: 1 }, ouvrages, new Map());
  assert.equal(unite.ouvrageId, "ff", "quantite 1 : le forfait reste applicable a n'importe quelle unite");
});

test("un numero de ligne fabrique faute de colonne N° n'est jamais un code", () => {
  const ouvrages = [{ id: "p", nom: "Peinture murs intérieurs", unite: "m2", refsMetre: ["1"], motsCles: "peinture murs" }];
  // "1" a ete appris (a tort, avant ce garde-fou) : une ligne 1 sans numero ne doit pas le retrouver.
  const synthetique = C.findMatch(
    { poste: "1", numero: "1", numeroSynthetique: true, description: "Carrelage de sol grès cérame", unite: "m2", quantite: 40 },
    ouvrages,
    new Map(),
  );
  assert.notEqual(synthetique.ouvrageId, "p");
  const reel = C.findMatch({ poste: "1", numero: "1", description: "Carrelage de sol grès cérame", unite: "m2", quantite: 40 }, ouvrages, new Map());
  assert.equal(reel.ouvrageId, "p", "un vrai code « 1 » lu dans le fichier garde le comportement historique");
});

/* --------------------------------------------------------- lecture multi-feuilles */

test("rowField retrouve la colonne d'une ligne dont la feuille a d'autres en-tetes", () => {
  const lot1 = C.rowsFromGrid([["N°", "Description", "Unité", "Quantité", "PU"], ["1.01", "Enduit de façade", "m2", 120, ""]], "Lot 1");
  const lot2 = C.rowsFromGrid([["Poste", "Désignation", "Un", "Qté", "PU"], ["2.01", "Peinture des murs", "m2", 80, ""]], "Lot 2");
  const rows = lot1.rows.concat(lot2.rows);
  // Mapping global calcule sur l'union des en-tetes : il retient ceux du Lot 2 pour
  // poste/description et ceux du Lot 1 pour unite/quantite (premier trouve).
  const mapping = { poste: "Poste", description: "Désignation", unite: "Unité", quantite: "Quantité" };
  const lu = rows.map((raw) => ({
    numero: String(C.rowField(raw, mapping.poste, C.HEADER_CANDIDATES.poste) ?? "").trim(),
    description: String(C.rowField(raw, mapping.description, C.HEADER_CANDIDATES.description) ?? "").trim(),
    unite: String(C.rowField(raw, mapping.unite, C.HEADER_CANDIDATES.unite) ?? "").trim(),
    quantite: C.parseNumber(C.rowField(raw, mapping.quantite, C.HEADER_CANDIDATES.quantite)),
  }));
  assert.deepEqual(lu, [
    { numero: "1.01", description: "Enduit de façade", unite: "m2", quantite: 120 },
    { numero: "2.01", description: "Peinture des murs", unite: "m2", quantite: 80 },
  ]);
  // L'en-tete mappe present mais vide reste vide : pas de repli sur une autre colonne.
  assert.equal(C.rowField({ Description: "", __cols: { Description: 1, Désignation: 2 }, Désignation: "x" }, "Description", C.HEADER_CANDIDATES.description), "");
  // Aucun en-tete choisi (« — ») : choix explicite, pas de detection a la place de l'utilisateur.
  assert.equal(C.rowField(rows[0], "", C.HEADER_CANDIDATES.poste), undefined);
});

test("un poste dont le libelle contient « total » ou « report » n'est pas un sous-total", () => {
  const parsed = C.rowsFromGrid(
    [
      ["N°", "Désignation", "Unité", "Quantité"],
      ["1.01", "Démontage total de la chaudière existante", "pce", 1],
      ["1.02", "Report des eaux de toiture vers l'égout", "m", 12],
      ["1", "Sous-total lot 1", "", ""],
      ["", "Total général", "", ""],
    ],
    "Feuil1",
  );
  assert.deepEqual(parsed.rows.map((row) => row["N°"]), ["1.01", "1.02"]);
  assert.equal(parsed.skipped, 1, "le sous-total a code numerique est ecarte ET compte ; la ligne sans code est un titre ignore");
});

/* ------------------------------------------------- migration de l'etat enregistre */

// uid deterministe : les identifiants generes doivent etre reperables dans les tests.
function uidSequentiel() {
  let n = 0;
  return () => `gen-${++n}`;
}

function normaliser(source, avertissements = []) {
  return C.normalizeState(source, {
    catalog: CATALOG,
    uid: uidSequentiel(),
    today: "2026-09-02",
    onWarning: (message) => avertissements.push(message),
  });
}

test("normalizeState migre une bibliotheque enregistree par une version anterieure", () => {
  const etat = normaliser({
    settings: { coutHoraire: 52, tva: 12 },
    materiaux: [{ id: "m1", nom: "Enduit", unite: "m2", prix: "13,5" }],
    ouvrages: [
      // Ancien couple materiauId / quantiteMateriau, et ancien nom de champ pour les refs.
      { id: "o1", poste: "A01", nom: "03.02 - Enduit de façade", unite: "m2", heures: 0.35, materiauId: "m1", quantiteMateriau: 1, referencesMetre: ["2.05"] },
      // Sans id : il doit en recevoir un.
      { poste: "A01", nom: "Peinture", unite: "m2", heures: 0.2 },
    ],
    devis: { tva: 0, lignes: [{ ouvrageId: "o1", quantite: "12" }] },
  });

  assert.equal(etat.ouvrages[0].composants.length, 1, "l'ancien materiau unique devient un composant");
  assert.deepEqual(etat.ouvrages[0].composants[0], { materiauId: "m1", quantite: 1 });
  assert.ok(etat.ouvrages[0].refsMetre.includes("2.05"), "referencesMetre est relu comme refsMetre");
  assert.equal(etat.ouvrages[0].nom, "Enduit de façade", "le code en tete du libelle, suivi d'un separateur, est retire");
  assert.ok(etat.ouvrages[1].id, "un ouvrage sans id en recoit un");
  assert.notEqual(etat.ouvrages[1].poste, etat.ouvrages[0].poste, "deux ouvrages ne partagent pas le meme code interne");
  const devis = etat.devisList[0];
  assert.equal(etat.devisList.length, 1, "le devis unique d'avant devient le premier de la liste");
  assert.equal(devis.tva, 0, "0 % est une valeur legitime, pas une absence");
  assert.equal(devis.quantite, undefined);
  assert.equal(devis.lignes[0].quantite, 12);
  assert.ok(devis.lignes[0].id, "une ligne de devis sans id en recoit un");
  assert.equal(devis.numero, "2026-001", "un numero est attribue au devis migre");
  assert.equal(etat.devisCourantId, devis.id);
  assert.equal(etat.devis, undefined, "l'ancien champ singulier disparait");
  assert.equal(etat.settings.tva, 21, "une TVA hors 6/21 revient au taux par defaut");
  assert.equal(etat.settings.coutHoraire, 52, "les reglages saisis sont conserves");
  assert.equal(etat.materiaux[0].prix, 0, "un prix non numerique ne devient jamais NaN");
});

test("normalizeState fusionne les communes homonymes et signale les conflits", () => {
  const avertissements = [];
  const etat = normaliser(
    {
      ouvrages: [
        { id: "a", nom: "Enduit", unite: "m2" },
        { id: "b", nom: "Peinture", unite: "m2" },
      ],
      mappingCommunes: {
        Schaerbeek: { "09.04": "a", "09.05": "a" },
        // Meme commune a la casse pres, avec une correspondance differente pour 09.04
        // et une autre vers un ouvrage supprime depuis.
        schaerbeek: { "09.04": "b", "09.06": "disparu" },
        "  ": { "01.01": "a" },
      },
    },
    avertissements,
  );

  assert.deepEqual(Object.keys(etat.mappingCommunes), ["Schaerbeek"], "un seul profil, la premiere casse rencontree");
  assert.equal(etat.mappingCommunes.Schaerbeek["09.04"], "a", "la premiere correspondance est conservee");
  assert.equal(etat.mappingCommunes.Schaerbeek["09.05"], "a");
  assert.equal(etat.mappingCommunes.Schaerbeek["09.06"], undefined, "un code vers un ouvrage disparu est ecarte");
  assert.equal(avertissements.length, 1, "le conflit est signale, pas ecrase en silence");
  assert.match(avertissements[0], /09\.04/);
});

test("normalizeState reprend la commune d'une session analysee avant analysedCommune", () => {
  const avec = normaliser({ metre: { commune: "Ixelles", analysed: [{ numero: "1.01" }] } });
  assert.equal(avec.metre.analysedCommune, "Ixelles");
  const sans = normaliser({ metre: { commune: "Ixelles", analysed: [] } });
  assert.equal(sans.metre.analysedCommune, "", "sans analyse, rien a reprendre");
  const recent = normaliser({ metre: { commune: "Ixelles", analysedCommune: "", analysed: [{ numero: "1.01" }] } });
  assert.equal(recent.metre.analysedCommune, "", "une session recente garde sa valeur, meme vide");
});

test("normalizeState accepte un etat vide sans rien casser", () => {
  const etat = normaliser({});
  assert.deepEqual(etat.ouvrages, []);
  assert.deepEqual(etat.mappingCommunes, {});
  assert.equal(etat.metre.rows.length, 0);
  assert.equal(etat.settings.coutHoraire, CATALOG.defaultSettings.coutHoraire);
});

/* ---------------------------------------------------------- analyse d'un metre */

const GRILLE_METRE = [
  ["N°", "Désignation", "Unité", "Quantité", "P.U. (€)"],
  ["1.01", "Enduit de façade minéral sur treillis", "m2", 205, ""],
  ["1.02", "Mobilier de vestiaire (pour mémoire)", "pce", "", ""],
  ["1.03", "Peinture murs intérieurs deux couches", "m2", "", ""],
  ["1.04", "Ouvrage totalement inconnu au bataillon", "m3", 12, ""],
  ["1.01", "Enduit de façade, reprise", "m2", 30, ""],
];

const OUVRAGES_METRE = [
  { id: "enduit", nom: "Enduit de façade minéral armé", unite: "m2", refsMetre: ["03.02"], motsCles: "enduit facade mineral arme treillis" },
  { id: "peinture", nom: "Peinture murs intérieurs, deux couches", unite: "m2", refsMetre: [], motsCles: "peinture murs interieurs deux couches" },
];

function analyser(grille, communeCodes) {
  const parsed = C.rowsFromGrid(grille, "Lot 1");
  const mapping = {
    poste: C.findHeader(parsed.headers, C.HEADER_CANDIDATES.poste),
    description: C.findHeader(parsed.headers, C.HEADER_CANDIDATES.description),
    unite: C.findHeader(parsed.headers, C.HEADER_CANDIDATES.unite),
    quantite: C.findHeader(parsed.headers, C.HEADER_CANDIDATES.quantite),
    prixUnitaire: C.findHeader(parsed.headers, C.HEADER_CANDIDATES.prixUnitaire),
  };
  return C.analyseRows(parsed.rows, mapping, OUVRAGES_METRE, communeCodes);
}

test("analyseRows rapproche, signale et repere les postes pour memoire", () => {
  const { analysed, alerts } = analyser(GRILLE_METRE, null);
  const par = (numero) => analysed.filter((row) => row.numero === numero);

  assert.equal(analysed.length, 5);
  assert.equal(par("1.01")[0].ouvrageId, "enduit", "rapproche par libelle");
  assert.equal(par("1.02")[0].pourMemoire, true);
  assert.equal(par("1.02")[0].ouvrageId, "", "aucun ouvrage pour un poste pour memoire");
  assert.equal(par("1.03")[0].ouvrageId, "peinture");
  assert.equal(par("1.03")[0].quantiteOk, false, "quantite absente : la ligne n'est pas chiffrable");
  assert.equal(par("1.04")[0].ouvrageId, "", "aucun ouvrage plausible");

  const messages = alerts.map((alerte) => alerte.message);
  assert.ok(messages.some((m) => /1\.03.*quantité absente/i.test(m)));
  assert.ok(messages.some((m) => /1\.04.*aucun ouvrage reconnu/i.test(m)));
  assert.ok(messages.some((m) => /1\.01.*plusieurs fois/i.test(m)), "un code en double est signale");
  assert.ok(!messages.some((m) => /1\.02.*quantité absente/i.test(m)), "un poste pour memoire n'a pas a porter de quantite");
});

test("analyseRows conserve la position de chaque ligne pour l'export", () => {
  const { analysed } = analyser(GRILLE_METRE, null);
  assert.equal(analysed[0].rowIndex, 1, "ligne 1 du fichier apres l'en-tete");
  assert.equal(analysed[0].puCol, 4, "colonne « P.U. (€) »");
  assert.equal(analysed[0].sheet, "Lot 1");
  assert.equal(analysed[0].lot, "Lot 1");
});

test("analyseRows sans colonne N° fabrique un numero, jamais un code", () => {
  const { analysed } = analyser(
    [
      ["Désignation", "Unité", "Quantité"],
      ["Enduit de façade minéral sur treillis", "m2", 205],
    ],
    null,
  );
  assert.equal(analysed[0].numero, "1");
  assert.equal(analysed[0].numeroSynthetique, true);
});

test("analyseRows applique la table de codes de la commune, sans retour au global", () => {
  // "1.01" n'est pas dans refsMetre de l'ouvrage peinture : seule la commune le sait.
  const { analysed } = analyser(GRILLE_METRE, { "1.01": "peinture" });
  assert.equal(analysed[0].ouvrageId, "peinture");
  assert.equal(analysed[0].reason, "code connu (commune)");

  // Commune active mais qui ne connait pas encore ce code : on retombe sur le libelle,
  // jamais sur le refsMetre du catalogue.
  const vierge = analyser(GRILLE_METRE, {});
  assert.equal(vierge.analysed[0].ouvrageId, "enduit");
  assert.equal(vierge.analysed[0].reason, "libellé");
});

test("metreRowStatus donne un seul etat par ligne", () => {
  assert.equal(C.metreRowStatus({ unitWarning: true, quantiteOk: true }, true), "unite-incompatible");
  assert.equal(C.metreRowStatus({ quantiteOk: true }, false), "ouvrage-manquant");
  assert.equal(C.metreRowStatus({ quantiteOk: true, pourMemoire: true }, false), "pour-memoire");
  assert.equal(C.metreRowStatus({ quantiteOk: false, pourMemoire: true }, true), "pour-memoire");
  assert.equal(C.metreRowStatus({ quantiteOk: false }, true), "quantite-manquante");
  assert.equal(C.metreRowStatus({ quantiteOk: true }, true), "ok");
  // Chaque etat a un libelle pour l'export : aucune case vide dans la colonne Statut.
  ["unite-incompatible", "ouvrage-manquant", "pour-memoire", "quantite-manquante", "ok"].forEach((cle) => {
    assert.ok(C.METRE_STATUS_LABELS[cle], `libelle manquant pour ${cle}`);
  });
});

/* --------------------------------- invariants apres apprentissage et remaniements */

function etatDeTravail() {
  return C.normalizeState(
    {
      ouvrages: [
        { id: "enduit", nom: "Enduit de façade", unite: "m2", refsMetre: ["03.02"] },
        { id: "peinture", nom: "Peinture de façade", unite: "m2", refsMetre: ["03.03"] },
      ],
      devis: { lignes: [{ id: "l1", ouvrageId: "enduit", quantite: 10 }] },
      chantiers: [
        { id: "c1", nom: "Chantier", mainOeuvre: [{ id: "r1", ouvrageId: "enduit", quantite: 5, personnes: 1, duree: 2 }], achats: [] },
      ],
      metre: {
        commune: "",
        analysedCommune: "",
        analysed: [
          { numero: "2.05", poste: "2.05", ouvrageId: "enduit", suggestionId: "", unitWarning: false, quantiteOk: true },
          { numero: "2.06", poste: "2.06", ouvrageId: "", suggestionId: "enduit", unitWarning: false, quantiteOk: true },
        ],
      },
    },
    { catalog: CATALOG, uid: uidSequentiel(), onWarning: () => {} },
  );
}

// Un code de metre ne doit designer qu'un seul ouvrage : sinon le prochain chiffrage
// redevient arbitraire, le premier ouvrage trouve l'emportant.
function codesEnDouble(etat) {
  const porteurs = new Map();
  etat.ouvrages.forEach((ouvrage) => {
    (ouvrage.refsMetre || []).forEach((ref) => {
      const cle = C.normalizeRef(ref);
      porteurs.set(cle, (porteurs.get(cle) || []).concat(ouvrage.id));
    });
  });
  return [...porteurs.entries()].filter(([, ids]) => ids.length > 1);
}

function referencesOrphelines(etat) {
  const ids = new Set(etat.ouvrages.map((ouvrage) => ouvrage.id));
  const orphelines = [];
  Object.entries(etat.mappingCommunes).forEach(([commune, codes]) => {
    Object.entries(codes).forEach(([code, id]) => {
      if (!ids.has(id)) orphelines.push(`mappingCommunes/${commune}/${code}`);
    });
  });
  etat.metre.analysed.forEach((row) => {
    if (row.ouvrageId && !ids.has(row.ouvrageId)) orphelines.push(`metre/${row.numero}/ouvrageId`);
    if (row.suggestionId && !ids.has(row.suggestionId)) orphelines.push(`metre/${row.numero}/suggestionId`);
  });
  return orphelines;
}

test("memoriser un code le retire de l'ouvrage qui le portait", () => {
  const etat = etatDeTravail();
  etat.ouvrages[0].refsMetre = C.normalizeRefList([etat.ouvrages[0].refsMetre, "2.05"]);

  C.memoriserCode(etat, { numero: "2.05", ouvrageId: "peinture", unitWarning: false });

  const enduit = etat.ouvrages.find((o) => o.id === "enduit");
  const peinture = etat.ouvrages.find((o) => o.id === "peinture");
  assert.ok(!enduit.refsMetre.some((ref) => C.normalizeRef(ref) === "2.05"), "l'ancien porteur perd le code");
  assert.ok(peinture.refsMetre.some((ref) => C.normalizeRef(ref) === "2.05"), "le nouveau le recoit");
  assert.deepEqual(codesEnDouble(etat), [], "aucun code sur deux ouvrages");
});

test("avec une commune, le code est appris pour elle seule et jamais en global", () => {
  const etat = etatDeTravail();
  etat.metre.analysedCommune = "Ixelles";

  C.memoriserCode(etat, { numero: "2.05", ouvrageId: "peinture", unitWarning: false });

  assert.equal(etat.mappingCommunes.Ixelles["2.05"], "peinture");
  assert.ok(
    !etat.ouvrages.some((o) => (o.refsMetre || []).some((ref) => C.normalizeRef(ref) === "2.05")),
    "le refsMetre global, partage entre marches, n'est pas touche",
  );
  // La casse d'une commune deja connue est reutilisee, pas dupliquee.
  etat.metre.analysedCommune = "IXELLES";
  C.memoriserCode(etat, { numero: "2.07", ouvrageId: "enduit", unitWarning: false });
  assert.deepEqual(Object.keys(etat.mappingCommunes), ["Ixelles"]);
  assert.equal(etat.mappingCommunes.Ixelles["2.07"], "enduit");
});

test("memoriserCode refuse une unite incompatible et un numero fabrique", () => {
  const etat = etatDeTravail();
  assert.equal(C.memoriserCode(etat, { numero: "2.09", ouvrageId: "enduit", unitWarning: true }), false);
  assert.equal(C.memoriserCode(etat, { numero: "3", ouvrageId: "enduit", numeroSynthetique: true }), false);
  assert.equal(C.memoriserCode(etat, { numero: "2.09", ouvrageId: "inexistant" }), false);
  assert.ok(!etat.ouvrages.some((o) => o.refsMetre.some((ref) => C.normalizeRef(ref) === "2.09")));
});

test("fusionner deux ouvrages transfere tout ce qui designait le disparu", () => {
  const etat = etatDeTravail();
  etat.metre.analysedCommune = "Ixelles";
  C.memoriserCode(etat, { numero: "2.05", ouvrageId: "enduit", unitWarning: false });

  assert.equal(C.fusionnerOuvrages(etat, "enduit", "peinture"), true);

  const peinture = etat.ouvrages.find((o) => o.id === "peinture");
  assert.equal(etat.ouvrages.length, 1, "l'ouvrage source disparait");
  assert.ok(peinture.refsMetre.includes("03.02"), "les codes du disparu sont repris");
  assert.equal(etat.mappingCommunes.Ixelles["2.05"], "peinture");
  assert.equal(etat.devisList[0].lignes[0].ouvrageId, "peinture");
  assert.equal(etat.chantiers[0].mainOeuvre[0].ouvrageId, "peinture", "sans ce transfert, l'historique ne recale plus rien");
  assert.equal(etat.metre.analysed[0].ouvrageId, "peinture");
  assert.equal(etat.metre.analysed[1].suggestionId, "peinture");
  assert.deepEqual(referencesOrphelines(etat), []);
  assert.deepEqual(codesEnDouble(etat), []);
});

test("fusionner refuse un ouvrage inconnu ou lui-meme", () => {
  const etat = etatDeTravail();
  assert.equal(C.fusionnerOuvrages(etat, "enduit", "enduit"), false);
  assert.equal(C.fusionnerOuvrages(etat, "inexistant", "peinture"), false);
  assert.equal(etat.ouvrages.length, 2);
});

test("supprimer un ouvrage ne laisse aucune reference pendante", () => {
  const etat = etatDeTravail();
  etat.metre.analysedCommune = "Ixelles";
  C.memoriserCode(etat, { numero: "2.05", ouvrageId: "enduit", unitWarning: false });

  C.supprimerOuvrage(etat, "enduit");

  assert.equal(etat.ouvrages.length, 1);
  assert.equal(etat.mappingCommunes.Ixelles["2.05"], undefined, "le code appris part avec l'ouvrage");
  assert.equal(etat.metre.analysed[0].ouvrageId, "");
  assert.equal(etat.metre.analysed[1].suggestionId, "", "meme une simple suggestion ne survit pas");
  assert.deepEqual(referencesOrphelines(etat), []);
  // Devis et chantiers gardent volontairement la reference : ils s'affichent
  // « ouvrage supprimé » plutot que de disparaitre d'un historique.
  assert.equal(etat.devisList[0].lignes[0].ouvrageId, "enduit");
  assert.equal(etat.chantiers[0].mainOeuvre[0].ouvrageId, "enduit");
});

test("une migration relit un etat remanie sans laisser de reference morte", () => {
  const etat = etatDeTravail();
  etat.metre.analysedCommune = "Ixelles";
  C.memoriserCode(etat, { numero: "2.05", ouvrageId: "enduit", unitWarning: false });
  C.supprimerOuvrage(etat, "enduit");
  const relu = C.normalizeState(etat, { catalog: CATALOG, uid: uidSequentiel(), onWarning: () => {} });
  assert.deepEqual(referencesOrphelines(relu), []);
  assert.deepEqual(codesEnDouble(relu), []);
});

/* ------------------------------------------------------ historique des metres */

test("resumeMetre compte ce qui est reellement chiffre", () => {
  const metre = {
    analysed: [
      { numero: "1.01", ouvrageId: "a", quantiteOk: true, unitWarning: false },
      { numero: "1.02", ouvrageId: "a", quantiteOk: false, unitWarning: false },
      { numero: "1.03", ouvrageId: "", quantiteOk: true, unitWarning: false },
      { numero: "1.04", ouvrageId: "a", quantiteOk: true, unitWarning: true },
      { numero: "1.05", ouvrageId: "", quantiteOk: false, unitWarning: false, pourMemoire: true },
    ],
  };
  const montants = { "1.01": 1200, "1.02": 0, "1.03": 0, "1.04": 0, "1.05": 0 };
  const resume = C.resumeMetre(metre, (row) => montants[row.numero]);
  assert.equal(resume.postes, 5);
  assert.equal(resume.chiffres, 1, "seule la ligne complete et compatible compte");
  assert.equal(resume.total, 1200);
});

test("resumeMetre supporte un metre vide ou sans montants", () => {
  assert.deepEqual(C.resumeMetre({}, () => 0), { postes: 0, chiffres: 0, total: 0 });
  assert.deepEqual(C.resumeMetre({ analysed: [] }, () => undefined), { postes: 0, chiffres: 0, total: 0 });
  // Un montant non numerique ne doit jamais produire NaN dans la liste d'historique.
  const metre = { analysed: [{ numero: "1", ouvrageId: "a", quantiteOk: true }] };
  assert.equal(C.resumeMetre(metre, () => "abc").total, 0);
});

test("un metre neuf porte un identifiant vide, pret a etre attribue a l'import", () => {
  assert.equal(C.emptyMetre().id, "");
  const relu = C.normalizeState(
    { metre: { id: "m-1", fileName: "CSC.xlsx", rows: [], analysed: [] } },
    { catalog: CATALOG, uid: uidSequentiel(), onWarning: () => {} },
  );
  assert.equal(relu.metre.id, "m-1", "l'identifiant survit a une relecture de l'etat");
});

/* --------------------------------------------------------------- devis multiples */

test("numeroDevisSuivant incremente par annee, sans toucher aux autres formes", () => {
  const liste = [{ numero: "2026-001" }, { numero: "2026-007" }, { numero: "2025-030" }, { numero: "DEV-42" }];
  assert.equal(C.numeroDevisSuivant(liste, "2026"), "2026-008");
  assert.equal(C.numeroDevisSuivant(liste, "2025"), "2025-031");
  assert.equal(C.numeroDevisSuivant(liste, "2027"), "2027-001", "une annee neuve repart a 1");
  assert.equal(C.numeroDevisSuivant([], "2026"), "2026-001");
  assert.equal(C.numeroDevisSuivant(undefined, "2026"), "2026-001");
});

test("plusieurs devis coexistent, chacun avec son numero et ses lignes", () => {
  const etat = normaliser({
    devisList: [
      { id: "d1", numero: "2026-001", date: "2026-01-15", client: "Dupont", lignes: [{ ouvrageId: "a", quantite: 3 }] },
      { id: "d2", numero: "2026-002", date: "2026-02-20", client: "Martin", lignes: [] },
    ],
    devisCourantId: "d2",
  });
  assert.equal(etat.devisList.length, 2);
  assert.equal(etat.devisCourantId, "d2", "le devis ouvert est conserve");
  assert.equal(etat.devisList[0].lignes[0].quantite, 3);
  assert.equal(etat.devisList[1].lignes.length, 0);
});

test("un devis courant qui ne designe rien retombe sur le premier", () => {
  const etat = normaliser({
    devisList: [{ id: "d1", numero: "2026-001", lignes: [] }],
    devisCourantId: "supprime-depuis",
  });
  assert.equal(etat.devisCourantId, "d1");
});

test("une date de devis absente ou invalide reprend celle du jour", () => {
  const etat = normaliser({ devisList: [{ numero: "2026-004" }, { numero: "2026-005", date: "pas une date" }] });
  assert.equal(etat.devisList[0].date, "2026-09-02");
  assert.equal(etat.devisList[1].date, "2026-09-02");
});

test("supprimer un ouvrage laisse la ligne de chaque devis, marquee comme orpheline", () => {
  const etat = normaliser({
    ouvrages: [{ id: "a", nom: "Enduit", unite: "m2" }],
    devisList: [
      { id: "d1", numero: "2026-001", lignes: [{ ouvrageId: "a", quantite: 1 }] },
      { id: "d2", numero: "2026-002", lignes: [{ ouvrageId: "a", quantite: 2 }] },
    ],
  });
  C.supprimerOuvrage(etat, "a");
  // Volontaire : un devis deja remis au client ne doit pas perdre ses lignes, il les
  // affiche « ouvrage supprimé ».
  assert.equal(etat.devisList[0].lignes[0].ouvrageId, "a");
  assert.equal(etat.devisList[1].lignes[0].ouvrageId, "a");
});

test("fusionner deux ouvrages remappe les lignes de TOUS les devis", () => {
  const etat = normaliser({
    ouvrages: [
      { id: "a", nom: "Enduit", unite: "m2" },
      { id: "b", nom: "Peinture", unite: "m2" },
    ],
    devisList: [
      { id: "d1", numero: "2026-001", lignes: [{ ouvrageId: "a", quantite: 1 }] },
      { id: "d2", numero: "2026-002", lignes: [{ ouvrageId: "a", quantite: 2 }, { ouvrageId: "b", quantite: 5 }] },
    ],
  });
  C.fusionnerOuvrages(etat, "a", "b");
  assert.deepEqual(
    etat.devisList.flatMap((devis) => devis.lignes.map((ligne) => ligne.ouvrageId)),
    ["b", "b", "b"],
    "aucune ligne ne reste sur l'ouvrage fusionne, dans aucun devis",
  );
});

/* -------------------------------------------------------------- prix figés */

const OUVRAGE_FIGE = { id: "o1", nom: "Carrelage de sol", unite: "m2", heures: 0.55, materiel: 5, composants: [{ materiauId: "m1", quantite: 1 }] };
const MATERIAUX_FIGE = [{ id: "m1", nom: "Grès cérame", unite: "m2", prix: 26 }];
const REGLAGES_FIGE = { coutHoraire: 47.5, fraisGeneraux: 12, fraisChantier: 5, imprevus: 4, marge: 18 };

test("contextePrix photographie ce qui, dans les reglages, fait le prix", () => {
  const contexte = C.contextePrix(REGLAGES_FIGE);
  assert.equal(contexte.coutHoraire, 47.5);
  assert.equal(contexte.marge, 18);
  assert.equal(contexte.formuleK, "additive");
  assert.equal(contexte.coefficientK, C.coefficientK(REGLAGES_FIGE));
  const multi = C.contextePrix({ ...REGLAGES_FIGE, formuleK: "multiplicative" });
  assert.equal(multi.formuleK, "multiplicative");
  assert.ok(multi.coefficientK > contexte.coefficientK);
  // Des reglages absents ne doivent jamais produire NaN dans un document contractuel.
  const vide = C.contextePrix(undefined);
  assert.equal(vide.coutHoraire, 0);
  assert.equal(Number.isFinite(vide.coefficientK), true);
});

test("une ligne figee garde libelle, unite et prix, meme si l'ouvrage change ensuite", () => {
  const calcul = C.calculateOuvrage(OUVRAGE_FIGE, REGLAGES_FIGE, MATERIAUX_FIGE);
  const ligne = C.figerLigneDevis({ id: "l1", ouvrageId: "o1", quantite: 20 }, OUVRAGE_FIGE, calcul);
  assert.equal(ligne.nom, "Carrelage de sol");
  assert.equal(ligne.unite, "m2");
  assert.equal(ligne.puHtva, C.roundMoney(calcul.vente));
  assert.equal(ligne.coutDirect, C.roundMoney(calcul.direct));

  // L'ouvrage evolue : la ligne deja figee ne bouge pas.
  const apres = C.calculateOuvrage({ ...OUVRAGE_FIGE, heures: 0.9 }, REGLAGES_FIGE, MATERIAUX_FIGE);
  assert.ok(C.roundMoney(apres.vente) > ligne.puHtva);
  assert.equal(ligne.puHtva, C.roundMoney(calcul.vente), "la ligne figee est inchangee");
});

test("un ouvrage supprime ne rend pas la ligne illisible", () => {
  const ligne = C.figerLigneDevis({ id: "l1", ouvrageId: "disparu", quantite: 3, nom: "Plinthes", unite: "m", puHtva: 20.11 }, null, null);
  assert.equal(ligne.nom, "Plinthes");
  assert.equal(ligne.puHtva, 20.11);
  const sansRien = C.figerLigneDevis({ id: "l2", ouvrageId: "", quantite: 1 }, null, null);
  assert.equal(sansRien.nom, "Ouvrage supprimé");
  assert.equal(sansRien.puHtva, 0);
});

test("les totaux d'un devis sont lus sur les prix figes, jamais recalcules", () => {
  const devis = {
    tva: 21,
    lignes: [
      { id: "a", puHtva: 20.11, quantite: 20 },
      { id: "b", puHtva: 90.52, quantite: 4 },
    ],
  };
  const totaux = C.totauxDevis(devis);
  assert.equal(totaux.ht, 764.28, "20 × 20,11 + 4 × 90,52");
  assert.equal(totaux.tva, 160.5);
  assert.equal(totaux.ttc, 924.78);
  assert.deepEqual(C.totauxDevis({ tva: 0, lignes: [] }), { ht: 0, tva: 0, ttc: 0 });
  // TVA a 0 % (regime cocontractant) : le total TVAC vaut le HTVA.
  assert.equal(C.totauxDevis({ tva: 0, lignes: [{ puHtva: 100, quantite: 2 }] }).ttc, 200);
});

test("ecartsDevis chiffre la difference avec la bibliotheque d'aujourd'hui", () => {
  const devis = {
    lignes: [
      { id: "a", ouvrageId: "o1", puHtva: 20.11, quantite: 20 },
      { id: "b", ouvrageId: "o2", puHtva: 50, quantite: 2 },
      { id: "c", ouvrageId: "disparu", puHtva: 12, quantite: 1 },
    ],
  };
  const prix = { o1: 23.11, o2: 50 };
  const ecarts = C.ecartsDevis(devis, (id) => (id in prix ? prix[id] : null));

  assert.equal(ecarts.nbModifiees, 1, "seule la ligne dont le prix a bouge compte");
  assert.equal(ecarts.ecartTotal, 60, "3,00 € × 20");
  assert.equal(ecarts.lignes[1].ecart, 0, "prix identique : aucun ecart");
  assert.equal(ecarts.lignes[2].introuvable, true);
  assert.equal(ecarts.lignes[2].puActuel, null);
  assert.equal(
    ecarts.lignes[2].ecart,
    0,
    "un ouvrage disparu est un autre probleme : il ne gonfle pas le total des ecarts",
  );
});

test("les lignes d'un devis anterieur au figeage sont figees au prix du jour", () => {
  const etat = normaliser({
    settings: REGLAGES_FIGE,
    materiaux: MATERIAUX_FIGE,
    ouvrages: [OUVRAGE_FIGE],
    devis: { client: "Dupont", tva: 21, lignes: [{ ouvrageId: "o1", quantite: 20 }] },
  });
  const ligne = etat.devisList[0].lignes[0];
  const attendu = C.roundMoney(C.calculateOuvrage(OUVRAGE_FIGE, REGLAGES_FIGE, MATERIAUX_FIGE).vente);
  assert.equal(ligne.puHtva, attendu);
  assert.equal(ligne.nom, "Carrelage de sol");
  assert.equal(ligne.unite, "m2");
  assert.equal(etat.devisList[0].statut, "brouillon");
  assert.equal(etat.devisList[0].contexte.coutHoraire, 47.5);
});

test("un devis deja fige n'est pas repricé par une relecture de l'etat", () => {
  const etat = normaliser({
    settings: { ...REGLAGES_FIGE, coutHoraire: 80 },
    materiaux: MATERIAUX_FIGE,
    ouvrages: [OUVRAGE_FIGE],
    devisList: [
      {
        id: "d1",
        numero: "2026-001",
        statut: "fige",
        contexte: { coutHoraire: 47.5, coefficientK: 1.39, formuleK: "additive", fraisGeneraux: 12, fraisChantier: 5, imprevus: 4, marge: 18 },
        lignes: [{ id: "l1", ouvrageId: "o1", quantite: 20, nom: "Carrelage de sol", unite: "m2", puHtva: 79.4, coutDirect: 57.13 }],
      },
    ],
  });
  const devis = etat.devisList[0];
  assert.equal(devis.statut, "fige");
  assert.equal(devis.lignes[0].puHtva, 79.4, "le coût horaire passé à 80 ne touche pas un devis figé");
  assert.equal(devis.contexte.coutHoraire, 47.5, "le contexte d'origine est conservé");
  assert.equal(C.totauxDevis(devis).ht, 1588);
});
