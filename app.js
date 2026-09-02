/*
 * app.js — etat, rendu et evenements.
 * Depend de catalog.js (donnees de depart) et core.js (logique pure).
 */
(function () {
  "use strict";

  const C = globalThis.DGCore;
  const CATALOG = globalThis.DGCatalog;
  const STORAGE_KEY = "generateur-devis-v2";
  const CATALOG_VERSION = 1;
  // Tenir a jour avec le champ "version" de package.json — aucun outil de build
  // ne relie les deux, donc c'est manuel.
  const APP_VERSION = "2.1.0";
  // Cle separee de STORAGE_KEY : une preference d'affichage par appareil, pas une
  // donnee de chiffrage — "Tout reinitialiser" n'y touche pas.
  const THEME_KEY = "generateur-devis-theme";

  const euro = new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" });
  const number = new Intl.NumberFormat("fr-BE", { maximumFractionDigits: 2 });
  const percent = new Intl.NumberFormat("fr-BE", { maximumFractionDigits: 0, style: "percent" });
  // Un rendement se lit a la quatrieme decimale : 0,08 h/m2 n'est pas 0,1 h/m2.
  const rendementNf = new Intl.NumberFormat("fr-BE", { maximumFractionDigits: 4 });

  const VIEW_LABELS = {
    dashboard: "Tableau de bord",
    ouvrages: "Ouvrages",
    materiaux: "Matériaux",
    devis: "Devis client",
    metre: "Métré public",
    chantiers: "Chantiers",
    settings: "Paramètres",
  };

  // Classeur d'origine du dernier metre importe : garde en memoire uniquement,
  // il permet de rendre au pouvoir adjudicateur son propre fichier complete.
  let sourceWorkbook = null;
  // Octets d'origine intacts : chaque export en repart, pour ne jamais publier un
  // prix ecrit lors d'un export precedent et jamais retire depuis (cf. exportMetreSource).
  let sourceArrayBuffer = null;
  let sourceFileName = "";

  let editingMateriauId = "";
  let editingOuvrageId = "";
  let editingDevisMeta = false;
  let editingDevisLineId = "";
  let editingChantierId = "";
  let selectedChantierId = "";
  let storageWarningShown = false;

  const $ = (selector) => document.querySelector(selector);
  const esc = C.escapeHtml;

  function uid() {
    return globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  // Date du jour LOCALE, au format YYYY-MM-DD. new Date().toISOString() donne la
  // date UTC : entre minuit et 2h du matin en Belgique l'ete, ça reste la veille.
  function todayLocalISO() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  /* ------------------------------------------------------------------- etat */

  function emptyMetre() {
    return { fileName: "", rows: [], analysed: [], alerts: [], skipped: 0, mapping: {} };
  }

  function blankState() {
    return {
      version: 2,
      catalogVersion: 0,
      settings: { ...CATALOG.defaultSettings },
      entrepreneur: { ...CATALOG.defaultEntrepreneur },
      materiaux: [],
      ouvrages: [],
      devis: { ...CATALOG.defaultDevis, lignes: [] },
      chantiers: [],
      metre: emptyMetre(),
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
      // Reprise des donnees de la version precedente si elles existent.
      const legacy = localStorage.getItem("generateur-devis-v1");
      if (legacy) return JSON.parse(legacy);
    } catch {
      /* donnees illisibles : on repart du catalogue */
    }
    return blankState();
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch {
      // Le metre brut est ce qui pese le plus : on le sacrifie avant tout le reste.
      try {
        const rows = state.metre.rows;
        state.metre.rows = [];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        state.metre.rows = rows;
        if (!storageWarningShown) {
          storageWarningShown = true;
          notify("Stockage du navigateur sature : le métré brut n’est pas conservé après fermeture.", "danger");
        }
        return true;
      } catch {
        if (!storageWarningShown) {
          storageWarningShown = true;
          notify("Impossible d’enregistrer dans ce navigateur. Exportez vos données en JSON.", "danger");
        }
        return false;
      }
    }
  }

  // Remet l'etat dans une forme coherente, quelle que soit son origine.
  function normalizeState(source) {
    const next = { ...blankState(), ...source };
    next.settings = { ...CATALOG.defaultSettings, ...(source.settings || {}) };
    next.entrepreneur = { ...CATALOG.defaultEntrepreneur, ...(source.entrepreneur || {}) };
    next.materiaux = (source.materiaux || []).map((materiau) => ({
      id: materiau.id || uid(),
      nom: materiau.nom || "",
      unite: materiau.unite || "",
      fournisseur: materiau.fournisseur || "",
      reference: materiau.reference || "",
      conditionnement: materiau.conditionnement || "",
      prix: Number(materiau.prix) || 0,
      datePrix: materiau.datePrix || "",
    }));

    const usedCodes = new Set();
    next.ouvrages = (source.ouvrages || []).map((ouvrage) => {
      const previousCode = String(ouvrage.poste || "").trim();
      const nom = C.stripLeadingCode(ouvrage.nom);
      const refs = C.normalizeRefList([ouvrage.refsMetre || ouvrage.referencesMetre || [], previousCode]);
      const code = C.isInternalCode(previousCode) && !usedCodes.has(previousCode)
        ? previousCode
        : C.nextInternalCode(usedCodes, nom);
      usedCodes.add(code);
      return {
        id: ouvrage.id || uid(),
        poste: code,
        refsMetre: refs,
        nom,
        unite: ouvrage.unite || "",
        heures: Number(ouvrage.heures) || 0,
        // composantsOf relit aussi l'ancien couple materiauId / quantiteMateriau :
        // les bibliotheques deja enregistrees sont migrees a la lecture.
        composants: C.composantsOf(ouvrage),
        materiel: Number(ouvrage.materiel) || 0,
        motsCles: C.normalizeKeywords([ouvrage.motsCles, refs.join(", ")]),
      };
    });

    const devis = source.devis || {};
    next.devis = {
      client: devis.client || "",
      adresse: devis.adresse || "",
      objet: devis.objet || "",
      tva: Number(devis.tva ?? next.settings.tva) || 21,
      lignes: (devis.lignes || []).map((ligne) => ({
        id: ligne.id || uid(),
        ouvrageId: ligne.ouvrageId || "",
        quantite: Number(ligne.quantite) || 0,
      })),
    };

    // Releves de chantier : ce qui a reellement ete preste et achete.
    next.chantiers = (source.chantiers || []).map((chantier) => ({
      id: chantier.id || uid(),
      nom: chantier.nom || "",
      reference: chantier.reference || "",
      date: chantier.date || "",
      mainOeuvre: (chantier.mainOeuvre || []).map((releve) => ({
        id: releve.id || uid(),
        ouvrageId: releve.ouvrageId || "",
        quantite: Number(releve.quantite) || 0,
        personnes: Number(releve.personnes) || 1,
        duree: Number(releve.duree) || 0,
      })),
      achats: (chantier.achats || []).map((achat) => ({
        id: achat.id || uid(),
        materiauId: achat.materiauId || "",
        quantite: Number(achat.quantite) || 0,
        montant: Number(achat.montant) || 0,
      })),
    }));

    next.metre = { ...emptyMetre(), ...(source.metre || {}) };
    next.metre.analysed = (next.metre.analysed || []).map((row) => ({ ...row, poste: row.poste || row.numero }));
    if (![6, 21].includes(Number(next.settings.tva))) next.settings.tva = 21;
    return next;
  }

  /*
   * Installe le catalogue de demarrage une seule fois (catalogVersion).
   * Sans ce garde-fou, tout ouvrage supprime reapparaissait au rechargement.
   */
  function seedCatalog(force) {
    if (!force && state.catalogVersion >= CATALOG_VERSION) return 0;

    const materialIdByName = new Map(state.materiaux.map((m) => [C.normalizeText(m.nom), m.id]));
    CATALOG.materiaux.forEach((source) => {
      const key = C.normalizeText(source.nom);
      if (materialIdByName.has(key)) return;
      const id = uid();
      state.materiaux.push({ id, ...source });
      materialIdByName.set(key, id);
    });

    const usedCodes = new Set(state.ouvrages.map((ouvrage) => ouvrage.poste));
    let added = 0;
    CATALOG.ouvrages.forEach((source) => {
      const refs = C.normalizeRefList([source.ref, CATALOG.referencesConnues[source.ref] || []]);
      const key = C.normalizeText(source.nom);
      const existing = state.ouvrages.find(
        (ouvrage) =>
          C.normalizeText(ouvrage.nom) === key ||
          (ouvrage.refsMetre || []).some((ref) => C.normalizeRef(ref) === C.normalizeRef(source.ref)),
      );
      if (existing) {
        existing.refsMetre = C.normalizeRefList([existing.refsMetre, refs]);
        existing.motsCles = C.normalizeKeywords([existing.motsCles, source.motsCles, refs.join(", ")]);
        return;
      }
      const code = C.nextInternalCode(usedCodes, source.nom);
      usedCodes.add(code);
      state.ouvrages.push({
        id: uid(),
        poste: code,
        refsMetre: refs,
        nom: source.nom,
        unite: source.unite,
        heures: source.heures,
        composants: source.composants
          .map((composant) => ({
            materiauId: materialIdByName.get(C.normalizeText(composant.materiau)) || "",
            quantite: composant.quantite,
          }))
          .filter((composant) => composant.materiauId),
        materiel: source.materiel,
        motsCles: C.normalizeKeywords([source.motsCles, source.nom, refs.join(", ")]),
      });
      added += 1;
    });

    state.catalogVersion = CATALOG_VERSION;
    return added;
  }

  let state = normalizeState(loadState());
  seedCatalog(false);

  const materialById = (id) => state.materiaux.find((materiau) => materiau.id === id);
  const ouvrageById = (id) => state.ouvrages.find((ouvrage) => ouvrage.id === id);
  const chantierById = (id) => state.chantiers.find((chantier) => chantier.id === id);
  const chantiersTries = () => [...state.chantiers].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  // A defaut de selection, le chantier le plus recent : c'est celui qu'on releve.
  const chantierCourant = () => chantierById(selectedChantierId) || chantiersTries()[0] || null;
  const priceOf = (ouvrage) => C.calculateOuvrage(ouvrage, state.settings, materialById);

  /* ---------------------------------------------------------------- notifications */

  let notifyTimer = 0;
  function notify(message, kind) {
    const zone = $("#toast");
    if (!zone) return;
    zone.textContent = message;
    zone.className = `toast visible ${kind || "info"}`;
    clearTimeout(notifyTimer);
    notifyTimer = setTimeout(() => zone.classList.remove("visible"), 6000);
  }

  /* --------------------------------------------------------------------- rendu */

  function render() {
    renderKpis();
    renderMaterialOptions();
    renderOuvrageOptions();
    renderDashboard();
    renderMateriaux();
    renderOuvrages();
    renderSettings();
    renderDevis();
    renderMetre();
    renderChantiers();
  }

  function formatPercent(value) {
    return `${number.format(Number(value) || 0)} %`;
  }

  function renderKpis() {
    const totals = calculateDevisTotals();
    $("#kpi-ouvrages").textContent = state.ouvrages.length;
    $("#kpi-materiaux").textContent = state.materiaux.length;
    $("#kpi-k").textContent = C.coefficientK(state.settings).toFixed(3).replace(".", ",");
    $("#kpi-devis").textContent = euro.format(totals.ht);
    $("#kpi-alertes").textContent = state.metre.analysed.filter((row) => !row.ouvrageId || row.unitWarning).length;
    $("#kpi-recalage").textContent = recalagesRendement().filter(aRecaler).length + recalagesPrix().filter(aRecaler).length;
    $("#kpi-peremption").textContent = materiauxPerimes().length;
  }

  // Prix matieres dates au-dela du seuil regle dans les parametres. seuil <= 0 : desactive.
  function materiauxPerimes() {
    return C.materiauxPerimes(state.materiaux, new Date(), state.settings.peremptionJours);
  }

  function renderDashboard() {
    const rows = state.ouvrages
      .map((ouvrage) => ({ ouvrage, calc: priceOf(ouvrage) }))
      .sort((a, b) => b.calc.vente - a.calc.vente)
      .slice(0, 25);
    $("#dashboard-ouvrages").innerHTML = rows.length
      ? rows
          .map(
            ({ ouvrage, calc }) => `<tr>
              <td><strong>${esc(ouvrage.nom)}</strong><small>${esc(ouvrage.poste)}</small></td>
              <td>${esc(ouvrage.unite)}</td>
              <td>${euro.format(calc.vente)}</td>
              <td>${euro.format(calc.mainOeuvre)}</td>
              <td>${euro.format(calc.matieres)}</td>
            </tr>`,
          )
          .join("")
      : `<tr><td colspan="5" class="empty">La bibliothèque est vide.</td></tr>`;

    const alerts = state.metre.alerts;
    $("#alerts-list").innerHTML = alerts.length
      ? alerts
          .slice(0, 60)
          .map((alert) => `<div class="alert ${alert.type === "danger" ? "danger" : ""}">${esc(alert.message)}</div>`)
          .join("")
      : `<p class="empty">Aucun problème détecté pour le moment.</p>`;

    renderPeremption();
  }

  function renderPeremption() {
    const perimes = materiauxPerimes();
    $("#peremption-list").innerHTML = perimes.length
      ? perimes
          .map(
            ({ materiau, jours }) => `<div class="duplicate-item">
              <strong>${esc(materiau.nom)}</strong>
              <span>${euro.format(materiau.prix)} / ${esc(materiau.unite)} · prix du ${esc(materiau.datePrix)}, il y a ${number.format(jours)} jours</span>
              <div class="card-actions">
                <button class="edit-button" data-confirm-prix-materiau="${materiau.id}" type="button">Prix toujours valable</button>
                <button class="edit-button" data-edit-materiau="${materiau.id}" type="button">Éditer</button>
              </div>
            </div>`,
          )
          .join("")
      : `<p class="empty">${
          Number(state.settings.peremptionJours) > 0
            ? "Aucun prix à vérifier."
            : "Alerte désactivée (seuil à 0 dans les paramètres)."
        }</p>`;
  }

  // Le prix n'a pas change, seule sa date de controle est reconduite a aujourd'hui.
  function confirmerPrixMateriau(id) {
    const materiau = materialById(id);
    if (!materiau) return;
    materiau.datePrix = todayLocalISO();
    saveState();
    render();
    notify("Prix confirmé à jour.", "info");
  }

  function matchesSearch(query, values) {
    const cleaned = C.normalizeText(query);
    if (!cleaned) return true;
    const haystack = values.map(C.normalizeText).join(" ");
    return cleaned.split(/\s+/).filter(Boolean).every((term) => {
      // "03.xx" : tous les postes du lot 03.
      if (/^\d{1,2}\.x{1,2}$/.test(term)) {
        const prefix = `${term.split(".")[0]}.`;
        return values.some((value) =>
          String(value ?? "")
            .split(/[,;\s]+/)
            .some((part) => C.normalizeRef(part).startsWith(prefix)),
        );
      }
      return haystack.includes(term);
    });
  }

  function renderMateriaux() {
    const query = $("#materiau-search")?.value || "";
    const materiaux = state.materiaux.filter((materiau) =>
      matchesSearch(query, [materiau.nom, materiau.unite, materiau.fournisseur, materiau.reference, materiau.conditionnement]),
    );
    $("#materiaux-count").textContent = `${materiaux.length} / ${state.materiaux.length}`;
    $("#materiaux-list").innerHTML = materiaux.length
      ? materiaux
          .map((materiau) => {
            const { perime, jours } = C.prixPerime(materiau, new Date(), state.settings.peremptionJours);
            return `<article class="record-card ${perime ? "stale" : ""}">
              <header>
                <div>
                  <strong>${esc(materiau.nom)}</strong>
                  <small>${esc(materiau.fournisseur || "Fournisseur non renseigné")}</small>
                </div>
                <span class="badge">${euro.format(materiau.prix)} / ${esc(materiau.unite)}</span>
              </header>
              <p>${esc(materiau.conditionnement || "Conditionnement non renseigné")} · ${esc(materiau.reference || "sans référence")}${
                materiau.datePrix ? ` · prix du ${esc(materiau.datePrix)}` : " · <em>prix non daté</em>"
              }</p>
              ${perime ? `<p class="warning-text">Prix à vérifier — daté d’il y a ${number.format(jours)} jours.</p>` : ""}
              <div class="card-actions">
                ${perime ? `<button class="edit-button" data-confirm-prix-materiau="${materiau.id}" type="button">Prix toujours valable</button>` : ""}
                <button class="edit-button" data-edit-materiau="${materiau.id}" type="button">Éditer</button>
                <button class="delete-button" data-delete-materiau="${materiau.id}" type="button">Supprimer</button>
              </div>
            </article>`;
          })
          .join("")
      : `<p class="empty">Aucun matériau ne correspond à la recherche.</p>`;
  }

  function composantLabel(composant) {
    if (composant.introuvable) {
      return `Matériau retiré de la bibliothèque (${number.format(composant.quantite)} par unité)`;
    }
    return `${composant.nom} (${number.format(composant.quantite)} ${composant.unite} × ${euro.format(composant.prix)})`;
  }

  // Resume court d'un ouvrage : « Isolant + Enduit + Accessoires ».
  function composantsResume(calc) {
    if (!calc.composants.length) return "aucun matériau";
    return calc.composants.map((composant) => composant.nom || "matériau retiré").join(" + ");
  }

  // Decomposition du prix : permet de controler et de justifier un montant.
  // Chaque fourniture apparait sur sa propre ligne, avec sa quantite et son prix.
  function breakdownHtml(ouvrage, calc) {
    const lines = [
      { label: `Main-d’œuvre (${number.format(calc.heures)} h × ${euro.format(calc.coutHoraire)})`, value: calc.mainOeuvre },
    ];
    if (calc.composants.length) {
      calc.composants.forEach((composant) => {
        lines.push({ label: composantLabel(composant), value: composant.montant });
      });
      if (calc.composants.length > 1) {
        lines.push({ label: "Total matériaux", value: calc.matieres, cls: "subtotal" });
      }
    } else {
      lines.push({ label: "Matériaux — aucun", value: 0 });
    }
    lines.push({ label: "Matériel et accessoires", value: calc.materiel });
    return `<details class="breakdown">
      <summary>Justifier ce prix</summary>
      <table>
        <tbody>
          ${lines
            .map(
              ({ label, value, cls }) =>
                `<tr${cls ? ` class="${cls}"` : ""}><td>${esc(label)}</td><td>${euro.format(value)}</td></tr>`,
            )
            .join("")}
          <tr class="subtotal"><td>Coût direct</td><td>${euro.format(calc.direct)}</td></tr>
          <tr><td>Frais et marge (K = ${calc.coefficientK.toFixed(3).replace(".", ",")})</td><td>${euro.format(calc.fraisMarge)}</td></tr>
          <tr class="total"><td>Prix de vente / ${esc(ouvrage.unite)}</td><td>${euro.format(calc.vente)}</td></tr>
        </tbody>
      </table>
      ${ouvrage.refsMetre.length ? `<p class="refs">Codes de métré reconnus : ${esc(ouvrage.refsMetre.join(", "))}</p>` : ""}
    </details>`;
  }

  function renderOuvrages() {
    const query = $("#ouvrage-search")?.value || "";
    const ouvrages = state.ouvrages.filter((ouvrage) =>
      matchesSearch(query, [
        ouvrage.poste,
        ouvrage.refsMetre.join(" "),
        ouvrage.nom,
        ouvrage.unite,
        ouvrage.motsCles,
        ouvrage.composants.map((composant) => materialById(composant.materiauId)?.nom || "").join(" "),
      ]),
    );
    $("#ouvrages-count").textContent = `${ouvrages.length} / ${state.ouvrages.length}`;
    renderOuvrageDuplicates();
    $("#ouvrages-list").innerHTML = ouvrages.length
      ? ouvrages
          .map((ouvrage) => {
            const calc = priceOf(ouvrage);
            return `<article class="record-card">
              <header>
                <div>
                  <strong>${esc(ouvrage.nom)}</strong>
                  <small>${esc(ouvrage.poste)}${ouvrage.refsMetre.length ? ` · métré ${esc(ouvrage.refsMetre.join(", "))}` : ""}</small>
                </div>
                <span class="badge">${euro.format(calc.vente)} / ${esc(ouvrage.unite)}</span>
              </header>
              <p>${number.format(ouvrage.heures)} h/${esc(ouvrage.unite)} · ${esc(composantsResume(calc))} · coût direct ${euro.format(
                calc.direct,
              )}</p>
              ${breakdownHtml(ouvrage, calc)}
              <div class="card-actions">
                <button class="edit-button" data-edit-ouvrage="${ouvrage.id}" type="button">Éditer</button>
                <button class="delete-button" data-delete-ouvrage="${ouvrage.id}" type="button">Supprimer</button>
              </div>
            </article>`;
          })
          .join("")
      : `<p class="empty">Aucun ouvrage ne correspond à la recherche.</p>`;
  }

  function renderOuvrageDuplicates() {
    const container = $("#ouvrage-duplicates");
    if (!container) return;
    const duplicates = C.findDuplicates(state.ouvrages, (ouvrage) => priceOf(ouvrage).vente);
    container.innerHTML = duplicates.length
      ? duplicates
          .slice(0, 12)
          .map(
            (group) => `<div class="duplicate-item">
              <strong>${esc(group.items.map((item) => `${item.poste} — ${item.nom}`).join("  ↔  "))}</strong>
              <span>unité ${esc(group.unite)} · similarité ${percent.format(group.score)} · écart de prix ${percent.format(group.priceGap)}</span>
              <div class="card-actions">
                <button class="edit-button" data-merge-from="${group.items[0].id}" data-merge-to="${group.items[1].id}" type="button">Fusionner A → B</button>
                <button class="edit-button" data-merge-from="${group.items[1].id}" data-merge-to="${group.items[0].id}" type="button">Fusionner B → A</button>
              </div>
            </div>`,
          )
          .join("")
      : `<p class="empty">Aucun doublon probable détecté.</p>`;
  }

  let materialOptionsHtml = "";
  function renderMaterialOptions() {
    materialOptionsHtml = [`<option value="">Choisir un matériau…</option>`]
      .concat(
        [...state.materiaux]
          .sort((a, b) => a.nom.localeCompare(b.nom, "fr"))
          .map((m) => `<option value="${m.id}">${esc(m.nom)} (${esc(m.unite)})</option>`),
      )
      .join("");
    document
      .querySelectorAll('#ouvrage-composants select[name="composantMateriau"], #achat-form select[name="materiau"]')
      .forEach((select) => {
        const current = select.value;
        select.innerHTML = materialOptionsHtml;
        select.value = current;
      });
    updateComposantsTotal();
  }

  /* ------------------------------------------- composants du formulaire ouvrage */

  function composantRowHtml() {
    return `<div class="composant-row">
      <select name="composantMateriau" aria-label="Matériau"></select>
      <input name="composantQuantite" type="number" min="0" step="0.001" placeholder="Qté / unité" aria-label="Quantité par unité d’ouvrage" />
      <button class="ghost danger" type="button" data-remove-composant aria-label="Retirer ce matériau">✕</button>
    </div>`;
  }

  // Une ligne vide reste affichee quand l'ouvrage n'a aucun materiau : le
  // formulaire est utilisable sans avoir a cliquer d'abord sur « Ajouter ».
  function setComposantRows(composants) {
    const container = $("#ouvrage-composants");
    if (!container) return;
    const list = composants.length ? composants : [{ materiauId: "", quantite: "" }];
    container.innerHTML = list.map(() => composantRowHtml()).join("");
    [...container.querySelectorAll(".composant-row")].forEach((row, index) => {
      const select = row.querySelector("select");
      select.innerHTML = materialOptionsHtml;
      select.value = list[index].materiauId || "";
      row.querySelector("input").value = list[index].quantite === "" ? "" : list[index].quantite;
    });
    updateComposantsTotal();
  }

  function addComposantRow() {
    const container = $("#ouvrage-composants");
    if (!container) return;
    container.insertAdjacentHTML("beforeend", composantRowHtml());
    const row = container.lastElementChild;
    row.querySelector("select").innerHTML = materialOptionsHtml;
    row.querySelector("select").focus();
  }

  function readComposantRows() {
    const container = $("#ouvrage-composants");
    if (!container) return [];
    return [...container.querySelectorAll(".composant-row")]
      .map((row) => ({
        materiauId: row.querySelector("select").value,
        quantite: Number(row.querySelector("input").value) || 0,
      }))
      .filter((composant) => composant.materiauId);
  }

  // Sous-total de la saisie : permet de controler le cout matiere sans quitter le formulaire.
  function updateComposantsTotal() {
    const cible = $("#ouvrage-composants-total");
    if (!cible) return;
    const total = readComposantRows().reduce(
      (sum, composant) => sum + composant.quantite * (Number(materialById(composant.materiauId)?.prix) || 0),
      0,
    );
    cible.textContent = `${euro.format(total)} de matériaux par unité`;
  }

  let ouvrageOptionsHtml = "";
  function renderOuvrageOptions() {
    ouvrageOptionsHtml = [...state.ouvrages]
      .sort((a, b) => a.nom.localeCompare(b.nom, "fr"))
      .map((o) => `<option value="${o.id}">${esc(o.nom)} (${esc(o.unite)})</option>`)
      .join("");
    document.querySelectorAll('select[name="ouvrage"]').forEach((select) => {
      const current = select.value;
      select.innerHTML = ouvrageOptionsHtml;
      select.value = current;
    });
  }

  function renderSettings() {
    const form = $("#settings-form");
    ["coutHoraire", "fraisGeneraux", "fraisChantier", "imprevus", "marge", "peremptionJours"].forEach((key) => {
      if (form.elements[key]) form.elements[key].value = state.settings[key];
    });
    form.elements.tva.value = String(state.settings.tva);
    Object.entries(state.entrepreneur).forEach(([key, value]) => {
      const field = form.elements[`entrepreneur-${key}`];
      if (field) field.value = value ?? "";
    });
    renderSettingsComputedValues();
  }

  function renderSettingsComputedValues() {
    ["fraisGeneraux", "fraisChantier", "imprevus", "marge"].forEach((key) => {
      const element = $(`#value-${key}`);
      if (element) element.textContent = formatPercent(state.settings[key]);
    });
    $("#settings-k").textContent = C.coefficientK(state.settings).toFixed(3).replace(".", ",");
    $("#settings-k-formula").textContent = `K = 1 + ${number.format(C.coefficientPercent(state.settings))} / 100`;
  }

  function readSettingsForm(form) {
    const data = Object.fromEntries(new FormData(form));
    state.settings = {
      coutHoraire: Number(data.coutHoraire) || 0,
      fraisGeneraux: Number(data.fraisGeneraux) || 0,
      fraisChantier: Number(data.fraisChantier) || 0,
      imprevus: Number(data.imprevus) || 0,
      marge: Number(data.marge) || 0,
      tva: Number(data.tva) || state.settings.tva || 21,
      peremptionJours: Math.max(0, Number(data.peremptionJours) || 0),
    };
    state.entrepreneur = {
      nom: data["entrepreneur-nom"] ?? "",
      adresse: data["entrepreneur-adresse"] ?? "",
      tel: data["entrepreneur-tel"] ?? "",
      email: data["entrepreneur-email"] ?? "",
      numeroTva: data["entrepreneur-numeroTva"] ?? "",
    };
  }

  /* --------------------------------------------------------------------- devis */

  function calculateDevisTotals() {
    const ht = state.devis.lignes.reduce((sum, ligne) => {
      const ouvrage = ouvrageById(ligne.ouvrageId);
      return ouvrage ? sum + priceOf(ouvrage).vente * ligne.quantite : sum;
    }, 0);
    const tva = ht * (Number(state.devis.tva ?? state.settings.tva) / 100);
    return { ht, tva, ttc: ht + tva };
  }

  function renderDevis() {
    const meta = $("#devis-meta-form");
    meta.elements.client.value = state.devis.client;
    meta.elements.adresse.value = state.devis.adresse;
    meta.elements.objet.value = state.devis.objet;
    meta.elements.tva.value = state.devis.tva;
    updateDevisMetaMode();

    const orphan = state.devis.lignes.filter((ligne) => !ouvrageById(ligne.ouvrageId)).length;
    $("#devis-lines").innerHTML = state.devis.lignes.length
      ? state.devis.lignes
          .map((ligne) => {
            const ouvrage = ouvrageById(ligne.ouvrageId);
            if (!ouvrage) {
              return `<tr class="row-warning">
                <td colspan="4">Ligne rattachée à un ouvrage supprimé.</td>
                <td><button class="delete-button" data-delete-ligne="${ligne.id}" type="button">Retirer</button></td>
              </tr>`;
            }
            const calc = priceOf(ouvrage);
            return `<tr>
              <td>${esc(ouvrage.nom)}</td>
              <td>${number.format(ligne.quantite)} ${esc(ouvrage.unite)}</td>
              <td>${euro.format(calc.vente)}</td>
              <td>${euro.format(calc.vente * ligne.quantite)}</td>
              <td>
                <div class="card-actions">
                  <button class="edit-button" data-edit-ligne="${ligne.id}" type="button">Éditer</button>
                  <button class="delete-button" data-delete-ligne="${ligne.id}" type="button">Retirer</button>
                </div>
              </td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="5" class="empty">Aucune ligne dans ce devis.</td></tr>`;
    updateDevisLineMode();

    const totals = calculateDevisTotals();
    $("#total-ht").textContent = euro.format(totals.ht);
    $("#total-tva").textContent = euro.format(totals.tva);
    $("#total-ttc").textContent = euro.format(totals.ttc);
    $("#devis-warning").textContent = orphan ? `${orphan} ligne(s) sans ouvrage : elles ne sont pas comptées.` : "";
  }

  function updateDevisMetaMode() {
    const form = $("#devis-meta-form");
    ["client", "adresse", "objet", "tva"].forEach((field) => {
      form.elements[field].disabled = !editingDevisMeta;
    });
    $("#edit-devis-meta").classList.toggle("hidden", editingDevisMeta);
    $("#save-devis-meta").classList.toggle("hidden", !editingDevisMeta);
  }

  function updateDevisLineMode() {
    $("#devis-line-submit").textContent = editingDevisLineId ? "Sauvegarder la ligne" : "Ajouter";
    $("#devis-line-cancel-edit").classList.toggle("hidden", !editingDevisLineId);
  }

  /* ----------------------------------------------------------------- chantiers */

  /*
   * La boucle « devis -> chantier -> correction de la bibliotheque ».
   *
   * Un chantier porte deux releves : les heures reellement prestees par ouvrage et
   * les achats reellement factures. Rien n'est corrige automatiquement : l'ecart est
   * affiche, et l'entreprise decide de recaler ou non sa bibliotheque.
   */

  // En deca, l'ecart tient du bruit de chantier : on ne le signale pas comme a corriger.
  const SEUIL_RECALAGE = 0.05;

  function formatEcart(ecart) {
    if (ecart === null) return "—";
    return `${ecart > 0 ? "+" : ""}${percent.format(ecart)}`;
  }

  // Un ecart sous le seuil ne merite pas d'etre colorie.
  function classeEcart(ecart) {
    if (ecart === null || Math.abs(ecart) < SEUIL_RECALAGE) return "";
    return ecart > 0 ? "ecart-hausse" : "ecart-baisse";
  }

  function attrClasse(classe) {
    return classe ? ` class="${classe}"` : "";
  }

  function aRecaler(item) {
    return item.ecart === null || Math.abs(item.ecart) >= SEUIL_RECALAGE;
  }

  // Rendements observes sur l'ensemble des chantiers, rapportes aux ouvrages existants.
  function recalagesRendement() {
    const observations = C.observerRendements(state.chantiers);
    return state.ouvrages
      .filter((ouvrage) => observations.has(ouvrage.id))
      .map((ouvrage) => {
        const observation = observations.get(ouvrage.id);
        const rendement = C.roundHeures(observation.rendement);
        return { ouvrage, observation, rendement, ecart: C.ecartRelatif(ouvrage.heures, rendement) };
      })
      .filter((item) => item.rendement !== item.ouvrage.heures)
      .sort((a, b) => Math.abs(b.ecart ?? 1) - Math.abs(a.ecart ?? 1));
  }

  function recalagesPrix() {
    const observations = C.observerPrixMateriaux(state.chantiers);
    return state.materiaux
      .filter((materiau) => observations.has(materiau.id))
      .map((materiau) => {
        const observation = observations.get(materiau.id);
        const prix = C.roundMoney(observation.prix);
        return { materiau, observation, prix, ecart: C.ecartRelatif(materiau.prix, prix) };
      })
      .filter((item) => item.prix !== item.materiau.prix)
      .sort((a, b) => Math.abs(b.ecart ?? 1) - Math.abs(a.ecart ?? 1));
  }

  function renderChantiers() {
    renderChantiersList();
    renderChantierDetail();
    renderRecalage();
  }

  function renderChantiersList() {
    const courant = chantierCourant();
    $("#chantiers-count").textContent = `${state.chantiers.length}`;
    $("#chantiers-list").innerHTML = state.chantiers.length
      ? chantiersTries()
          .map((chantier) => {
            const heures = chantier.mainOeuvre.reduce((total, releve) => total + C.heuresReleve(releve), 0);
            const achats = chantier.achats.reduce((total, achat) => total + achat.montant, 0);
            return `<article class="record-card ${chantier.id === courant?.id ? "selected" : ""}">
              <header>
                <div>
                  <strong>${esc(chantier.nom || "Chantier sans nom")}</strong>
                  <small>${esc(chantier.reference || "sans référence")}${chantier.date ? ` · ${esc(chantier.date)}` : ""}</small>
                </div>
                <span class="badge">${number.format(heures)} h</span>
              </header>
              <p>${chantier.mainOeuvre.length} poste(s) relevé(s) · ${euro.format(achats)} d’achats</p>
              <div class="card-actions">
                <button class="edit-button" data-select-chantier="${chantier.id}" type="button">Relever</button>
                <button class="edit-button" data-edit-chantier="${chantier.id}" type="button">Éditer</button>
                <button class="delete-button" data-delete-chantier="${chantier.id}" type="button">Supprimer</button>
              </div>
            </article>`;
          })
          .join("")
      : `<p class="empty">Aucun chantier relevé.</p>`;
  }

  function renderChantierDetail() {
    const chantier = chantierCourant();
    $("#chantier-empty").classList.toggle("hidden", Boolean(chantier));
    $("#chantier-detail-body").classList.toggle("hidden", !chantier);
    if (!chantier) {
      $("#chantier-detail-title").textContent = "Relevé de chantier";
      $("#chantier-detail-sub").textContent = "";
      return;
    }

    $("#chantier-detail-title").textContent = chantier.nom || "Chantier sans nom";
    $("#chantier-detail-sub").textContent = [chantier.reference, chantier.date].filter(Boolean).join(" · ");

    const bilan = C.bilanChantier(chantier, state.ouvrages, state.materiaux, state.settings);

    $("#releve-lines").innerHTML = bilan.lignes.length
      ? bilan.lignes
          .map((ligne) => {
            const unite = ligne.ouvrage?.unite || "";
            const nom = ligne.ouvrage
              ? esc(ligne.ouvrage.nom)
              : `<em>ouvrage supprimé</em>`;
            return `<tr>
              <td>${nom}</td>
              <td><input class="cell-input" type="number" min="0" step="0.01" value="${ligne.quantite}" data-releve="${ligne.releveId}" data-champ="quantite" aria-label="Quantité réalisée" /> ${esc(unite)}</td>
              <td><input class="cell-input" type="number" min="1" step="1" value="${ligne.personnes}" data-releve="${ligne.releveId}" data-champ="personnes" aria-label="Personnes" /></td>
              <td><input class="cell-input" type="number" min="0" step="0.25" value="${ligne.duree}" data-releve="${ligne.releveId}" data-champ="duree" aria-label="Heures" /> = ${number.format(ligne.heures)} h</td>
              <td>${rendementNf.format(ligne.rendementPrevu)} → <strong>${rendementNf.format(ligne.rendementReel)}</strong> h/${esc(unite)}</td>
              <td${attrClasse(classeEcart(ligne.ecart))}>${formatEcart(ligne.ecart)}</td>
              <td><button class="delete-button" data-delete-releve="${ligne.releveId}" type="button">Retirer</button></td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="7" class="empty">Aucune heure relevée.</td></tr>`;

    $("#achat-lines").innerHTML = bilan.achats.length
      ? bilan.achats
          .map((achat) => {
            const unite = achat.materiau?.unite || "";
            const nom = achat.materiau ? esc(achat.materiau.nom) : `<em>matériau supprimé</em>`;
            return `<tr>
              <td>${nom}</td>
              <td><input class="cell-input" type="number" min="0" step="0.01" value="${achat.quantite}" data-achat="${achat.achatId}" data-champ="quantite" aria-label="Quantité facturée" /> ${esc(unite)}</td>
              <td><input class="cell-input" type="number" min="0" step="0.01" value="${achat.montant}" data-achat="${achat.achatId}" data-champ="montant" aria-label="Montant payé" /> €</td>
              <td><strong>${euro.format(achat.prix)}</strong></td>
              <td>${euro.format(achat.prixBibliotheque)}</td>
              <td${attrClasse(classeEcart(achat.ecart))}>${formatEcart(achat.ecart)}</td>
              <td><button class="delete-button" data-delete-achat="${achat.achatId}" type="button">Retirer</button></td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="7" class="empty">Aucun achat relevé.</td></tr>`;

    const orphelins = bilan.lignes.filter((ligne) => !ligne.ouvrage).length;
    $("#chantier-warning").textContent = [
      bilan.achatsManquants ? "Aucun achat relevé : la marge réelle ne tient pas compte des matières." : "",
      orphelins ? `${orphelins} relevé(s) rattaché(s) à un ouvrage supprimé : ils ne recalent plus rien.` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const ecartClasse = classeEcart(C.ecartRelatif(bilan.prevu.direct, bilan.reel.direct));
    $("#chantier-bilan").innerHTML = [
      ["Recette HTVA", euro.format(bilan.recette), ""],
      ["Heures prévues → prestées", `${number.format(bilan.prevu.heures)} → ${number.format(bilan.reel.heures)} h`, ""],
      ["Coût direct prévu", euro.format(bilan.prevu.direct), ""],
      ["Coût direct réel", euro.format(bilan.reel.direct), ecartClasse],
      ["Marge prévue", euro.format(bilan.margePrevue), ""],
      ["Marge réelle", euro.format(bilan.margeReelle), bilan.margeReelle < bilan.margePrevue ? "ecart-hausse" : ""],
    ]
      .map(([label, valeur, classe]) => `<div><span>${esc(label)}</span><strong${attrClasse(classe)}>${esc(valeur)}</strong></div>`)
      .join("");
  }

  function renderRecalage() {
    const rendements = recalagesRendement();
    const prix = recalagesPrix();
    const vide = !state.chantiers.length;
    $("#recalage-empty").classList.toggle("hidden", !vide);
    $("#recalage-body").classList.toggle("hidden", vide);
    if (vide) return;

    $("#recalage-rendements").innerHTML = rendements.length
      ? rendements
          .map(({ ouvrage, observation, rendement: observe, ecart }) => {
            const venteActuelle = priceOf(ouvrage).vente;
            const venteRecalee = C.calculateOuvrage({ ...ouvrage, heures: observe }, state.settings, materialById).vente;
            return `<tr>
              <td><strong>${esc(ouvrage.nom)}</strong><small>${esc(ouvrage.poste)}</small></td>
              <td>${rendementNf.format(ouvrage.heures)} h/${esc(ouvrage.unite)}</td>
              <td><strong>${rendementNf.format(observe)}</strong> h/${esc(ouvrage.unite)}</td>
              <td${attrClasse(classeEcart(ecart))}>${formatEcart(ecart)}</td>
              <td>${number.format(observation.quantite)} ${esc(ouvrage.unite)} · ${observation.chantiers} chantier(s)</td>
              <td>${euro.format(venteActuelle)} → ${euro.format(venteRecalee)}</td>
              <td><button class="edit-button" data-recaler-ouvrage="${ouvrage.id}" type="button">Recaler</button></td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="7" class="empty">Les rendements de la bibliothèque correspondent aux relevés.</td></tr>`;

    $("#recalage-prix").innerHTML = prix.length
      ? prix
          .map(({ materiau, observation, prix: paye, ecart }) => `<tr>
              <td><strong>${esc(materiau.nom)}</strong><small>${esc(materiau.fournisseur || "sans fournisseur")}</small></td>
              <td>${euro.format(materiau.prix)} / ${esc(materiau.unite)}</td>
              <td><strong>${euro.format(paye)}</strong> / ${esc(materiau.unite)}</td>
              <td${attrClasse(classeEcart(ecart))}>${formatEcart(ecart)}</td>
              <td>${number.format(observation.quantite)} ${esc(materiau.unite)} · ${observation.chantiers} chantier(s)</td>
              <td><button class="edit-button" data-recaler-materiau="${materiau.id}" type="button">Recaler</button></td>
            </tr>`)
          .join("")
      : `<tr><td colspan="6" class="empty">Les prix de la bibliothèque correspondent aux factures.</td></tr>`;

    $("#recaler-tous-rendements").disabled = !rendements.length;
    $("#recaler-tous-prix").disabled = !prix.length;
  }

  // Recalage : la bibliotheque prend la valeur observee, et la date qui va avec.
  function recalerOuvrage(ouvrageId) {
    const item = recalagesRendement().find((candidat) => candidat.ouvrage.id === ouvrageId);
    if (!item) return false;
    item.ouvrage.heures = item.rendement;
    return true;
  }

  function recalerMateriau(materiauId) {
    const item = recalagesPrix().find((candidat) => candidat.materiau.id === materiauId);
    if (!item) return false;
    item.materiau.prix = item.prix;
    if (item.observation.date) item.materiau.datePrix = item.observation.date;
    return true;
  }

  function updateChantierForm() {
    $("#chantier-form-title").textContent = editingChantierId ? "Modifier le chantier" : "Ajouter un chantier";
    $("#chantier-submit").textContent = editingChantierId ? "Sauvegarder" : "Enregistrer le chantier";
    $("#chantier-cancel-edit").classList.toggle("hidden", !editingChantierId);
  }

  function resetChantierForm() {
    const form = $("#chantier-form");
    form.reset();
    // Un releve porte presque toujours sur le jour meme.
    form.elements.date.value = todayLocalISO();
    editingChantierId = "";
    updateChantierForm();
  }

  /* --------------------------------------------------------------------- metre */

  // Un ouvrage a l'unite incompatible ne compte jamais, meme si ouvrageId est
  // renseigne — notamment pour une session sauvegardee avant ce garde-fou.
  function rowChiffrable(row) {
    return Boolean(row.ouvrageId) && row.quantiteOk && !row.unitWarning;
  }

  function metreRowPrice(row) {
    if (row.unitWarning) return 0;
    const ouvrage = ouvrageById(row.ouvrageId);
    return ouvrage ? priceOf(ouvrage).vente * (Number(row.quantite) || 0) : 0;
  }

  function metreGroups() {
    const groups = new Map();
    state.metre.analysed.forEach((row) => {
      const ouvrage = ouvrageById(row.ouvrageId);
      const lotCode = C.getLotCode(row.poste || row.numero);
      const label = row.lot || CATALOG.lotLabels[lotCode] || (lotCode ? `LOT ${lotCode}` : "Sans lot");
      if (!groups.has(label)) groups.set(label, { label, montant: 0, count: 0, chiffres: 0, unites: [], postes: [] });
      const group = groups.get(label);
      group.montant += metreRowPrice(row);
      group.count += 1;
      if (rowChiffrable(row)) group.chiffres += 1;
      const unite = ouvrage?.unite || row.unite || "";
      if (unite && !group.unites.includes(unite)) group.unites.push(unite);
      group.postes.push(row.numero);
    });
    return Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label, "fr"));
  }

  function actionGroups() {
    const groups = new Map();
    state.metre.analysed
      .filter((row) => !row.ouvrageId || !row.quantiteOk || row.unitWarning)
      .forEach((row) => {
        const family = C.classifyFamily(row.description);
        const key = `${row.lot}::${family}`;
        if (!groups.has(key)) {
          groups.set(key, { family, lot: row.lot, count: 0, unites: [], quantitesByUnit: {}, postes: [] });
        }
        const group = groups.get(key);
        const unite = C.normalizeUnit(row.unite) || row.unite || "?";
        const reason = row.unitWarning ? "unité incompatible" : !row.ouvrageId ? "ouvrage manquant" : "quantité à vérifier";
        group.count += 1;
        if (!group.unites.includes(unite)) group.unites.push(unite);
        group.quantitesByUnit[unite] = (group.quantitesByUnit[unite] || 0) + (Number(row.quantite) || 0);
        group.postes.push({ code: row.numero, reason });
      });
    return Array.from(groups.values()).sort((a, b) => `${a.lot} ${a.family}`.localeCompare(`${b.lot} ${b.family}`, "fr"));
  }

  function renderMetre() {
    const analysed = state.metre.analysed;
    const chiffres = analysed.filter(rowChiffrable).length;
    const total = analysed.reduce((sum, row) => sum + metreRowPrice(row), 0);

    $("#metre-status").innerHTML = state.metre.fileName
      ? `<strong>${esc(state.metre.fileName)}</strong> — ${state.metre.rows.length} poste(s) lu(s)${
          state.metre.skipped ? `, ${state.metre.skipped} ligne(s) ignorée(s)` : ""
        }${analysed.length ? ` · ${chiffres}/${analysed.length} chiffré(s) · total ${euro.format(total)}` : ""}${
          sourceWorkbook ? "" : `<br /><em>Classeur d’origine non disponible : réimportez le fichier pour le compléter.</em>`
        }`
      : "Aucun métré chargé.";

    $("#metre-groups").innerHTML = analysed.length
      ? metreGroups()
          .map(
            (group) => `<tr>
              <td><strong>${esc(group.label)}</strong></td>
              <td>${euro.format(group.montant)}</td>
              <td>${group.chiffres} / ${group.count}</td>
              <td>${esc(group.unites.join(", "))}</td>
            </tr>`,
          )
          .join("")
      : `<tr><td colspan="4" class="empty">Aucun regroupement disponible.</td></tr>`;

    const actions = analysed.length ? actionGroups() : [];
    $("#metre-missing-groups").innerHTML = actions.length
      ? actions
          .map(
            (group) => `<tr>
              <td><strong>${esc(group.family)}</strong></td>
              <td>${esc(group.lot || "-")}</td>
              <td>${group.count}</td>
              <td>${esc(
                Object.entries(group.quantitesByUnit)
                  .map(([unit, qty]) => `${number.format(qty)} ${unit}`)
                  .join(", "),
              )}</td>
              <td>${esc(group.postes.map((poste) => `${poste.code} (${poste.reason})`).join(", "))}</td>
            </tr>`,
          )
          .join("")
      : `<tr><td colspan="5" class="empty">${
          analysed.length ? "Tous les postes ont une correspondance exploitable." : "Aucun poste analysé."
        }</td></tr>`;

    $("#metre-lines").innerHTML = analysed.length
      ? analysed
          .map((row, index) => {
            const prix = metreRowPrice(row);
            const classes = [];
            if (!row.ouvrageId) classes.push("row-missing");
            else if (row.unitWarning) classes.push("row-warning");
            else if (!row.quantiteOk) classes.push("row-warning");
            return `<tr class="${classes.join(" ")}">
              <td>${esc(row.numero)}</td>
              <td>${esc(row.description)}</td>
              <td>${esc(row.unite)}${row.unitWarning ? ' <span class="flag" title="Unité incompatible avec l’ouvrage">!</span>' : ""}</td>
              <td>${row.quantiteOk ? number.format(row.quantite) : '<span class="flag">?</span>'}</td>
              <td><select data-metre-match="${index}"><option value="">— aucun ouvrage —</option>${ouvrageOptionsHtml}</select></td>
              <td>${matchBadge(row)}</td>
              <td>${prix ? euro.format(prix) : "-"}</td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="7" class="empty">Aucun métré analysé.</td></tr>`;

    // Selection appliquee apres coup : evite de reconstruire les options par ligne.
    document.querySelectorAll("#metre-lines select[data-metre-match]").forEach((select) => {
      select.value = analysed[Number(select.dataset.metreMatch)]?.ouvrageId || "";
    });
  }

  function matchBadge(row) {
    // row.unitWarning avec un ouvrageId encore renseigne : forme laissee par une
    // session sauvegardee avant le garde-fou sur l'unite. Ne jamais l'afficher comme
    // une correspondance valable, quelle que soit sa confiance mémorisée.
    if (!row.ouvrageId || row.unitWarning) {
      const suggestion = ouvrageById(row.suggestionId || row.ouvrageId);
      return suggestion
        ? `<span class="match none">à traiter</span><small>proche : ${esc(suggestion.nom)}</small>`
        : `<span class="match none">à traiter</span>`;
    }
    const level = row.confidence >= 0.99 ? "high" : row.confidence >= 0.55 ? "medium" : "low";
    return `<span class="match ${level}">${percent.format(row.confidence)}</span><small>${esc(row.reason || "")}</small>`;
  }

  /* ------------------------------------------------------- import et analyse */

  function mappingSelectors() {
    return {
      poste: $("#map-poste").value,
      description: $("#map-description").value,
      unite: $("#map-unite").value,
      quantite: $("#map-quantite").value,
      prixUnitaire: $("#map-prix").value,
    };
  }

  function populateFieldMap(headers) {
    const list = headers.filter((header) => !String(header).startsWith("__"));
    const html = [`<option value="">—</option>`]
      .concat(list.map((header) => `<option value="${esc(header)}">${esc(header)}</option>`))
      .join("");
    [
      ["#map-poste", C.HEADER_CANDIDATES.poste],
      ["#map-description", C.HEADER_CANDIDATES.description],
      ["#map-unite", C.HEADER_CANDIDATES.unite],
      ["#map-quantite", C.HEADER_CANDIDATES.quantite],
      ["#map-prix", C.HEADER_CANDIDATES.prixUnitaire],
    ].forEach(([selector, candidates]) => {
      const select = $(selector);
      select.innerHTML = html;
      select.value = C.findHeader(list, candidates) || "";
    });
  }

  function columnIndex(row, headerName, candidates) {
    const cols = row.__cols || {};
    if (headerName && cols[headerName] !== undefined) return cols[headerName];
    const fallback = C.findHeader(Object.keys(cols), candidates);
    return fallback ? cols[fallback] : undefined;
  }

  function analyseMetre() {
    if (!state.metre.rows.length) {
      notify("Chargez d’abord un métré.", "danger");
      return;
    }
    const mapping = mappingSelectors();
    state.metre.mapping = mapping;

    const alerts = [];
    const cache = new Map();
    const seenCodes = new Map();

    state.metre.analysed = state.metre.rows.map((raw, index) => {
      const numero = String(raw[mapping.poste] ?? "").trim() || String(index + 1);
      const description = String(raw[mapping.description] ?? "").trim();
      const unite = String(raw[mapping.unite] ?? "").trim();
      const quantite = C.parseNumber(raw[mapping.quantite]);
      const quantiteOk = Number.isFinite(quantite) && quantite > 0;
      const base = { numero, poste: numero, description, unite, quantite: quantiteOk ? quantite : 0, quantiteOk };
      const match = C.findMatch(base, state.ouvrages, cache);

      const label = `Poste ${numero}`;
      if (!description) alerts.push({ type: "danger", message: `${label} : description manquante.` });
      if (!quantiteOk) alerts.push({ type: "danger", message: `${label} : quantité absente ou nulle.` });
      if (!match.ouvrageId && match.unitWarning) {
        alerts.push({
          type: "danger",
          message: `${label} : un ouvrage correspond au code, mais son unité est incompatible avec « ${unite} ». À rapprocher manuellement.`,
        });
      } else if (!match.ouvrageId) {
        alerts.push({ type: "warning", message: `${label} : aucun ouvrage reconnu pour « ${description} ».` });
      } else if (match.unitWarning) {
        // Filet de securite : ne devrait plus se produire (findMatch et le choix manuel
        // bloquent deja l'unite incompatible), mais garde le message si un cas restait.
        alerts.push({
          type: "danger",
          message: `${label} : unité « ${unite} » incompatible avec l’ouvrage retenu.`,
        });
      }
      const codeKey = C.normalizeRef(numero);
      if (codeKey) {
        if (seenCodes.has(codeKey)) alerts.push({ type: "warning", message: `${label} : code présent plusieurs fois.` });
        seenCodes.set(codeKey, true);
      }

      return {
        ...base,
        lot: raw.__lot || raw.__sheet || "",
        ouvrageId: match.ouvrageId,
        confidence: match.confidence,
        reason: match.reason,
        unitWarning: match.unitWarning,
        suggestionId: match.suggestionId,
        manual: false,
        sheet: raw.__sheet || "",
        rowIndex: raw.__row,
        puCol: columnIndex(raw, mapping.prixUnitaire, C.HEADER_CANDIDATES.prixUnitaire),
      };
    });

    state.metre.alerts = alerts;
    saveState();
    render();
    const chiffres = state.metre.analysed.filter((row) => row.ouvrageId).length;
    notify(`${chiffres} poste(s) sur ${state.metre.analysed.length} rapproché(s) automatiquement.`, "info");
  }

  // Enregistre la correspondance choisie : elle sera reconnue au prochain marche.
  function learnMatch(row) {
    const ouvrage = ouvrageById(row.ouvrageId);
    // Filet de securite : ne jamais memoriser un rapprochement dont l'unite ne
    // correspond pas, meme si l'appelant a laisse passer ouvrageId par erreur.
    if (!ouvrage || !row.numero || row.unitWarning) return;
    const before = ouvrage.refsMetre.length;
    ouvrage.refsMetre = C.normalizeRefList([ouvrage.refsMetre, row.numero]);
    if (ouvrage.refsMetre.length !== before) {
      ouvrage.motsCles = C.normalizeKeywords([ouvrage.motsCles, row.numero]);
    }
  }

  /* ------------------------------------------------------------------ exports */

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportCsv(filename, rows) {
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(";"))
      .join("\r\n");
    downloadBlob(filename, new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
  }

  function requireXlsx() {
    if (globalThis.XLSX) return true;
    notify("La bibliothèque XLSX n’est pas chargée (connexion internet requise au premier lancement).", "danger");
    return false;
  }

  /*
   * Ecrit les prix unitaires dans le classeur recu et le renvoie tel quel :
   * feuilles, formules, sous-totaux et recapitulatif sont conserves.
   *
   * Reparti a chaque export depuis les octets d'origine (sourceArrayBuffer),
   * jamais depuis un classeur deja modifie : sinon un prix ecrit lors d'un export
   * precedent restait dans le fichier meme apres que l'utilisateur ait retire le
   * rapprochement correspondant (le poste etait simplement ignore, pas efface).
   */
  function exportMetreSource() {
    if (!requireXlsx()) return;
    if (!sourceArrayBuffer) {
      notify("Réimportez le fichier du métré pour pouvoir le compléter.", "danger");
      return;
    }
    const mapping = state.metre.mapping || {};
    if (!mapping.prixUnitaire) {
      notify("Indiquez la colonne « prix unitaire » avant de compléter le fichier.", "danger");
      return;
    }

    let workbook;
    try {
      workbook = XLSX.read(sourceArrayBuffer, { cellFormula: true, cellStyles: true });
    } catch (error) {
      notify(`Lecture du fichier d’origine impossible : ${error.message}`, "danger");
      return;
    }
    let written = 0;
    let skipped = 0;
    state.metre.analysed.forEach((row) => {
      const sheet = workbook.Sheets[row.sheet];
      if (!sheet || row.puCol === undefined || row.rowIndex === undefined) {
        skipped += 1;
        return;
      }
      const ouvrage = ouvrageById(row.ouvrageId);
      // Unite incompatible : jamais de prix exportable, meme si un rapprochement
      // errone avait pu etre memorise avant ce garde-fou.
      if (!ouvrage || row.unitWarning) {
        skipped += 1;
        return;
      }
      const address = XLSX.utils.encode_cell({ r: row.rowIndex, c: row.puCol });
      sheet[address] = { t: "n", v: C.roundMoney(priceOf(ouvrage).vente), z: "#,##0.00" };
      written += 1;
    });

    if (!written) {
      notify("Aucun prix à reporter : rapprochez d’abord les postes.", "danger");
      return;
    }
    const base = sourceFileName.replace(/\.(xlsx|xlsm|xls)$/i, "") || "metre";
    XLSX.writeFile(workbook, `${base}-chiffre.xlsx`);
    notify(
      `${written} prix reporté(s) dans le fichier d’origine${skipped ? `, ${skipped} poste(s) laissé(s) vide(s)` : ""}.`,
      "info",
    );
  }

  function metreRecapRows() {
    return {
      parametres: [
        ["Entreprise", state.entrepreneur.nom],
        ["N° TVA", state.entrepreneur.numeroTva],
        ["Coefficient K", C.coefficientK(state.settings)],
        ["Coût horaire", state.settings.coutHoraire],
        ["Frais généraux %", state.settings.fraisGeneraux],
        ["Frais de chantier %", state.settings.fraisChantier],
        ["Imprévus %", state.settings.imprevus],
        ["Marge %", state.settings.marge],
      ],
      regroupement: [
        ["Lot", "Montant HTVA", "Postes chiffrés", "Postes", "Unités"],
        ...metreGroups().map((g) => [g.label, C.roundMoney(g.montant), g.chiffres, g.count, g.unites.join(", ")]),
      ],
      aTraiter: [
        ["Famille probable", "Lot", "Nombre", "Quantités", "Postes"],
        ...actionGroups().map((g) => [
          g.family,
          g.lot,
          g.count,
          Object.entries(g.quantitesByUnit)
            .map(([unit, qty]) => `${C.roundMoney(qty)} ${unit}`)
            .join(", "),
          g.postes.map((p) => `${p.code} (${p.reason})`).join(", "),
        ]),
      ],
      detail: [
        ["Lot", "Poste", "Description", "Unité", "Quantité", "Ouvrage retenu", "Confiance", "PU HTVA", "Montant HTVA", "Statut"],
        ...state.metre.analysed.map((row) => {
          const ouvrage = ouvrageById(row.ouvrageId);
          // Unite incompatible : meme avec un ouvrage encore renseigne (session
          // sauvegardee avant ce garde-fou), ni le prix ni la confiance ne sont reels.
          const utilisable = Boolean(ouvrage) && !row.unitWarning;
          return [
            row.lot,
            row.numero,
            row.description,
            row.unite,
            row.quantite,
            ouvrage?.nom || "",
            utilisable ? C.roundMoney(row.confidence) : "",
            utilisable ? C.roundMoney(priceOf(ouvrage).vente) : "",
            C.roundMoney(metreRowPrice(row)),
            row.unitWarning ? "Unité incompatible" : !ouvrage ? "Ouvrage manquant" : row.quantiteOk ? "OK" : "Quantité à vérifier",
          ];
        }),
      ],
    };
  }

  function exportMetreRecap() {
    if (!requireXlsx()) return;
    const data = metreRecapRows();
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(data.parametres), "Paramètres");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(data.regroupement), "Regroupement");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(data.aTraiter), "A traiter");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(data.detail), "Détail");
    XLSX.writeFile(workbook, "metre-recapitulatif.xlsx");
  }

  function devisRows() {
    const totals = calculateDevisTotals();
    return [
      [state.entrepreneur.nom || "Devis"],
      [state.entrepreneur.adresse],
      [state.entrepreneur.numeroTva ? `TVA ${state.entrepreneur.numeroTva}` : ""],
      [],
      ["Client", state.devis.client],
      ["Adresse du chantier", state.devis.adresse],
      ["Objet", state.devis.objet],
      [],
      ["Ouvrage", "Unité", "Quantité", "PU HTVA", "Total HTVA"],
      ...state.devis.lignes.map((ligne) => {
        const ouvrage = ouvrageById(ligne.ouvrageId);
        if (!ouvrage) return ["Ouvrage supprimé", "", ligne.quantite, "", ""];
        const calc = priceOf(ouvrage);
        return [ouvrage.nom, ouvrage.unite, ligne.quantite, C.roundMoney(calc.vente), C.roundMoney(calc.vente * ligne.quantite)];
      }),
      [],
      ["Total HTVA", "", "", "", C.roundMoney(totals.ht)],
      [`TVA ${number.format(state.devis.tva)} %`, "", "", "", C.roundMoney(totals.tva)],
      ["Total TVAC", "", "", "", C.roundMoney(totals.ttc)],
    ];
  }

  /* ------------------------------------------------------------------ events */

  // Reutilise par les actions qui doivent amener sur une autre vue avant d'agir
  // (ex. « Éditer » un prix perime depuis le tableau de bord).
  function goToView(name) {
    document.querySelectorAll(".nav-item").forEach((item) => {
      item.classList.toggle("active", item.dataset.view === name);
      if (item.dataset.view === name) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
    document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === name));
    $("#view-title").textContent = VIEW_LABELS[name];
  }

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => goToView(button.dataset.view));
  });

  /* ------------------------------------------------------------------- theme */

  // Couleur de la barre d'etat mobile : suit le theme resolu, pas seulement le choix.
  function updateThemeColorMeta(resolvedDark) {
    const meta = $("#theme-color-meta");
    if (meta) meta.content = resolvedDark ? "#17201f" : "#0f7c6c";
  }

  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)");

  // "auto" : rien en localStorage, l'attribut suit prefers-color-scheme via la CSS.
  function applyTheme(choice) {
    const theme = ["light", "dark"].includes(choice) ? choice : "auto";
    if (theme === "auto") {
      document.documentElement.removeAttribute("data-theme");
      try {
        localStorage.removeItem(THEME_KEY);
      } catch {
        // Navigation privee stricte : le choix ne survivra pas au rechargement.
      }
    } else {
      document.documentElement.setAttribute("data-theme", theme);
      try {
        localStorage.setItem(THEME_KEY, theme);
      } catch {
        /* idem */
      }
    }
    document.querySelectorAll(".theme-toggle button").forEach((button) => {
      button.classList.toggle("active", button.dataset.themeChoice === theme);
    });
    updateThemeColorMeta(theme === "dark" || (theme === "auto" && Boolean(prefersDark?.matches)));
  }

  document.querySelectorAll(".theme-toggle button").forEach((button) => {
    button.addEventListener("click", () => applyTheme(button.dataset.themeChoice));
  });

  // Theme systeme change pendant que l'app est ouverte, en mode automatique.
  prefersDark?.addEventListener?.("change", () => {
    if (!document.documentElement.getAttribute("data-theme")) {
      updateThemeColorMeta(prefersDark.matches);
    }
  });

  $("#materiau-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const payload = {
      nom: data.nom.trim(),
      unite: data.unite.trim(),
      fournisseur: data.fournisseur.trim(),
      reference: data.reference.trim(),
      conditionnement: data.conditionnement.trim(),
      prix: Number(data.prix) || 0,
      datePrix: data.datePrix || "",
    };
    if (editingMateriauId) {
      const materiau = materialById(editingMateriauId);
      if (materiau) Object.assign(materiau, payload);
      editingMateriauId = "";
    } else {
      state.materiaux.push({ id: uid(), ...payload });
    }
    event.currentTarget.reset();
    updateEditForms();
    saveState();
    render();
    notify("Matériau enregistré.", "info");
  });

  $("#ouvrage-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const refs = C.normalizeRefList([data.refsMetre]);
    const payload = {
      nom: C.stripLeadingCode(data.nom),
      unite: data.unite.trim(),
      heures: Number(data.heures) || 0,
      composants: readComposantRows(),
      materiel: Number(data.materiel) || 0,
      refsMetre: refs,
      motsCles: C.normalizeKeywords([data.motsCles, refs.join(", ")]),
    };
    if (editingOuvrageId) {
      const ouvrage = ouvrageById(editingOuvrageId);
      if (ouvrage) Object.assign(ouvrage, payload);
      editingOuvrageId = "";
    } else {
      const usedCodes = new Set(state.ouvrages.map((ouvrage) => ouvrage.poste));
      state.ouvrages.push({ id: uid(), poste: C.nextInternalCode(usedCodes, payload.nom), ...payload });
    }
    event.currentTarget.reset();
    setComposantRows([]);
    updateEditForms();
    saveState();
    render();
    notify("Ouvrage enregistré.", "info");
  });

  $("#settings-form").addEventListener("submit", (event) => {
    event.preventDefault();
    readSettingsForm(event.currentTarget);
    saveState();
    render();
    notify("Paramètres mis à jour.", "info");
  });

  $("#settings-form").addEventListener("input", (event) => {
    readSettingsForm(event.currentTarget);
    saveState();
    renderSettingsComputedValues();
    renderKpis();
    // Le detail des prix depend de K : on ne rafraichit que ce qui l'utilise.
    if (event.target.type === "range" || event.target.name === "coutHoraire" || event.target.name === "tva") {
      renderDashboard();
      renderOuvrages();
      renderDevis();
      renderMetre();
    }
    if (event.target.name === "peremptionJours") {
      renderPeremption();
      renderMateriaux();
    }
  });

  $("#devis-meta-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    state.devis = { ...state.devis, ...data, tva: Number(data.tva) || 0 };
    editingDevisMeta = false;
    saveState();
    render();
  });

  $("#edit-devis-meta").addEventListener("click", () => {
    editingDevisMeta = true;
    updateDevisMetaMode();
  });

  $("#devis-line-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    if (!data.ouvrage) {
      notify("Sélectionnez un ouvrage.", "danger");
      return;
    }
    const payload = { ouvrageId: data.ouvrage, quantite: Number(data.quantite) || 0 };
    if (editingDevisLineId) {
      const ligne = state.devis.lignes.find((item) => item.id === editingDevisLineId);
      if (ligne) Object.assign(ligne, payload);
      editingDevisLineId = "";
    } else {
      state.devis.lignes.push({ id: uid(), ...payload });
    }
    event.currentTarget.reset();
    updateDevisLineMode();
    saveState();
    render();
  });

  /* ----------------------------------------------------------------- chantiers */

  $("#chantier-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const payload = { nom: data.nom.trim(), reference: data.reference.trim(), date: data.date || "" };
    if (editingChantierId) {
      const chantier = chantierById(editingChantierId);
      if (chantier) Object.assign(chantier, payload);
      selectedChantierId = editingChantierId;
    } else {
      const chantier = { id: uid(), ...payload, mainOeuvre: [], achats: [] };
      state.chantiers.push(chantier);
      selectedChantierId = chantier.id;
    }
    resetChantierForm();
    saveState();
    render();
    notify("Chantier enregistré.", "info");
  });

  $("#chantier-cancel-edit").addEventListener("click", resetChantierForm);

  $("#releve-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const chantier = chantierCourant();
    if (!chantier) return;
    const data = Object.fromEntries(new FormData(event.currentTarget));
    if (!data.ouvrage) {
      notify("Sélectionnez un ouvrage.", "danger");
      return;
    }
    chantier.mainOeuvre.push({
      id: uid(),
      ouvrageId: data.ouvrage,
      quantite: Number(data.quantite) || 0,
      personnes: Number(data.personnes) || 1,
      duree: Number(data.duree) || 0,
    });
    event.currentTarget.reset();
    selectedChantierId = chantier.id;
    saveState();
    render();
  });

  $("#achat-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const chantier = chantierCourant();
    if (!chantier) return;
    const data = Object.fromEntries(new FormData(event.currentTarget));
    if (!data.materiau) {
      notify("Sélectionnez un matériau.", "danger");
      return;
    }
    chantier.achats.push({
      id: uid(),
      materiauId: data.materiau,
      quantite: Number(data.quantite) || 0,
      montant: Number(data.montant) || 0,
    });
    event.currentTarget.reset();
    selectedChantierId = chantier.id;
    saveState();
    render();
  });

  function startChantierEdit(id) {
    const chantier = chantierById(id);
    if (!chantier) return;
    editingChantierId = id;
    selectedChantierId = id;
    const form = $("#chantier-form");
    form.elements.nom.value = chantier.nom;
    form.elements.reference.value = chantier.reference;
    form.elements.date.value = chantier.date;
    updateChantierForm();
    render();
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  $("#chantiers").addEventListener("click", (event) => {
    const bouton = event.target.closest("button");
    if (!bouton) return;
    const data = bouton.dataset;

    if (data.editChantier) return startChantierEdit(data.editChantier);

    if (data.selectChantier) {
      selectedChantierId = data.selectChantier;
    } else if (data.deleteChantier) {
      const chantier = chantierById(data.deleteChantier);
      if (!window.confirm(`Supprimer le relevé du chantier « ${chantier?.nom} » ? Les corrections déjà appliquées à la bibliothèque sont conservées.`)) return;
      state.chantiers = state.chantiers.filter((item) => item.id !== data.deleteChantier);
      if (selectedChantierId === data.deleteChantier) selectedChantierId = "";
      if (editingChantierId === data.deleteChantier) resetChantierForm();
    } else if (data.deleteReleve) {
      const chantier = chantierCourant();
      if (!chantier) return;
      chantier.mainOeuvre = chantier.mainOeuvre.filter((releve) => releve.id !== data.deleteReleve);
    } else if (data.deleteAchat) {
      const chantier = chantierCourant();
      if (!chantier) return;
      chantier.achats = chantier.achats.filter((achat) => achat.id !== data.deleteAchat);
    } else if (data.recalerOuvrage) {
      if (!recalerOuvrage(data.recalerOuvrage)) return;
      notify("Rendement recalé sur les heures relevées.", "info");
    } else if (data.recalerMateriau) {
      if (!recalerMateriau(data.recalerMateriau)) return;
      notify("Prix recalé sur les factures relevées.", "info");
    } else {
      return;
    }

    saveState();
    render();
  });

  // Correction d'un releve saisi de travers, directement dans le tableau.
  $("#chantiers").addEventListener("change", (event) => {
    const champ = event.target.dataset.champ;
    if (!champ) return;
    const chantier = chantierCourant();
    if (!chantier) return;
    const valeur = Math.max(0, Number(event.target.value) || 0);
    if (event.target.dataset.releve) {
      const releve = chantier.mainOeuvre.find((item) => item.id === event.target.dataset.releve);
      if (!releve) return;
      releve[champ] = champ === "personnes" ? Math.max(1, Math.round(valeur)) : valeur;
    } else if (event.target.dataset.achat) {
      const achat = chantier.achats.find((item) => item.id === event.target.dataset.achat);
      if (!achat) return;
      achat[champ] = valeur;
    } else {
      return;
    }
    saveState();
    render();
  });

  $("#recaler-tous-rendements").addEventListener("click", () => {
    const items = recalagesRendement();
    if (!items.length) return;
    if (!window.confirm(`Recaler ${items.length} rendement(s) sur les heures réellement prestées ?`)) return;
    items.forEach((item) => recalerOuvrage(item.ouvrage.id));
    saveState();
    render();
    notify(`${items.length} rendement(s) recalé(s).`, "info");
  });

  $("#recaler-tous-prix").addEventListener("click", () => {
    const items = recalagesPrix();
    if (!items.length) return;
    if (!window.confirm(`Recaler ${items.length} prix sur les montants réellement facturés ?`)) return;
    items.forEach((item) => recalerMateriau(item.materiau.id));
    saveState();
    render();
    notify(`${items.length} prix recalé(s).`, "info");
  });

  $("#ouvrage-search").addEventListener("input", renderOuvrages);
  $("#materiau-search").addEventListener("input", renderMateriaux);

  document.body.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    const data = target.dataset;

    if (data.mergeFrom && data.mergeTo) return mergeOuvrages(data.mergeFrom, data.mergeTo);
    if (data.confirmPrixMateriau) return confirmerPrixMateriau(data.confirmPrixMateriau);
    if (data.editMateriau) return startMateriauEdit(data.editMateriau);
    if (data.editOuvrage) return startOuvrageEdit(data.editOuvrage);
    if (data.editLigne) return startDevisLineEdit(data.editLigne);

    if (data.deleteMateriau) {
      const materiau = materialById(data.deleteMateriau);
      const used = state.ouvrages.filter((ouvrage) =>
        ouvrage.composants.some((composant) => composant.materiauId === data.deleteMateriau),
      );
      // Les achats de chantier deja enregistres ne sont pas modifies : ils gardent la
      // reference et s'affichent comme « materiau supprime » (cf. renderChantierDetail).
      // C'est juste porte a la connaissance de l'utilisateur avant qu'il supprime.
      const achats = state.chantiers.reduce(
        (total, chantier) => total + chantier.achats.filter((achat) => achat.materiauId === data.deleteMateriau).length,
        0,
      );
      const avertissements = [
        used.length ? `${used.length} ouvrage(s) l’utilisent et perdront leur coût matière` : "",
        achats ? `${achats} achat(s) de chantier y font référence et deviendront non identifiables` : "",
      ].filter(Boolean);
      const message = avertissements.length
        ? `Supprimer « ${materiau?.nom} » ? ${avertissements.join(" ; ")}.`
        : `Supprimer « ${materiau?.nom} » ?`;
      if (!window.confirm(message)) return;
      state.materiaux = state.materiaux.filter((item) => item.id !== data.deleteMateriau);
      state.ouvrages.forEach((ouvrage) => {
        ouvrage.composants = ouvrage.composants.filter((composant) => composant.materiauId !== data.deleteMateriau);
      });
      if (editingOuvrageId) setComposantRows(ouvrageById(editingOuvrageId)?.composants || []);
      if (editingMateriauId === data.deleteMateriau) editingMateriauId = "";
    } else if (data.deleteOuvrage) {
      const ouvrage = ouvrageById(data.deleteOuvrage);
      const usedDevis = state.devis.lignes.filter((ligne) => ligne.ouvrageId === data.deleteOuvrage).length;
      // Meme principe que pour un materiau : le releve de chantier n'est pas modifie,
      // seulement signale avant suppression (il s'affichera « ouvrage supprimé »).
      const usedChantiers = state.chantiers.reduce(
        (total, chantier) => total + chantier.mainOeuvre.filter((releve) => releve.ouvrageId === data.deleteOuvrage).length,
        0,
      );
      const avertissements = [
        usedDevis ? `${usedDevis} ligne(s) de devis` : "",
        usedChantiers ? `${usedChantiers} relevé(s) de chantier` : "",
      ].filter(Boolean);
      const message = avertissements.length
        ? `Supprimer « ${ouvrage?.nom} » ? ${avertissements.join(" et ")} y font référence.`
        : `Supprimer « ${ouvrage?.nom} » ?`;
      if (!window.confirm(message)) return;
      state.ouvrages = state.ouvrages.filter((item) => item.id !== data.deleteOuvrage);
      state.metre.analysed.forEach((row) => {
        if (row.ouvrageId === data.deleteOuvrage) row.ouvrageId = "";
      });
      if (editingOuvrageId === data.deleteOuvrage) editingOuvrageId = "";
    } else if (data.deleteLigne) {
      state.devis.lignes = state.devis.lignes.filter((ligne) => ligne.id !== data.deleteLigne);
      if (editingDevisLineId === data.deleteLigne) editingDevisLineId = "";
    } else {
      return;
    }

    updateEditForms();
    updateDevisLineMode();
    saveState();
    render();
  });

  function mergeOuvrages(fromId, toId) {
    const source = ouvrageById(fromId);
    const target = ouvrageById(toId);
    if (!source || !target || fromId === toId) return;
    const confirmed = window.confirm(
      `Fusionner « ${source.poste} — ${source.nom} » dans « ${target.poste} — ${target.nom} » ?\n\n` +
        "Les lignes de devis, les correspondances de métré, les relevés de chantier et les codes appris seront transférés.",
    );
    if (!confirmed) return;

    target.refsMetre = C.normalizeRefList([target.refsMetre, source.refsMetre]);
    target.motsCles = C.normalizeKeywords([target.motsCles, source.motsCles]);
    state.devis.lignes.forEach((ligne) => {
      if (ligne.ouvrageId === fromId) ligne.ouvrageId = toId;
    });
    state.metre.analysed.forEach((row) => {
      if (row.ouvrageId === fromId) row.ouvrageId = toId;
    });
    // Sans ce transfert, l'historique de chantier de l'ouvrage fusionné ne recale
    // plus jamais rien : il reste attache a un id qui n'existe plus apres la fusion.
    state.chantiers.forEach((chantier) => {
      chantier.mainOeuvre.forEach((releve) => {
        if (releve.ouvrageId === fromId) releve.ouvrageId = toId;
      });
    });
    state.ouvrages = state.ouvrages.filter((ouvrage) => ouvrage.id !== fromId);
    if (editingOuvrageId === fromId) {
      editingOuvrageId = "";
      $("#ouvrage-form").reset();
      setComposantRows([]);
    }
    updateEditForms();
    saveState();
    render();
    notify("Ouvrages fusionnés.", "info");
  }

  $("#materiau-cancel-edit").addEventListener("click", () => {
    editingMateriauId = "";
    $("#materiau-form").reset();
    updateEditForms();
  });

  $("#ouvrage-cancel-edit").addEventListener("click", () => {
    editingOuvrageId = "";
    $("#ouvrage-form").reset();
    setComposantRows([]);
    updateEditForms();
  });

  $("#ouvrage-add-composant").addEventListener("click", addComposantRow);

  $("#ouvrage-composants").addEventListener("click", (event) => {
    const bouton = event.target.closest("[data-remove-composant]");
    if (!bouton) return;
    const rows = $("#ouvrage-composants").querySelectorAll(".composant-row");
    // La derniere ligne est videe plutot que supprimee : la liste ne disparait jamais.
    if (rows.length === 1) setComposantRows([]);
    else bouton.closest(".composant-row").remove();
    updateComposantsTotal();
  });

  $("#ouvrage-composants").addEventListener("input", updateComposantsTotal);
  $("#ouvrage-composants").addEventListener("change", updateComposantsTotal);

  $("#devis-line-cancel-edit").addEventListener("click", () => {
    editingDevisLineId = "";
    $("#devis-line-form").reset();
    updateDevisLineMode();
  });

  function startMateriauEdit(id) {
    const materiau = materialById(id);
    if (!materiau) return;
    goToView("materiaux");
    editingMateriauId = id;
    const form = $("#materiau-form");
    ["nom", "unite", "fournisseur", "reference", "conditionnement", "prix", "datePrix"].forEach((field) => {
      form.elements[field].value = materiau[field] ?? "";
    });
    updateEditForms();
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function startOuvrageEdit(id) {
    const ouvrage = ouvrageById(id);
    if (!ouvrage) return;
    editingOuvrageId = id;
    const form = $("#ouvrage-form");
    form.elements.nom.value = ouvrage.nom;
    form.elements.unite.value = ouvrage.unite;
    form.elements.heures.value = ouvrage.heures;
    setComposantRows(ouvrage.composants);
    form.elements.materiel.value = ouvrage.materiel;
    form.elements.motsCles.value = ouvrage.motsCles;
    form.elements.refsMetre.value = ouvrage.refsMetre.join(", ");
    form.elements.poste.value = ouvrage.poste;
    updateEditForms();
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function startDevisLineEdit(id) {
    const ligne = state.devis.lignes.find((item) => item.id === id);
    if (!ligne) return;
    editingDevisLineId = id;
    const form = $("#devis-line-form");
    form.elements.ouvrage.value = ligne.ouvrageId;
    form.elements.quantite.value = ligne.quantite;
    updateDevisLineMode();
    form.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function updateEditForms() {
    $("#materiau-form-title").textContent = editingMateriauId ? "Modifier le matériau" : "Ajouter un matériau";
    $("#materiau-submit").textContent = editingMateriauId ? "Sauvegarder" : "Enregistrer le matériau";
    $("#materiau-cancel-edit").classList.toggle("hidden", !editingMateriauId);
    $("#ouvrage-form-title").textContent = editingOuvrageId ? "Modifier l’ouvrage" : "Ajouter un ouvrage";
    $("#ouvrage-submit").textContent = editingOuvrageId ? "Sauvegarder" : "Enregistrer l’ouvrage";
    $("#ouvrage-cancel-edit").classList.toggle("hidden", !editingOuvrageId);
    $("#ouvrage-form").elements.poste.value = editingOuvrageId ? ouvrageById(editingOuvrageId)?.poste || "" : "attribué automatiquement";
  }

  // Choix manuel d'une correspondance : on l'applique et on la retient.
  document.body.addEventListener("change", (event) => {
    const index = event.target.dataset.metreMatch;
    if (index === undefined) return;
    const row = state.metre.analysed[Number(index)];
    if (!row) return;
    const chosen = ouvrageById(event.target.value);
    // Meme regle qu'au rapprochement automatique : une unite incompatible n'est
    // jamais assignable, choix manuel compris — sinon rien n'empeche de mémoriser
    // et d'exporter un prix pour la mauvaise unite par une simple erreur de saisie.
    if (chosen && !C.unitsCompatible(chosen.unite, row.unite)) {
      event.target.value = row.ouvrageId || "";
      notify(
        `Unité incompatible : « ${row.unite || "?"} » ne peut pas être chiffré avec « ${chosen.nom} » (${chosen.unite}).`,
        "danger",
      );
      return;
    }
    row.ouvrageId = event.target.value;
    row.manual = Boolean(event.target.value);
    row.confidence = event.target.value ? 1 : 0;
    row.reason = event.target.value ? "confirmé" : "";
    row.suggestionId = "";
    row.unitWarning = false;
    if (chosen) learnMatch(row);
    saveState();
    render();
  });

  $("#confirm-matches").addEventListener("click", () => {
    const proposals = state.metre.analysed.filter((row) => row.ouvrageId && !row.manual);
    if (!proposals.length) {
      notify("Aucune proposition à confirmer.", "info");
      return;
    }
    if (!window.confirm(`Confirmer ${proposals.length} correspondance(s) ? Les codes de métré seront mémorisés.`)) return;
    proposals.forEach((row) => {
      row.manual = true;
      row.confidence = 1;
      row.reason = "confirmé";
      learnMatch(row);
    });
    saveState();
    render();
    notify(`${proposals.length} correspondance(s) mémorisée(s).`, "info");
  });

  $("#metre-file").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const extension = file.name.split(".").pop().toLowerCase();
      let rows = [];
      let skipped = 0;
      let headers = [];
      // Variables locales : sourceWorkbook/sourceArrayBuffer/sourceFileName ne sont
      // remplaces qu'une fois la lecture entierement reussie. Sans ça, un fichier
      // corrompu pouvait laisser sourceArrayBuffer pointer vers les octets invalides
      // pendant que l'ancien metre restait affiche — un « Compléter le fichier reçu »
      // ulterieur aurait alors tente de relire ces octets et echoue silencieusement.
      let nextWorkbook = null;
      let nextArrayBuffer = null;

      if (["xlsx", "xlsm", "xls"].includes(extension)) {
        if (!requireXlsx()) return;
        nextArrayBuffer = await file.arrayBuffer();
        nextWorkbook = XLSX.read(nextArrayBuffer, { cellFormula: true, cellStyles: true });
        nextWorkbook.SheetNames.forEach((sheetName) => {
          if (C.normalizeText(sheetName).includes("recap")) return;
          const grid = XLSX.utils.sheet_to_json(nextWorkbook.Sheets[sheetName], { header: 1, defval: "", blankrows: true });
          const parsed = C.rowsFromGrid(grid, sheetName);
          rows = rows.concat(parsed.rows);
          skipped += parsed.skipped;
          parsed.headers.forEach((header) => {
            if (!headers.includes(header)) headers.push(header);
          });
        });
      } else {
        const parsed = C.rowsFromGrid(C.parseDelimited(await file.text()), file.name);
        rows = parsed.rows;
        skipped = parsed.skipped;
        headers = parsed.headers;
      }

      if (!rows.length) {
        notify("Aucune ligne exploitable : vérifiez que le fichier contient désignation, unité et quantité.", "danger");
      }
      sourceWorkbook = nextWorkbook;
      sourceArrayBuffer = nextArrayBuffer;
      sourceFileName = file.name;
      state.metre = { ...emptyMetre(), fileName: file.name, rows, skipped };
      populateFieldMap(headers);
      saveState();
      render();
      if (rows.length) notify(`${rows.length} poste(s) lu(s). Vérifiez les colonnes puis lancez l’analyse.`, "info");
    } catch (error) {
      notify(`Lecture impossible : ${error.message}`, "danger");
    } finally {
      event.target.value = "";
    }
  });

  $("#analyse-metre").addEventListener("click", analyseMetre);
  $("#export-metre-source").addEventListener("click", exportMetreSource);
  $("#export-metre-xlsx").addEventListener("click", exportMetreRecap);

  $("#export-metre").addEventListener("click", () => {
    const data = metreRecapRows();
    exportCsv("metre-chiffre.csv", [
      ...data.parametres,
      [],
      ["Regroupement par lot"],
      ...data.regroupement,
      [],
      ["Postes à traiter"],
      ...data.aTraiter,
      [],
      ["Détail des postes"],
      ...data.detail,
    ]);
  });

  $("#export-devis").addEventListener("click", () => exportCsv("devis-client.csv", devisRows()));

  $("#export-devis-xlsx").addEventListener("click", () => {
    if (!requireXlsx()) return;
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(devisRows()), "Devis");
    XLSX.writeFile(workbook, "devis-client.xlsx");
  });

  $("#export-devis-json").addEventListener("click", () => {
    downloadBlob("devis-client.json", new Blob([JSON.stringify({ devis: state.devis }, null, 2)], { type: "application/json" }));
  });

  $("#import-devis-json").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      const devis = imported.devis || imported;
      if (!Array.isArray(devis.lignes)) throw new Error("structure invalide");
      state.devis = normalizeState({ ...state, devis }).devis;
      editingDevisMeta = false;
      saveState();
      render();
      notify("Devis importé.", "info");
    } catch {
      notify("Ce fichier n’est pas un devis exporté par l’application.", "danger");
    } finally {
      event.target.value = "";
    }
  });

  $("#export-data").addEventListener("click", () => {
    const payload = { ...state, metre: { ...state.metre, rows: [] } };
    downloadBlob("generateur-devis-donnees.json", new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  });

  $("#import-data").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      if (!imported.settings || !Array.isArray(imported.materiaux) || !Array.isArray(imported.ouvrages)) {
        throw new Error("structure invalide");
      }
      if (!window.confirm("Remplacer la bibliothèque actuelle par le contenu de ce fichier ?")) return;
      state = normalizeState(imported);
      if (!state.catalogVersion) state.catalogVersion = CATALOG_VERSION;
      saveState();
      render();
      notify("Données importées.", "info");
    } catch {
      notify("Ce fichier n’est pas un export de l’application.", "danger");
    } finally {
      event.target.value = "";
    }
  });

  $("#reload-catalog").addEventListener("click", () => {
    if (!window.confirm("Réinstaller les ouvrages et matériaux du catalogue manquants ? Vos données existantes sont conservées.")) return;
    const added = seedCatalog(true);
    saveState();
    render();
    notify(added ? `${added} ouvrage(s) ajouté(s) depuis le catalogue.` : "Le catalogue est déjà complet.", "info");
  });

  $("#reset-all").addEventListener("click", () => {
    if (!window.confirm("Effacer TOUTES les données (ouvrages, matériaux, devis, métré) et repartir du catalogue ?")) return;
    if (!window.confirm("Cette action est définitive. Confirmer ?")) return;
    state = normalizeState(blankState());
    sourceWorkbook = null;
    sourceArrayBuffer = null;
    sourceFileName = "";
    seedCatalog(true);
    saveState();
    render();
    notify("Application réinitialisée.", "info");
  });

  /* --------------------------------------------------------------------- init */

  populateFieldMap(Object.keys(state.metre.rows[0] || {}));
  if (state.metre.mapping?.poste) {
    Object.entries({
      "#map-poste": state.metre.mapping.poste,
      "#map-description": state.metre.mapping.description,
      "#map-unite": state.metre.mapping.unite,
      "#map-quantite": state.metre.mapping.quantite,
      "#map-prix": state.metre.mapping.prixUnitaire,
    }).forEach(([selector, value]) => {
      const select = $(selector);
      if (select && value) select.value = value;
    });
  }
  updateEditForms();
  resetChantierForm();
  render();
  setComposantRows([]);
  saveState();
  const versionEl = $("#app-version");
  if (versionEl) versionEl.textContent = `v${APP_VERSION}`;
  // L'attribut est deja pose par le script en tete de <head> (evite un flash) :
  // ceci ne fait que synchroniser l'etat visuel des boutons avec ce choix.
  applyTheme(document.documentElement.getAttribute("data-theme") || "auto");

  // Rend l'app disponible hors connexion apres une premiere visite en ligne.
  // Chemin relatif : indispensable sous le sous-dossier de GitHub Pages.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {
        // Pas grave : l'app reste utilisable, seulement sans le mode hors ligne.
      });
    });
  }
})();
