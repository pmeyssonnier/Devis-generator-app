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

  // Un forfait accepte n'importe quelle unite : le prix est global.
  function unitsCompatible(a, b) {
    const left = normalizeUnit(a);
    const right = normalizeUnit(b);
    if (!left || !right) return true;
    if (left === right) return true;
    return left === "ff" || right === "ff";
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

  function coefficientK(settings) {
    return 1 + coefficientPercent(settings) / 100;
  }

  // Decomposition complete d'un prix de vente unitaire — sert aussi a le justifier.
  function calculateOuvrage(ouvrage, settings, materiau) {
    const heures = Number(ouvrage?.heures) || 0;
    const coutHoraire = Number(settings?.coutHoraire) || 0;
    const mainOeuvre = heures * coutHoraire;
    const matieres = (Number(ouvrage?.quantiteMateriau) || 0) * (Number(materiau?.prix) || 0);
    const materiel = Number(ouvrage?.materiel) || 0;
    const direct = mainOeuvre + matieres + materiel;
    const k = coefficientK(settings);
    return {
      heures,
      coutHoraire,
      mainOeuvre,
      matieres,
      materiel,
      direct,
      coefficientK: k,
      fraisMarge: direct * (k - 1),
      vente: direct * k,
    };
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
   * 1. code deja connu (refsMetre) -> certitude
   * 2. sinon meilleur score parmi les ouvrages d'unite compatible
   * 3. si le meilleur score global a une unite incompatible, on le signale sans le retenir
   */
  function findMatch(row, ouvrages, cache) {
    const codes = [row.poste, row.numero]
      .map(normalizeRef)
      .filter(Boolean);

    if (codes.length) {
      const byCode = ouvrages.find((ouvrage) =>
        (ouvrage.refsMetre || []).some((ref) => codes.includes(normalizeRef(ref))),
      );
      if (byCode) {
        return {
          ouvrageId: byCode.id,
          confidence: 1,
          reason: "code connu",
          unitWarning: !unitsCompatible(byCode.unite, row.unite),
          suggestionId: "",
        };
      }
    }

    let best = null;
    let bestIncompatible = null;
    ouvrages.forEach((ouvrage) => {
      const score = matchScore(row.description, ouvrage, cache);
      if (score <= 0) return;
      if (unitsCompatible(ouvrage.unite, row.unite)) {
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
      if (isTotalRow(description)) return;
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

  function parseDelimited(text) {
    const firstLine = text.split(/\r?\n/)[0] || "";
    const separator = [";", "\t", ","]
      .map((candidate) => ({ candidate, count: firstLine.split(candidate).length }))
      .sort((a, b) => b.count - a.count)[0].candidate;
    return text
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => line.split(separator).map((cell) => cell.trim().replace(/^"|"$/g, "")));
  }

  root.DGCore = {
    STOP_WORDS,
    HEADER_CANDIDATES,
    MATCH_THRESHOLD,
    normalizeText,
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
    calculateOuvrage,
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
    findHeader,
    findHeaderRowIndex,
    looksLikeCode,
    rowsFromGrid,
    parseDelimited,
  };
})(globalThis);
