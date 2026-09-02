/*
 * core.js — logique metier pure (calcul, rapprochement, lecture de metre).
 * Aucune dependance au DOM : tout est testable en dehors du navigateur.
 */
(function (root) {
  "use strict";

  const STOP_WORDS = new Set([
    "aux", "avec", "com", "compris", "comprise", "comprises", "dans", "des", "deux", "les", "par",
    "pour", "sur", "une", "un", "de", "du", "la", "le", "et", "ou", "en", "au", "y", "ses", "son",
    "sa", "ces", "cet", "cette", "tout", "toute", "toutes", "tous", "type", "suivant", "selon",
  ]);

  const UNIT_ALIASES = {
    pc: "pce",
    pcs: "pce",
    p: "pce",
    piece: "pce",
    pieces: "pce",
    u: "pce",
    unite: "pce",
    ml: "m",
    mc: "m3",
    ff: "ff",
    fft: "ff",
    forfait: "ff",
    qf: "ff",
    kgs: "kg",
    l: "litre",
    lt: "litre",
    litres: "litre",
    h: "h",
    hr: "h",
    heure: "h",
    heures: "h",
  };

  const FAMILY_RULES = [
    ["Démolition / dépose", ["demolition", "depose", "piquage", "decoupe", "sciage", "demontage"]],
    ["Installation / protection chantier", ["installation", "chantier", "echafaudage", "bachage", "protection", "cloture", "securisation", "signalisation"]],
    ["Évacuation déchets", ["evacuation", "dechets", "conteneur", "container", "decharge", "tri"]],
    ["Maçonnerie / béton", ["maconnerie", "brique", "beton", "baies", "linteau", "seuil", "rejointoiement", "armature"]],
    ["Façade", ["facade", "enduit", "siloxane", "soubassement", "cimentage", "crepi"]],
    ["Étanchéité", ["etancheite", "epdm", "bitumineuse", "membrane", "solin", "releve", "roofing"]],
    ["Isolation", ["isolation", "isolant", "pir", "laine", "pare vapeur", "parevapeur"]],
    ["Peinture", ["peinture", "peindre", "vernis", "lasure"]],
    ["Plafonnage / faux plafond", ["plafonnage", "plafond", "ba13", "ossature", "lissage", "platre"]],
    ["Chape / revêtement sol", ["chape", "carrelage", "gres", "faience", "revetement", "parquet"]],
    ["Menuiserie", ["chassis", "porte", "menuiserie", "quincaillerie", "vitrage", "garde corps"]],
    ["Sanitaire", ["wc", "sanitaire", "multicouche", "alimentation", "tuyauterie", "lavabo", "douche"]],
    ["Électricité", ["prise", "terre", "rgie", "electricite", "equipotentielle", "conformite", "luminaire", "cable"]],
  ];

  const FAMILY_PREFIXES = {
    "Installation / protection chantier": "GEN",
    "Évacuation déchets": "GEN",
    "Démolition / dépose": "DEM",
    "Maçonnerie / béton": "MAC",
    "Façade": "FAC",
    "Étanchéité": "ETA",
    "Isolation": "ISO",
    "Plafonnage / faux plafond": "PAR",
    "Chape / revêtement sol": "REV",
    "Peinture": "PEI",
    "Menuiserie": "MEN",
    "Sanitaire": "SAN",
    "Électricité": "ELE",
  };

  /* ------------------------------------------------------------------ texte */

  // Minuscules, sans accents : sert a comparer libelles et en-tetes.
  function normalizeText(value) {
    return String(value ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[‘’ʼ]/g, "'")
      .trim();
  }

  function isPourMemoire(description) {
    const text = normalizeText(description);
    return text.includes("pour memoire") || text.includes("hors marche");
  }

  function tokenize(value) {
    return normalizeText(value)
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
  }

  // Retire un code de poste place en tete de libelle ("03.02 - Enduit" -> "Enduit").
  function stripLeadingCode(value) {
    return String(value ?? "")
      .replace(/^\s*[A-Za-z]{0,3}\d{1,3}(?:[.\-/]\d{1,3})*(?:[.\-][a-zA-Z])?\s*[-–—:]\s*/, "")
      .trim();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /* ------------------------------------------------------------------ unites */

  function normalizeUnit(unit) {
    const cleaned = normalizeText(unit)
      .replace(/²/g, "2")
      .replace(/³/g, "3")
      .replace(/\bmetres?\b/g, "m")
      .replace(/\bcarres?\b/g, "2")
      .replace(/[\s.]/g, "");
    if (!cleaned) return "";
    return UNIT_ALIASES[cleaned] || cleaned;
  }

  function isForfaitUnit(unit) {
    return normalizeUnit(unit) === "ff";
  }

  /*
   * Un forfait accepte n'importe quelle unite : le prix est global. Mais un prix
   * global ne se multiplie pas : face a une quantite autre que 1, le forfait n'est
   * plus compatible — sinon « Installation de chantier » (FF, 1 675 €) rapproche
   * d'un poste m2 x 180 donnait 301 500 €, a 100 % de confiance. Sans quantite
   * connue (absente, nulle : la ligne n'est de toute facon pas chiffrable), le
   * joker reste accepte comme avant.
   */
  function unitsCompatible(a, b, quantite) {
    const left = normalizeUnit(a);
    const right = normalizeUnit(b);
    if (!left || !right) return true;
    if (left === right) return true;
    if (left !== "ff" && right !== "ff") return false;
    if (quantite === undefined || quantite === null || quantite === "") return true;
    const q = Number(quantite);
    return !Number.isFinite(q) || q === 0 || q === 1;
  }

  /* ------------------------------------------------------------------ nombres */

  // Evalue une expression arithmetique simple sans eval ni Function.
  function evaluateArithmetic(expression) {
    const source = String(expression).replace(/\s+/g, "");
    if (!/^[\d.+\-*/()]+$/.test(source)) return Number.NaN;

    const output = [];
    const operators = [];
    const precedence = { "+": 1, "-": 1, "*": 2, "/": 2, u: 3 };
    let index = 0;
    let expectValue = true;

    const applyTop = () => {
      const operator = operators.pop();
      if (operator === "u") {
        const value = output.pop();
        if (value === undefined) return false;
        output.push(-value);
        return true;
      }
      const right = output.pop();
      const left = output.pop();
      if (left === undefined || right === undefined) return false;
      if (operator === "+") output.push(left + right);
      else if (operator === "-") output.push(left - right);
      else if (operator === "*") output.push(left * right);
      else if (operator === "/") output.push(right === 0 ? Number.NaN : left / right);
      else return false;
      return true;
    };

    while (index < source.length) {
      const char = source[index];
      if (/[\d.]/.test(char)) {
        let end = index;
        while (end < source.length && /[\d.]/.test(source[end])) end += 1;
        const value = Number(source.slice(index, end));
        if (!Number.isFinite(value)) return Number.NaN;
        output.push(value);
        index = end;
        expectValue = false;
        continue;
      }
      if (char === "(") {
        operators.push(char);
        expectValue = true;
      } else if (char === ")") {
        while (operators.length && operators[operators.length - 1] !== "(") {
          if (!applyTop()) return Number.NaN;
        }
        if (operators.pop() !== "(") return Number.NaN;
        expectValue = false;
      } else {
        const operator = expectValue && (char === "-" || char === "+") ? "u" : char;
        if (operator === "u" && char === "+") {
          index += 1;
          continue;
        }
        while (
          operators.length &&
          operators[operators.length - 1] !== "(" &&
          precedence[operators[operators.length - 1]] >= precedence[operator]
        ) {
          if (!applyTop()) return Number.NaN;
        }
        operators.push(operator);
        expectValue = true;
      }
      index += 1;
    }

    while (operators.length) {
      if (operators[operators.length - 1] === "(") return Number.NaN;
      if (!applyTop()) return Number.NaN;
    }
    return output.length === 1 ? output[0] : Number.NaN;
  }

  // Accepte 1 234,56 / 1.234,56 / =32*7.5 / "12 m2".
  function parseNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN;
    let text = String(value ?? "").trim();
    if (!text) return Number.NaN;
    if (text.startsWith("=")) return evaluateArithmetic(text.slice(1));

    text = text.replace(/[\s ']/g, "");
    const lastComma = text.lastIndexOf(",");
    const lastDot = text.lastIndexOf(".");
    if (lastComma > -1 && lastDot > -1) {
      // Le separateur decimal est le dernier des deux ; l'autre groupe les milliers.
      text = lastComma > lastDot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
    } else if (lastComma > -1) {
      text = text.replace(",", ".");
    }
    const match = text.match(/-?\d*\.?\d+/);
    return match ? Number(match[0]) : Number.NaN;
  }

  function roundMoney(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  /* ------------------------------------------------------------------ calcul */

  function coefficientPercent(settings) {
    return (
      (Number(settings?.fraisGeneraux) || 0) +
      (Number(settings?.fraisChantier) || 0) +
      (Number(settings?.imprevus) || 0) +
      (Number(settings?.marge) || 0)
    );
  }

  function coefficientKMultiplicatif(settings) {
    return (
      (1 + (Number(settings?.fraisGeneraux) || 0) / 100) *
      (1 + (Number(settings?.fraisChantier) || 0) / 100) *
      (1 + (Number(settings?.imprevus) || 0) / 100) *
      (1 + (Number(settings?.marge) || 0) / 100)
    );
  }

  function coefficientK(settings) {
    if (settings?.formuleK === "multiplicative") return coefficientKMultiplicatif(settings);
    return 1 + coefficientPercent(settings) / 100;
  }

  /*
   * Un ouvrage reel combine plusieurs fournitures (isolant + enduit + accessoires).
   * Il est donc decrit par une liste de composants { materiauId, quantite }, ou la
   * quantite s'entend par unite d'ouvrage.
   *
   * Le modele historique ne portait qu'un materiau (materiauId + quantiteMateriau) :
   * il est relu ici pour que les donnees deja enregistrees restent calculables.
   */
  function composantsOf(ouvrage) {
    const declared = (Array.isArray(ouvrage?.composants) ? ouvrage.composants : [])
      .map((composant) => ({
        materiauId: String(composant?.materiauId ?? "").trim(),
        quantite: Number(composant?.quantite) || 0,
      }))
      .filter((composant) => composant.materiauId);
    if (declared.length) return declared;
    const ancien = String(ouvrage?.materiauId ?? "").trim();
    return ancien ? [{ materiauId: ancien, quantite: Number(ouvrage?.quantiteMateriau) || 0 }] : [];
  }

  // Accepte une fonction, une Map ou un tableau de materiaux — au choix de l'appelant.
  function materialResolver(materiaux) {
    if (typeof materiaux === "function") return materiaux;
    if (materiaux instanceof Map) return (id) => materiaux.get(id);
    if (Array.isArray(materiaux)) {
      const byId = new Map(materiaux.map((materiau) => [materiau?.id, materiau]));
      return (id) => byId.get(id);
    }
    return () => undefined;
  }

  // Chaque composant, prix resolu : c'est le detail affiche sous « Justifier ce prix ».
  function composantsDetail(ouvrage, materiaux) {
    const find = materialResolver(materiaux);
    return composantsOf(ouvrage).map((composant) => {
      const materiau = find(composant.materiauId);
      const prix = Number(materiau?.prix) || 0;
      return {
        materiauId: composant.materiauId,
        quantite: composant.quantite,
        nom: materiau?.nom || "",
        unite: materiau?.unite || "",
        prix,
        montant: composant.quantite * prix,
        // Un materiau supprime laisse la reference en place : il faut le signaler
        // plutot que de chiffrer silencieusement l'ouvrage a zero.
        introuvable: !materiau,
      };
    });
  }

  // Decomposition complete d'un prix de vente unitaire — sert aussi a le justifier.
  function calculateOuvrage(ouvrage, settings, materiaux) {
    const heures = Number(ouvrage?.heures) || 0;
    const coutHoraire = Number(settings?.coutHoraire) || 0;
    const mainOeuvre = heures * coutHoraire;
    const composants = composantsDetail(ouvrage, materiaux);
    const matieres = composants.reduce((sum, composant) => sum + composant.montant, 0);
    const materiel = Number(ouvrage?.materiel) || 0;
    const direct = mainOeuvre + matieres + materiel;
    const k = coefficientK(settings);
    return {
      heures,
      coutHoraire,
      mainOeuvre,
      composants,
      matieres,
      materiel,
      direct,
      coefficientK: k,
      fraisMarge: direct * (k - 1),
      vente: direct * k,
    };
  }

  /* ------------------------------------------------------- retour de chantier */

  /*
   * Ce que le chantier a reellement coute, releve poste par poste :
   *   - main-d'oeuvre : une quantite realisee et les heures qu'elle a demandees,
   *     saisies comme « n personnes pendant h heures » ;
   *   - achats : la quantite facturee et le montant paye, d'ou le prix reellement
   *     obtenu chez le fournisseur.
   * Ces releves ne modifient rien par eux-memes : ils servent a comparer, puis a
   * recaler la bibliotheque quand l'entreprise le decide.
   */

  function heuresReleve(releve) {
    const personnes = Number(releve?.personnes) || 0;
    const duree = Number(releve?.duree) || 0;
    return personnes * duree;
  }

  // Rendement constate, en heures par unite d'ouvrage.
  function rendementReleve(releve) {
    const quantite = Number(releve?.quantite) || 0;
    return quantite > 0 ? heuresReleve(releve) / quantite : 0;
  }

  // Prix reellement obtenu, dans l'unite de prix du materiau.
  function prixAchat(achat) {
    const quantite = Number(achat?.quantite) || 0;
    return quantite > 0 ? (Number(achat?.montant) || 0) / quantite : 0;
  }

  function roundHeures(value) {
    return Math.round((Number(value) || 0) * 10000) / 10000;
  }

  /*
   * Ecart relatif entre prevision et realite. Sans prevision, l'ecart n'a pas de sens.
   * Le resultat est arrondi : un ecart sert a franchir un seuil d'alerte, et
   * (0,5 - 0,4) / 0,4 vaut 0,2499999... en virgule flottante.
   */
  function ecartRelatif(prevu, reel) {
    const base = Number(prevu) || 0;
    if (!base) return null;
    return Math.round((((Number(reel) || 0) - base) / base) * 1e6) / 1e6;
  }

  /*
   * Un seul chantier ne fait pas un rendement : les releves sont cumules sur tous
   * les chantiers enregistres, ponderes par les quantites realisees. Un poste fait
   * une fois sur 5 m2 pese donc moins qu'un poste fait trois fois sur 400 m2.
   */
  function observerRendements(chantiers) {
    const observations = new Map();
    (chantiers || []).forEach((chantier) => {
      (chantier?.mainOeuvre || []).forEach((releve) => {
        const quantite = Number(releve?.quantite) || 0;
        if (!releve?.ouvrageId || quantite <= 0) return;
        if (!observations.has(releve.ouvrageId)) {
          observations.set(releve.ouvrageId, { quantite: 0, heures: 0, releves: 0, chantiers: new Set() });
        }
        const observation = observations.get(releve.ouvrageId);
        observation.quantite += quantite;
        observation.heures += heuresReleve(releve);
        observation.releves += 1;
        observation.chantiers.add(chantier.id);
      });
    });
    observations.forEach((observation) => {
      observation.chantiers = observation.chantiers.size;
      observation.rendement = observation.quantite > 0 ? observation.heures / observation.quantite : 0;
    });
    return observations;
  }

  // Meme principe pour les prix d'achat : moyenne ponderee par les quantites facturees.
  function observerPrixMateriaux(chantiers) {
    const observations = new Map();
    (chantiers || []).forEach((chantier) => {
      (chantier?.achats || []).forEach((achat) => {
        const quantite = Number(achat?.quantite) || 0;
        if (!achat?.materiauId || quantite <= 0) return;
        if (!observations.has(achat.materiauId)) {
          observations.set(achat.materiauId, { quantite: 0, montant: 0, achats: 0, chantiers: new Set(), date: "" });
        }
        const observation = observations.get(achat.materiauId);
        observation.quantite += quantite;
        observation.montant += Number(achat?.montant) || 0;
        observation.achats += 1;
        observation.chantiers.add(chantier.id);
        // La date la plus recente datera le prix recale.
        if (chantier.date && chantier.date > observation.date) observation.date = chantier.date;
      });
    });
    observations.forEach((observation) => {
      observation.chantiers = observation.chantiers.size;
      observation.prix = observation.quantite > 0 ? observation.montant / observation.quantite : 0;
    });
    return observations;
  }

  /*
   * Bilan d'un chantier : ce qu'il a rapporte, ce qu'il devait couter d'apres la
   * bibliotheque, ce qu'il a reellement coute.
   *
   * Le forfait « materiel et accessoires » n'est pas releve : il est repris tel quel
   * du prix prevu, faute de mieux, et compte donc a l'identique des deux cotes.
   */
  function bilanChantier(chantier, ouvrages, materiaux, settings) {
    const trouverOuvrage = materialResolver(ouvrages);
    const trouverMateriau = materialResolver(materiaux);
    const coutHoraire = Number(settings?.coutHoraire) || 0;

    const lignes = (chantier?.mainOeuvre || []).map((releve) => {
      const ouvrage = trouverOuvrage(releve.ouvrageId);
      const quantite = Number(releve?.quantite) || 0;
      const heures = heuresReleve(releve);
      const calc = ouvrage ? calculateOuvrage(ouvrage, settings, materiaux) : null;
      const rendementPrevu = Number(ouvrage?.heures) || 0;
      const rendementReel = rendementReleve(releve);
      return {
        releveId: releve.id,
        ouvrageId: releve.ouvrageId,
        ouvrage,
        quantite,
        personnes: Number(releve?.personnes) || 0,
        duree: Number(releve?.duree) || 0,
        heures,
        rendementPrevu,
        rendementReel,
        ecart: ecartRelatif(rendementPrevu, rendementReel),
        heuresPrevues: rendementPrevu * quantite,
        recette: calc ? calc.vente * quantite : 0,
        prevuMainOeuvre: rendementPrevu * quantite * coutHoraire,
        prevuMatieres: calc ? calc.matieres * quantite : 0,
        materiel: calc ? calc.materiel * quantite : 0,
        reelMainOeuvre: heures * coutHoraire,
      };
    });

    const achats = (chantier?.achats || []).map((achat) => {
      const materiau = trouverMateriau(achat.materiauId);
      const prix = prixAchat(achat);
      return {
        achatId: achat.id,
        materiauId: achat.materiauId,
        materiau,
        quantite: Number(achat?.quantite) || 0,
        montant: Number(achat?.montant) || 0,
        prix,
        prixBibliotheque: Number(materiau?.prix) || 0,
        ecart: ecartRelatif(Number(materiau?.prix) || 0, prix),
      };
    });

    const somme = (liste, champ) => liste.reduce((total, item) => total + item[champ], 0);
    const materiel = somme(lignes, "materiel");
    const prevu = {
      mainOeuvre: somme(lignes, "prevuMainOeuvre"),
      matieres: somme(lignes, "prevuMatieres"),
      materiel,
      heures: somme(lignes, "heuresPrevues"),
    };
    prevu.direct = prevu.mainOeuvre + prevu.matieres + prevu.materiel;
    const reel = {
      mainOeuvre: somme(lignes, "reelMainOeuvre"),
      matieres: somme(achats, "montant"),
      materiel,
      heures: somme(lignes, "heures"),
    };
    reel.direct = reel.mainOeuvre + reel.matieres + reel.materiel;
    const recette = somme(lignes, "recette");

    return {
      lignes,
      achats,
      recette,
      prevu,
      reel,
      ecartDirect: reel.direct - prevu.direct,
      margePrevue: recette - prevu.direct,
      margeReelle: recette - reel.direct,
      // Sans releve d'achat, la marge reelle n'est pas comparable : il manque les matieres.
      achatsManquants: lignes.length > 0 && achats.length === 0,
    };
  }

  /* ---------------------------------------------------------- peremption des prix */

  /*
   * Un materiau sans date de prix n'a pas d'age calculable : c'est deja signale
   * ailleurs (« prix non date »), et ce n'est pas ce qu'on cherche ici. La
   * peremption ne porte que sur les prix effectivement dates.
   */
  function joursDepuisPrix(datePrix, reference) {
    const debut = new Date(`${String(datePrix ?? "").trim()}T00:00:00`);
    if (Number.isNaN(debut.getTime())) return null;
    const fin = reference instanceof Date ? reference : new Date(reference);
    /*
     * Comparer directement les millisecondes suppose qu'une journee vaut toujours
     * 86 400 000 ms — faux au passage heure d'ete/hiver (23h ou 25h). On compare
     * plutot les seules dates civiles (annee/mois/jour locaux), chacune ramenee a
     * minuit UTC : le nombre de jours entre les deux devient alors exact, quels que
     * soient les changements d'heure traverses entre les deux dates.
     */
    const auxMinuitUtc = (date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    return Math.floor((auxMinuitUtc(fin) - auxMinuitUtc(debut)) / 86400000);
  }

  // seuilJours <= 0 : l'alerte est desactivee, aucun prix n'est jamais signale perime.
  function prixPerime(materiau, reference, seuilJours) {
    const jours = joursDepuisPrix(materiau?.datePrix, reference);
    const seuil = Number(seuilJours) || 0;
    return { jours, perime: jours !== null && seuil > 0 && jours >= seuil };
  }

  // Les plus perimes en tete : ce sont ceux qu'il est le plus urgent de revoir.
  function materiauxPerimes(materiaux, reference, seuilJours) {
    return (materiaux || [])
      .map((materiau) => ({ materiau, ...prixPerime(materiau, reference, seuilJours) }))
      .filter((item) => item.perime)
      .sort((a, b) => b.jours - a.jours);
  }

  /* ------------------------------------------------------------------ codes */

  function isInternalCode(value) {
    return /^[A-Z]{3}\.\d{3}$/i.test(String(value ?? "").trim());
  }

  function classifyFamily(description) {
    const text = normalizeText(description);
    const rule = FAMILY_RULES.find(([, words]) => words.some((word) => text.includes(word)));
    return rule ? rule[0] : "À classer";
  }

  function internalCodePrefix(name) {
    return FAMILY_PREFIXES[classifyFamily(name)] || "OUV";
  }

  function nextInternalCode(usedCodes, name) {
    const prefix = internalCodePrefix(name);
    let index = 1;
    let code = `${prefix}.${String(index).padStart(3, "0")}`;
    while (usedCodes.has(code)) {
      index += 1;
      code = `${prefix}.${String(index).padStart(3, "0")}`;
    }
    return code;
  }

  /*
   * Normalise un code de metre pour la comparaison : seuls les separateurs et la
   * casse sont uniformises. Les zeros de tete sont significatifs : un cahier des
   * charges numerote "01.01" (lot 01) quand un autre ecrit "1.01" (lot 1), et ces
   * deux postes n'ont rien a voir.
   */
  function normalizeRef(value) {
    return normalizeText(value).replace(/\s/g, "").replace(/[\-/]/g, ".");
  }

  function normalizeRefList(values) {
    const list = [];
    const seen = new Set();
    values
      .flatMap((value) => (Array.isArray(value) ? value : String(value ?? "").split(/[;,]/)))
      .map((value) => String(value ?? "").trim())
      .filter((value) => value && !isInternalCode(value))
      .forEach((value) => {
        const key = normalizeRef(value);
        if (!key || seen.has(key)) return;
        seen.add(key);
        list.push(value);
      });
    return list;
  }

  function normalizeKeywords(values) {
    const seen = new Set();
    return values
      .flatMap((value) => String(value ?? "").split(","))
      .map((value) => value.trim())
      .filter((value) => {
        const key = normalizeText(value);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .join(", ");
  }

  function getLotCode(value) {
    const match = String(value ?? "").trim().match(/^(\d{1,2})[.\s\-]/);
    return match ? match[1].padStart(2, "0") : "";
  }

  /* ------------------------------------------------------------ rapprochement */

  // Score 0..1 : couverture des mots de la description par l'ouvrage, et inversement.
  function matchScore(description, ouvrage, cache) {
    const descTokens = tokenize(description);
    if (!descTokens.length) return 0;

    let haystack = cache && cache.get(ouvrage.id);
    if (!haystack) {
      haystack = new Set(tokenize(`${ouvrage.nom || ""} ${ouvrage.motsCles || ""}`));
      if (cache) cache.set(ouvrage.id, haystack);
    }
    if (!haystack.size) return 0;

    const hayList = Array.from(haystack);
    const covers = (token) => {
      if (haystack.has(token)) return 1;
      return hayList.some((word) => word.startsWith(token) || token.startsWith(word)) ? 0.6 : 0;
    };

    const descCover = descTokens.reduce((sum, token) => sum + covers(token), 0) / descTokens.length;
    const nameTokens = tokenize(ouvrage.nom);
    const descSet = new Set(descTokens);
    const nameCover = nameTokens.length
      ? nameTokens.reduce((sum, token) => sum + (descSet.has(token) ? 1 : 0), 0) / nameTokens.length
      : 0;

    return descCover * 0.7 + nameCover * 0.3;
  }

  const MATCH_THRESHOLD = 0.34;

  /*
   * Rapproche une ligne de metre d'un ouvrage.
   * 1. code appris sur cette commune (communeCodes) -> certitude, propre au marche
   * 2. sinon, UNIQUEMENT si aucune commune n'est renseignee pour cet import : code
   *    deja connu (refsMetre du catalogue, partage entre marches) -> certitude
   * 3. sinon meilleur score parmi les ouvrages d'unite compatible
   * 4. si le meilleur score global a une unite incompatible, on le signale sans le retenir
   *
   * communeCodes vaut null/undefined quand aucune commune n'est renseignee (anciens
   * fichiers, comportement historique) ; un objet (meme vide {}) des qu'une commune
   * est active. Dans ce second cas, un code absent de communeCodes ne doit JAMAIS
   * retomber sur le refsMetre global : ce serait appliquer a une commune inconnue la
   * codification apprise sur un tout autre marche — exactement le risque que le
   * mapping par commune est cense eliminer.
   */
  function findMatch(row, ouvrages, cache, communeCodes) {
    // Un numero fabrique faute de colonne N° (« 1 », « 2 »…) n'est pas un code : le
    // chercher dans les codes appris rapprocherait la premiere ligne de n'importe quel
    // metre sans numero de l'ouvrage confirme sur la premiere ligne d'un autre.
    const codes = row.numeroSynthetique
      ? []
      : [row.poste, row.numero]
          .map(normalizeRef)
          .filter(Boolean);
    const communeActive = communeCodes !== null && communeCodes !== undefined;

    if (codes.length && communeActive) {
      const mappedId = codes.map((code) => communeCodes[code]).find(Boolean);
      const mapped = mappedId ? ouvrages.find((ouvrage) => ouvrage.id === mappedId) : null;
      if (mapped) {
        // Meme garde-fou que pour un code connu du catalogue : l'unite reste eliminatoire.
        if (!unitsCompatible(mapped.unite, row.unite, row.quantite)) {
          return { ouvrageId: "", confidence: 1, reason: "", unitWarning: true, suggestionId: mapped.id };
        }
        return { ouvrageId: mapped.id, confidence: 1, reason: "code connu (commune)", unitWarning: false, suggestionId: "" };
      }
      // Commune active mais code inconnu pour elle : pas de retour au refsMetre
      // global, on passe directement au rapprochement par libelle plus bas.
    } else if (codes.length) {
      const byCode = ouvrages.find((ouvrage) =>
        (ouvrage.refsMetre || []).some((ref) => codes.includes(normalizeRef(ref))),
      );
      if (byCode) {
        // L'unite est eliminatoire, pas departageante : un code connu dont l'unite ne
        // correspond plus n'est jamais applique tel quel, seulement suggere. Sans ce
        // garde-fou, un poste au m pouvait etre chiffre — et exporte — avec un ouvrage
        // au m2 simplement parce que le code de metre avait ete appris ailleurs.
        if (!unitsCompatible(byCode.unite, row.unite, row.quantite)) {
          return { ouvrageId: "", confidence: 1, reason: "", unitWarning: true, suggestionId: byCode.id };
        }
        return { ouvrageId: byCode.id, confidence: 1, reason: "code connu", unitWarning: false, suggestionId: "" };
      }
    }

    let best = null;
    let bestIncompatible = null;
    ouvrages.forEach((ouvrage) => {
      const score = matchScore(row.description, ouvrage, cache);
      if (score <= 0) return;
      if (unitsCompatible(ouvrage.unite, row.unite, row.quantite)) {
        if (!best || score > best.score) best = { ouvrage, score };
      } else if (!bestIncompatible || score > bestIncompatible.score) {
        bestIncompatible = { ouvrage, score };
      }
    });

    if (best && best.score >= MATCH_THRESHOLD) {
      return {
        ouvrageId: best.ouvrage.id,
        confidence: Math.min(0.99, best.score),
        reason: "libellé",
        unitWarning: false,
        suggestionId: "",
      };
    }

    // Rien de retenu : on garde la piste la plus proche pour aider l'utilisateur.
    const fallback = bestIncompatible && (!best || bestIncompatible.score > best.score) ? bestIncompatible : best;
    return {
      ouvrageId: "",
      confidence: fallback ? fallback.score : 0,
      reason: "",
      unitWarning: Boolean(bestIncompatible && fallback === bestIncompatible && fallback.score >= MATCH_THRESHOLD),
      suggestionId: fallback && fallback.score >= 0.2 ? fallback.ouvrage.id : "",
    };
  }

  /*
   * Proximite technique entre un nouvel ouvrage en cours de saisie (pas encore
   * enregistre, donc sans id) et un ouvrage existant du catalogue : combine le
   * libelle, les matieres reellement partagees et la proximite du rendement/materiel.
   * Sert a proposer "utiliser l'existant" avant de creer un quasi-doublon.
   */
  // Detail par signal (libelle/composition/rendement/materiel) en plus du score
  // global : un seul pourcentage masque "les deux se ressemblent, seule la
  // composition differe", ce que le detail rend visible d'un coup d'oeil.
  function ouvrageProximityDetail(payload, ouvrage) {
    if (normalizeUnit(payload.unite) !== normalizeUnit(ouvrage.unite)) {
      return { score: 0, textScore: 0, composantScore: null, rendementScore: null, materielScore: null };
    }

    const textScore = matchScore(payload.nom, ouvrage, null);

    // Mêmes matières ne suffit pas : deux ouvrages avec les trois mêmes materiauId
    // mais des dosages sans rapport (8,5 kg vs 20 kg) ne sont pas le même ouvrage.
    // Le score combine donc la présence des matières (40 %) et la proximité de leurs
    // quantités (60 %) — une matière absente d'un des deux côtés compte pour 0 dans
    // les deux, comme le ferait un indice de Jaccard seul.
    const payloadMap = new Map((payload.composants || []).filter((c) => c.materiauId).map((c) => [c.materiauId, Number(c.quantite) || 0]));
    const ouvrageMap = new Map((ouvrage.composants || []).filter((c) => c.materiauId).map((c) => [c.materiauId, Number(c.quantite) || 0]));
    let composantScore = null;
    if (payloadMap.size || ouvrageMap.size) {
      const tousIds = new Set([...payloadMap.keys(), ...ouvrageMap.keys()]);
      const communs = [...payloadMap.keys()].filter((id) => ouvrageMap.has(id));
      const presenceScore = communs.length / tousIds.size;
      const quantiteScore =
        communs.reduce((sum, id) => {
          const a = payloadMap.get(id);
          const b = ouvrageMap.get(id);
          const proximite = a === 0 && b === 0 ? 1 : Math.min(a, b) / Math.max(a, b, 1e-6);
          return sum + proximite;
        }, 0) / tousIds.size;
      composantScore = presenceScore * 0.4 + quantiteScore * 0.6;
    }

    const closeness = (a, b) => {
      const na = Number(a) || 0;
      const nb = Number(b) || 0;
      if (!na && !nb) return null;
      return 1 - Math.min(1, Math.abs(na - nb) / Math.max(na, nb, 0.01));
    };
    const rendementScore = closeness(payload.heures, ouvrage.heures);
    const materielScore = closeness(payload.materiel, ouvrage.materiel);

    const terms = [
      { value: textScore, weight: 0.4 },
      { value: composantScore, weight: 0.35 },
      { value: rendementScore, weight: 0.15 },
      { value: materielScore, weight: 0.1 },
    ].filter((term) => term.value !== null);
    const totalWeight = terms.reduce((sum, term) => sum + term.weight, 0);
    const score = totalWeight ? terms.reduce((sum, term) => sum + term.value * term.weight, 0) / totalWeight : textScore;

    return { score, textScore, composantScore, rendementScore, materielScore };
  }

  function ouvrageProximity(payload, ouvrage) {
    return ouvrageProximityDetail(payload, ouvrage).score;
  }

  // Le candidat le plus proche parmi le catalogue, ou null si rien d'assez proche.
  function bestOuvrageMatch(payload, ouvrages) {
    let best = null;
    ouvrages.forEach((ouvrage) => {
      const detail = ouvrageProximityDetail(payload, ouvrage);
      if (detail.score > 0 && (!best || detail.score > best.score)) best = { ouvrage, score: detail.score, detail };
    });
    return best;
  }

  /* ------------------------------------------------------------------ doublons */

  function findDuplicates(ouvrages, priceOf) {
    const tokensById = new Map();
    const tokensFor = (ouvrage) => {
      if (!tokensById.has(ouvrage.id)) tokensById.set(ouvrage.id, tokenize(ouvrage.nom));
      return tokensById.get(ouvrage.id);
    };
    const priceById = new Map();
    const priceFor = (ouvrage) => {
      if (!priceById.has(ouvrage.id)) priceById.set(ouvrage.id, priceOf(ouvrage));
      return priceById.get(ouvrage.id);
    };

    const duplicates = [];
    for (let i = 0; i < ouvrages.length; i += 1) {
      for (let j = i + 1; j < ouvrages.length; j += 1) {
        const left = ouvrages[i];
        const right = ouvrages[j];
        if (normalizeUnit(left.unite) !== normalizeUnit(right.unite)) continue;

        const leftTokens = tokensFor(left);
        const rightTokens = tokensFor(right);
        if (!leftTokens.length || !rightTokens.length) continue;
        const common = leftTokens.filter((token) => rightTokens.includes(token)).length;
        const textScore = common / Math.min(leftTokens.length, rightTokens.length);
        if (textScore < 0.45) continue;

        const leftPrice = priceFor(left);
        const rightPrice = priceFor(right);
        const reference = Math.max(leftPrice, rightPrice);
        const priceGap = reference ? Math.abs(leftPrice - rightPrice) / reference : 0;
        const score = textScore * 0.7 + (1 - Math.min(priceGap, 0.5) / 0.5) * 0.3;
        if (score < 0.58) continue;

        duplicates.push({ score, textScore, priceGap, unite: normalizeUnit(left.unite), items: [left, right] });
      }
    }
    return duplicates.sort((a, b) => b.score - a.score);
  }

  /* ------------------------------------------------------------ lecture metre */

  function findHeader(headers, candidates) {
    const normalized = headers.map((header) => ({
      raw: header,
      normalized: normalizeText(header),
      // "P.U. (€)" -> "pu" : la ponctuation interne varie d'un cahier a l'autre.
      compact: normalizeText(header).replace(/[^a-z0-9]/g, ""),
    }));
    for (const candidate of candidates) {
      const exact = normalized.find((entry) => entry.normalized === candidate);
      if (exact) return exact.raw;
    }
    for (const candidate of candidates) {
      const compact = candidate.replace(/[^a-z0-9]/g, "");
      const hit = compact && normalized.find((entry) => entry.compact === compact);
      if (hit) return hit.raw;
    }
    for (const candidate of candidates) {
      const word = normalized.find((entry) => entry.normalized.split(/[^a-z0-9]+/).includes(candidate));
      if (word) return word.raw;
    }
    for (const candidate of candidates.filter((entry) => entry.length > 1)) {
      const partial = normalized.find((entry) => entry.normalized.includes(candidate));
      if (partial) return partial.raw;
    }
    return "";
  }

  const HEADER_CANDIDATES = {
    poste: ["poste", "n poste", "no poste", "numero poste", "code", "numero", "n", "no", "rubrique"],
    description: ["designation", "description", "libelle", "ouvrage", "travaux", "denomination"],
    unite: ["unite", "u", "un"],
    quantite: ["quantite", "qte", "qt", "qty", "quantites"],
    prixUnitaire: ["pu", "pu htva", "p u", "prix unitaire", "prix", "pu hors tva", "pu e"],
  };

  function findHeaderRowIndex(grid) {
    return grid.findIndex((line) => {
      const normalized = line.map(normalizeText);
      const hasDescription = normalized.some((cell) => /designation|description|libelle|travaux|ouvrage/.test(cell));
      const hasUnit = normalized.some((cell) => cell === "u" || cell === "un" || cell.includes("unite"));
      const hasQuantity = normalized.some((cell) => cell.includes("quantite") || /^qt/.test(cell));
      return hasDescription && (hasUnit || hasQuantity);
    });
  }

  function looksLikeCode(value) {
    const text = String(value ?? "").trim();
    if (!text || text.length > 14) return false;
    return /^[A-Za-z]{0,3}\d{1,3}(?:[.\-/]\d{1,3})*(?:[.\-][A-Za-z])?$/.test(text);
  }

  function isTotalRow(text) {
    return /\b(sous[-\s]?total|total|report|recapitulatif)\b/.test(normalizeText(text));
  }

  /*
   * Transforme une grille (tableau de tableaux) en lignes exploitables.
   * Conserve la position d'origine (feuille, ligne, colonnes) pour pouvoir
   * ecrire les prix dans le classeur recu sans le reconstruire.
   */
  function rowsFromGrid(grid, sheetName) {
    const headerIndex = findHeaderRowIndex(grid);
    if (headerIndex === -1) return { rows: [], headers: [], skipped: 0, headerIndex: -1 };

    const headers = grid[headerIndex].map((cell, index) => {
      const label = String(cell ?? "").trim();
      return label || `Colonne ${index + 1}`;
    });
    const columns = Object.fromEntries(headers.map((header, index) => [header, index]));
    const posteHeader = findHeader(headers, HEADER_CANDIDATES.poste);
    const descriptionHeader = findHeader(headers, HEADER_CANDIDATES.description);
    const uniteHeader = findHeader(headers, HEADER_CANDIDATES.unite);
    const quantiteHeader = findHeader(headers, HEADER_CANDIDATES.quantite);

    const rows = [];
    let skipped = 0;
    let currentLot = "";

    grid.slice(headerIndex + 1).forEach((line, offset) => {
      const cell = (header) => String(line[columns[header]] ?? "").trim();
      const poste = posteHeader ? cell(posteHeader) : "";
      const description = descriptionHeader ? cell(descriptionHeader) : "";
      const unite = uniteHeader ? cell(uniteHeader) : "";
      const quantite = quantiteHeader ? cell(quantiteHeader) : "";
      const joined = line.map((value) => String(value ?? "").trim()).filter(Boolean).join(" ");
      if (!joined) return;

      // Ligne de titre de lot : du texte, pas de quantite ni d'unite.
      if (!looksLikeCode(poste) && !unite && !quantite) {
        if (isTotalRow(joined)) return;
        if (/lot|chapitre|section|partie/i.test(joined) || joined === joined.toUpperCase()) {
          currentLot = joined;
        }
        return;
      }
      // Un vrai sous-total n'a ni unite ni quantite. « Démontage total de la
      // chaudière » (pce, 1) ou « Report des eaux de toiture » (m, 12) sont des
      // postes, pas des totaux : on ne les elimine plus, et ce qu'on elimine est compte.
      if (isTotalRow(description) && !unite && !Number.isFinite(parseNumber(quantite))) {
        skipped += 1;
        return;
      }
      if (!description) {
        skipped += 1;
        return;
      }
      /*
       * Un poste chiffrable porte toujours une unite ou une quantite. Sans l'un
       * des deux, la ligne appartient a un tableau recapitulatif (souvent place
       * en bas de feuille, avec le seul numero de lot) et la chiffrer reviendrait
       * a compter les travaux deux fois.
       */
      if (!unite && !Number.isFinite(parseNumber(quantite))) {
        skipped += 1;
        return;
      }
      if (!looksLikeCode(poste) && !unite) {
        skipped += 1;
        return;
      }

      rows.push({
        ...Object.fromEntries(headers.map((header, index) => [header, line[index] ?? ""])),
        __sheet: sheetName || "",
        __row: headerIndex + 1 + offset,
        __cols: columns,
        __lot: currentLot || sheetName || "",
      });
    });

    return { rows, headers, skipped, headerIndex };
  }

  /*
   * Valeur d'une colonne pour une ligne, en tolerant que cette ligne vienne d'une
   * feuille dont les en-tetes different de celle retenue dans le mapping global
   * (Lot 1 en « Description », Lot 2 en « Désignation ») : si l'en-tete mappe n'existe
   * pas dans cette ligne, on cherche l'equivalent parmi ses propres colonnes. Sans
   * cela, la moitie des colonnes d'un classeur multi-feuilles se vidait.
   */
  function rowField(raw, header, candidates) {
    // Pas d'en-tete choisi (« — ») : choix explicite de l'utilisateur, on le respecte.
    if (!header) return undefined;
    if (Object.prototype.hasOwnProperty.call(raw, header)) return raw[header];
    const fallback = findHeader(Object.keys(raw.__cols || {}), candidates);
    return fallback ? raw[fallback] : undefined;
  }

  /*
   * Analyse caractere par caractere plutot qu'un simple split(separateur) : un champ
   * entre guillemets peut contenir le separateur, des guillemets doubles ("") ou un
   * retour a la ligne, comme dans 01.01;"Enduit, préparation comprise";m2;160.
   */
  function parseDelimited(text) {
    const firstLine = text.split(/\r?\n/)[0] || "";
    const separator = [";", "\t", ","]
      .map((candidate) => ({ candidate, count: firstLine.split(candidate).length }))
      .sort((a, b) => b.count - a.count)[0].candidate;

    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;

    const endCell = () => {
      row.push(cell.trim());
      cell = "";
    };
    const endRow = () => {
      endCell();
      rows.push(row);
      row = [];
    };

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (inQuotes) {
        if (char === '"' && text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          cell += char;
        }
        continue;
      }
      if (char === '"' && cell === "") {
        inQuotes = true;
      } else if (char === separator) {
        endCell();
      } else if (char === "\r") {
        // ignore : les retours CRLF sont geres via le \n qui suit.
      } else if (char === "\n") {
        endRow();
      } else {
        cell += char;
      }
    }
    if (cell !== "" || row.length) endRow();

    return rows.filter((line) => line.some((cellValue) => cellValue !== ""));
  }

  root.DGCore = {
    STOP_WORDS,
    HEADER_CANDIDATES,
    MATCH_THRESHOLD,
    normalizeText,
    isPourMemoire,
    tokenize,
    stripLeadingCode,
    escapeHtml,
    normalizeUnit,
    unitsCompatible,
    evaluateArithmetic,
    parseNumber,
    roundMoney,
    coefficientPercent,
    coefficientK,
    coefficientKMultiplicatif,
    composantsOf,
    materialResolver,
    composantsDetail,
    calculateOuvrage,
    heuresReleve,
    rendementReleve,
    prixAchat,
    roundHeures,
    ecartRelatif,
    observerRendements,
    observerPrixMateriaux,
    bilanChantier,
    joursDepuisPrix,
    prixPerime,
    materiauxPerimes,
    isInternalCode,
    classifyFamily,
    internalCodePrefix,
    nextInternalCode,
    normalizeRef,
    normalizeRefList,
    normalizeKeywords,
    getLotCode,
    matchScore,
    findMatch,
    findDuplicates,
    ouvrageProximity,
    ouvrageProximityDetail,
    bestOuvrageMatch,
    findHeader,
    findHeaderRowIndex,
    looksLikeCode,
    rowsFromGrid,
    rowField,
    isForfaitUnit,
    parseDelimited,
  };
})(globalThis);
