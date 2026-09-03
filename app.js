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
  const APP_VERSION = "3.2.1";
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

  /*
   * Octets d'origine intacts du dernier metre importe : chaque export en repart, pour
   * ne jamais publier un prix ecrit lors d'un export precedent et jamais retire depuis
   * (cf. exportMetreSource). Ils sont aussi ranges dans IndexedDB (db.js) : sans ça,
   * refermer l'application obligeait a reimporter le fichier — et donc a refaire toute
   * l'analyse — pour pouvoir le completer.
   */
  let sourceArrayBuffer = null;
  let sourceFileName = "";
  // Liste des metres deja chiffres, sans leurs donnees lourdes (cf. db.js).
  let metreArchives = [];

  let editingMateriauId = "";
  let editingOuvrageId = "";
  // Index dans state.metre.analysed a rattacher a l'ouvrage sauvegarde, quand le
  // formulaire a ete ouvert depuis "Créer un ouvrage à partir de ce poste". -1 sinon.
  // { metreId, rowIndex, numero } et non un simple index : voir resoudrePosteEnAttente.
  let posteEnAttente = null;
  let editingDevisMeta = false;
  let editingDevisLineId = "";
  let editingChantierId = "";
  let selectedChantierId = "";
  let storageWarningShown = false;
  // Clef sous laquelle un etat illisible a ete mis de cote au chargement ("" sinon).
  let corruptedStateKey = "";

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

  // Etat et migration vivent dans core.js : sans DOM, donc testables. app.js ne
  // garde que le branchement sur le catalogue et la generation d'identifiants.
  const emptyMetre = () => C.emptyMetre();
  const blankState = () => C.blankState(CATALOG);
  const normalizeState = (source) =>
    C.normalizeState(source, {
      catalog: CATALOG,
      uid,
      today: todayLocalISO(),
      // Cas rare (donnees anciennes deja incoherentes) : pas de UI dediee, mais au
      // moins une trace pour qui regarde la console.
      onWarning: (message) => console.warn(message),
    });

  function loadState() {
    let raw = "";
    try {
      raw = localStorage.getItem(STORAGE_KEY) || "";
      if (raw) return JSON.parse(raw);
      // Reprise des donnees de la version precedente si elles existent.
      const legacy = localStorage.getItem("generateur-devis-v1");
      if (legacy) return JSON.parse(legacy);
    } catch {
      // Donnees illisibles : on repart du catalogue, mais sans ecraser le brut — il
      // est peut-etre recuperable a la main, et le saveState() de l'initialisation
      // l'aurait definitivement perdu.
      try {
        if (raw) {
          corruptedStateKey = `${STORAGE_KEY}-corrompu`;
          localStorage.setItem(corruptedStateKey, raw);
        }
      } catch {
        corruptedStateKey = "";
      }
    }
    return blankState();
  }

  function saveState() {
    planifierArchivage();
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
      // Ne (re)donner que les codes qu'aucun autre ouvrage ne porte deja : un code
      // retire d'ici par apprentissage (learnMatch) a ete rattache ailleurs, le
      // remettre annulerait ce choix en silence — et le premier trouve gagnerait.
      // Vaut aussi pour un ouvrage du catalogue recree apres suppression.
      const pris = new Set(
        state.ouvrages.flatMap((autre) =>
          existing && autre.id === existing.id ? [] : (autre.refsMetre || []).map((ref) => C.normalizeRef(ref)),
        ),
      );
      const libres = refs.filter((ref) => !pris.has(C.normalizeRef(ref)));
      if (existing) {
        existing.refsMetre = C.normalizeRefList([existing.refsMetre, libres]);
        existing.motsCles = C.normalizeKeywords([existing.motsCles, source.motsCles, libres.join(", ")]);
        return;
      }
      const code = C.nextInternalCode(usedCodes, source.nom);
      usedCodes.add(code);
      state.ouvrages.push({
        id: uid(),
        poste: code,
        refsMetre: libres,
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
        motsCles: C.normalizeKeywords([source.motsCles, source.nom, libres.join(", ")]),
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
  // La vente est arrondie au centime ici, une seule fois : c'est le PU ecrit dans le
  // classeur rendu a la commune, que ses formules multiplient ensuite. Tous les
  // montants de l'app en derivent, sinon recapitulatif et fichier divergeaient
  // (jusqu'a 1 € par poste sur 27 ouvrages du catalogue a 237 unites).
  const priceOf = (ouvrage) => {
    const calc = C.calculateOuvrage(ouvrage, state.settings, materialById);
    return { ...calc, vente: C.roundMoney(calc.vente) };
  };

  /* ---------------------------------------------------------------- notifications */

  let notifyTimer = 0;
  function notify(message, kind) {
    const zone = $("#toast");
    const texte = $("#toast-text");
    if (!zone || !texte) return;
    texte.textContent = message;
    zone.className = `toast visible ${kind || "info"}`;
    clearTimeout(notifyTimer);
    // Une erreur demande de lire puis d'agir : elle reste deux fois plus longtemps
    // qu'une simple confirmation, et se ferme d'un clic dans tous les cas.
    notifyTimer = setTimeout(() => zone.classList.remove("visible"), kind === "info" || !kind ? 6000 : 12000);
  }

  /*
   * Remplace window.confirm pour les decisions qui demandent de lire un tableau : le
   * dialogue natif d'Android affiche un bloc de texte tronque, sans colonnes ni
   * alignement. Repli sur window.confirm si <dialog> n'est pas disponible.
   */
  function askDialog({ titre, corpsHtml, corpsTexte, ok = "Confirmer", annuler = "Annuler" }) {
    const dialog = $("#app-dialog");
    if (!dialog || typeof dialog.showModal !== "function") {
      return Promise.resolve(window.confirm(`${titre}\n\n${corpsTexte || ""}`));
    }
    $("#app-dialog-title").textContent = titre;
    $("#app-dialog-body").innerHTML = corpsHtml;
    $("#app-dialog-ok").textContent = ok;
    $("#app-dialog-cancel").textContent = annuler;
    return new Promise((resolve) => {
      dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
      dialog.returnValue = "annuler";
      dialog.showModal();
      $("#app-dialog-body").scrollTop = 0;
    });
  }

  function hideToast() {
    clearTimeout(notifyTimer);
    $("#toast")?.classList.remove("visible");
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
    $("#kpi-alertes").textContent = state.metre.analysed.filter(
      (row) => row.unitWarning || (!row.ouvrageId && !row.pourMemoire),
    ).length;
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
          .map((alert) => {
            // Un poste sans ouvrage se règle en créant l'ouvrage : autant le proposer
            // ici plutôt que de renvoyer chercher la ligne dans le tableau du métré.
            const index = C.posteDeLAlerte(alert, state.metre.analysed);
            const action =
              index >= 0
                ? `<button type="button" class="ghost alert-action" data-metre-create-ouvrage="${index}">Créer l’ouvrage</button>`
                : "";
            return `<div class="alert ${alert.type === "danger" ? "danger" : ""}"><span>${esc(alert.message)}</span>${action}</div>`;
          })
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

  /*
   * Options du selecteur d'un poste de metre, limitees aux ouvrages dont l'unite est
   * compatible avec lui : chercher dans 52 entrees triees par nom n'aide pas a
   * choisir, cinq ou six si. L'ouvrage deja retenu reste toujours propose, meme s'il
   * ne passe plus le filtre (donnees anciennes).
   */
  const optionsParUnite = new Map();
  function ouvrageOptionsFor(row) {
    const cle = `${C.normalizeUnit(row.unite)}|${Number(row.quantite) === 1 ? "1" : "n"}|${row.ouvrageId || ""}`;
    const memo = optionsParUnite.get(cle);
    if (memo !== undefined) return memo;
    const html = state.ouvrages
      .filter((ouvrage) => ouvrage.id === row.ouvrageId || C.unitsCompatible(ouvrage.unite, row.unite, row.quantite))
      .sort((a, b) => a.nom.localeCompare(b.nom, "fr"))
      .map((ouvrage) => `<option value="${ouvrage.id}">${esc(ouvrage.nom)} (${esc(ouvrage.unite)})</option>`)
      .join("");
    optionsParUnite.set(cle, html);
    return html;
  }

  let ouvrageOptionsHtml = "";
  function renderOuvrageOptions() {
    optionsParUnite.clear();
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
    form.elements.formuleK.value = state.settings.formuleK === "multiplicative" ? "multiplicative" : "additive";
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
    $("#settings-k-formula").textContent =
      state.settings.formuleK === "multiplicative"
        ? `K = (1+${formatPercent(state.settings.fraisGeneraux)}) × (1+${formatPercent(state.settings.fraisChantier)}) × (1+${formatPercent(state.settings.imprevus)}) × (1+${formatPercent(state.settings.marge)})`
        : `K = 1 + ${number.format(C.coefficientPercent(state.settings))} / 100`;
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
      formuleK: data.formuleK === "multiplicative" ? "multiplicative" : "additive",
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

  // Le devis en cours d'edition. La liste n'est jamais vide (normalizeState garantit
  // au moins une entree), mais on retombe sur la premiere si l'id ne designe rien.
  function devisCourant() {
    return state.devisList.find((devis) => devis.id === state.devisCourantId) || state.devisList[0];
  }

  // Totaux lus sur les prix figes de chaque ligne, jamais recalcules : c'est le
  // montant qui a ete remis au client.
  const totauxDevis = (devis) => C.totauxDevis(devis);

  function calculateDevisTotals() {
    return totauxDevis(devisCourant());
  }

  // Prix de vente actuel d'un ouvrage, ou null s'il n'est plus dans la bibliotheque.
  function venteActuelle(ouvrageId) {
    const ouvrage = ouvrageById(ouvrageId);
    return ouvrage ? priceOf(ouvrage).vente : null;
  }

  // Fige une ligne au prix du jour : appele a l'ajout et a la modification d'une
  // ligne, jamais a l'affichage.
  function figerLigne(ligne) {
    const ouvrage = ouvrageById(ligne.ouvrageId);
    return C.figerLigneDevis(ligne, ouvrage, ouvrage ? priceOf(ouvrage) : null);
  }

  // Un devis fige est le document remis au client : il ne se modifie plus.
  function refuserSiFige(devis) {
    if (devis.statut !== "fige") return false;
    notify(
      `Le devis « ${devis.numero} » est figé : son montant est celui remis au client. ` +
        "Dupliquez-le pour établir une révision, ou rouvrez-le en brouillon.",
      "danger",
    );
    return true;
  }

  function renderDevis() {
    const devis = devisCourant();
    const meta = $("#devis-meta-form");
    meta.elements.numero.value = devis.numero;
    meta.elements.date.value = devis.date;
    meta.elements.client.value = devis.client;
    meta.elements.adresse.value = devis.adresse;
    meta.elements.objet.value = devis.objet;
    meta.elements.tva.value = devis.tva;
    updateDevisMetaMode();

    // Liste : chaque devis garde son numero, sa date et son montant. Un nouveau devis
    // n'ecrase plus le precedent, contrairement au modele a un seul devis d'origine.
    $("#devis-list").innerHTML = [...state.devisList]
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.numero).localeCompare(String(a.numero)))
      .map((item) => {
        const courant = item.id === devis.id;
        const totaux = totauxDevis(item);
        return `<li class="${courant ? "courant" : ""}">
          <span class="devis-resume">
            <strong>${esc(item.numero || "sans numéro")}${item.client ? ` · ${esc(item.client)}` : ""}</strong>
            <small>${item.date ? new Date(`${item.date}T00:00:00`).toLocaleDateString("fr-BE") : "sans date"} · ${
              item.lignes.length
            } ligne(s) · ${euro.format(totaux.ttc)} TVAC${courant ? " · en cours" : ""}</small>
          </span>
          <span class="devis-actions">
            ${courant ? "" : `<button type="button" class="ghost" data-devis-ouvrir="${item.id}">Ouvrir</button>`}
            <button type="button" class="ghost" data-devis-dupliquer="${item.id}">Dupliquer</button>
            ${
              state.devisList.length > 1
                ? `<button type="button" class="ghost danger" data-devis-supprimer="${item.id}">Supprimer</button>`
                : ""
            }
          </span>
        </li>`;
      })
      .join("");

    // Statut, réglages figés et écart avec la bibliothèque d'aujourd'hui.
    const fige = devis.statut === "fige";
    const badge = $("#devis-statut");
    badge.textContent = fige ? "figé" : "brouillon";
    badge.className = `statut${fige ? " fige" : ""}`;
    $("#figer-devis").textContent = fige ? "Rouvrir en brouillon" : "Figer le devis";
    const contexte = devis.contexte || {};
    $("#devis-contexte").textContent = devis.lignes.length
      ? `Prix arrêtés avec : coût horaire ${euro.format(contexte.coutHoraire || 0)}, K ${number.format(
          contexte.coefficientK || 0,
        )} (${contexte.formuleK === "multiplicative" ? "multiplicative" : "additive"}), TVA ${number.format(devis.tva)} %.`
      : "";

    const ecarts = C.ecartsDevis(devis, venteActuelle);
    const parLigne = new Map(ecarts.lignes.map((ligne) => [ligne.id, ligne]));
    const zoneEcart = $("#devis-ecart");
    // Un devis figé ne propose pas d'actualisation : c'est justement ce qu'on lui
    // interdit. L'information reste affichée, sans le bouton.
    zoneEcart.hidden = !ecarts.nbModifiees;
    if (ecarts.nbModifiees) {
      const signe = ecarts.ecartTotal > 0 ? "+" : "";
      $("#devis-ecart-texte").textContent = fige
        ? `${ecarts.nbModifiees} ligne(s) ne valent plus le même prix dans la bibliothèque d’aujourd’hui (${signe}${euro.format(
            ecarts.ecartTotal,
          )}). Ce devis reste au montant remis au client.`
        : `${ecarts.nbModifiees} ligne(s) ont changé de prix dans la bibliothèque depuis leur ajout (${signe}${euro.format(
            ecarts.ecartTotal,
          )} sur le total).`;
      $("#actualiser-devis").hidden = fige;
    }

    const orphan = devis.lignes.filter((ligne) => !ouvrageById(ligne.ouvrageId)).length;
    $("#devis-lines").innerHTML = devis.lignes.length
      ? devis.lignes
          .map((ligne) => {
            // Le libellé, l'unité et le prix viennent de la ligne, pas de la
            // bibliothèque : un ouvrage renommé, repricé ou supprimé depuis ne change
            // plus un devis déjà établi.
            const ecart = parLigne.get(ligne.id) || {};
            const notes = [];
            if (ecart.introuvable) notes.push(`<small class="ligne-note">ouvrage retiré de la bibliothèque</small>`);
            const derive =
              !ecart.introuvable && ecart.puActuel !== undefined && ecart.puActuel !== ligne.puHtva
                ? `<small class="prix-actuel">aujourd’hui ${euro.format(ecart.puActuel)}</small>`
                : "";
            return `<tr>
              <td>${esc(ligne.nom)}${notes.join("")}</td>
              <td>${number.format(ligne.quantite)} ${esc(ligne.unite)}</td>
              <td>${euro.format(ligne.puHtva)}${derive}</td>
              <td>${euro.format(C.roundMoney(ligne.puHtva * ligne.quantite))}</td>
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
    ["numero", "date", "client", "adresse", "objet", "tva"].forEach((field) => {
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

  /*
   * Prix unitaire d'un poste. Un metre rouvert depuis l'historique est fige : son
   * montant est celui du jour ou il a ete rendu au pouvoir adjudicateur. Le rouvrir
   * trois mois plus tard, apres un changement de prix matiere, ne doit pas afficher
   * — ni reexporter — d'autres montants que ceux remis.
   */
  function metreRowPu(row) {
    if (state.metre.fige) return Number(row.puHtva) || 0;
    const ouvrage = ouvrageById(row.ouvrageId);
    return ouvrage ? priceOf(ouvrage).vente : 0;
  }

  function metreRowPrice(row) {
    if (row.unitWarning) return 0;
    if (state.metre.fige) return metreRowPu(row) * (Number(row.quantite) || 0);
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
      .filter((row) => row.unitWarning || (!row.pourMemoire && (!row.ouvrageId || !row.quantiteOk)))
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

    // Value fixee ici, jamais depuis le handler "input" du meme champ : sinon la
    // frappe se ferait resauter le curseur a chaque caractere (cf. #ouvrage-search).
    const communeInput = $("#metre-commune");
    if (communeInput && document.activeElement !== communeInput) communeInput.value = state.metre.commune || "";
    const communeAlerte = $("#metre-commune-alerte");
    if (communeAlerte) {
      const divergente = communeDivergente();
      communeAlerte.hidden = !divergente;
      if (divergente) {
        communeAlerte.textContent = `Analyse faite pour « ${
          state.metre.analysedCommune || "aucune commune"
        } » : relancez l’analyse pour appliquer cette commune. Les confirmations restent mémorisées pour l’ancienne.`;
      }
    }
    $("#metre-communes-connues").innerHTML = Object.keys(state.mappingCommunes)
      .sort((a, b) => a.localeCompare(b, "fr"))
      .map((commune) => `<option value="${esc(commune)}"></option>`)
      .join("");

    $("#metre-status").innerHTML = state.metre.fileName
      ? `<strong>${esc(state.metre.fileName)}</strong> — ${state.metre.rows.length} poste(s) lu(s)${
          state.metre.skipped ? `, ${state.metre.skipped} ligne(s) ignorée(s)` : ""
        }${analysed.length ? ` · ${chiffres}/${analysed.length} chiffré(s) · total ${euro.format(total)}` : ""}${
          sourceArrayBuffer && sourceFileName === state.metre.fileName
            ? ""
            : `<br /><em>Classeur d’origine non disponible : réimportez le fichier pour le compléter.</em>`
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
            // Une seule couleur par ligne : rouge quand rien n'est chiffrable en
            // l'etat, ambre quand seule la quantite manque, rien pour un poste
            // "pour memoire". L'etat lui-meme est defini dans core.metreRowStatus.
            const statut = C.metreRowStatus(row, Boolean(ouvrageById(row.ouvrageId)));
            const classe =
              statut === "unite-incompatible" || statut === "ouvrage-manquant"
                ? "row-missing"
                : statut === "quantite-manquante"
                  ? "row-warning"
                  : "";
            return `<tr class="${classe}">
              <td data-label="Poste" class="compact">${esc(row.numero)}</td>
              <td data-label="Désignation">${esc(row.description)}</td>
              <td data-label="Unité" class="compact">${esc(row.unite)}${
                row.unitWarning
                  ? ` <button type="button" class="flag" data-metre-flag-row="${index}" data-metre-flag-kind="unite" aria-expanded="false" aria-label="Détail de l’incompatibilité d’unité">!</button>`
                  : ""
              }</td>
              <td data-label="Quantité" class="compact">${
                row.quantiteOk
                  ? number.format(row.quantite)
                  : row.pourMemoire
                    ? "—"
                    : `<button type="button" class="flag warn" data-metre-flag-row="${index}" data-metre-flag-kind="quantite" aria-expanded="false" aria-label="Détail sur la quantité manquante">?</button>`
              }</td>
              <td data-label="Ouvrage"><select data-metre-match="${index}" aria-label="Ouvrage pour le poste ${esc(row.numero)}"><option value="">— aucun ouvrage —</option>${ouvrageOptionsFor(row)}</select></td>
              <td data-label="Confiance">${matchBadge(row, index)}</td>
              <td data-label="Montant" class="compact">${prix ? euro.format(prix) : "-"}</td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="7" class="empty">Aucun métré analysé.</td></tr>`;

    // Selection appliquee apres coup : les options sont construites par unite, pas
    // par ligne, donc l'ouvrage retenu doit etre repose ici.
    document.querySelectorAll("#metre-lines select[data-metre-match]").forEach((select) => {
      select.value = analysed[Number(select.dataset.metreMatch)]?.ouvrageId || "";
    });

    // Resume visible sur le bloc replie : on doit savoir ce qui est charge sans
    // avoir a le rouvrir.
    const etatSetup = $("#metre-setup-state");
    if (etatSetup) {
      etatSetup.textContent = !state.metre.fileName
        ? "Aucun métré chargé"
        : analysed.length
          ? `${state.metre.fileName} · ${analysed.length} poste(s) analysé(s)`
          : `${state.metre.fileName} · ${state.metre.rows.length} poste(s) lu(s), analyse à lancer`;
    }

    const bandeauFige = $("#metre-fige");
    if (bandeauFige) {
      bandeauFige.hidden = !(state.metre.fige && analysed.length);
      if (!bandeauFige.hidden) {
        const contexte = state.metre.contexte || {};
        $("#metre-fige-texte").textContent =
          `Métré rouvert depuis l’historique : les montants sont ceux du jour où il a été rendu` +
          `${contexte.coutHoraire ? ` (coût horaire ${euro.format(contexte.coutHoraire)}, K ${number.format(contexte.coefficientK || 0)})` : ""}, ` +
          "pas ceux de la bibliothèque d’aujourd’hui.";
      }
    }

    const blocArchives = $("#metre-archives-bloc");
    if (blocArchives) {
      blocArchives.hidden = !metreArchives.length;
      $("#metre-archives").innerHTML = metreArchives
        .map((archive) => {
          const courant = archive.id === state.metre.id;
          const resume = archive.resume || {};
          return `<li class="${courant ? "courant" : ""}">
            <span class="archive-nom">
              <strong>${esc(archive.fileName || "Métré")}</strong>
              <small>${esc(archive.commune || "sans commune")} · ${new Date(archive.date).toLocaleDateString("fr-BE")} · ${
                resume.chiffres ?? 0
              }/${resume.postes ?? 0} chiffré(s) · ${euro.format(resume.total || 0)}${courant ? " · en cours" : ""}</small>
            </span>
            <span class="archive-actions">
              ${courant ? "" : `<button type="button" class="ghost" data-metre-rouvrir="${esc(archive.id)}">Rouvrir</button>`}
              <button type="button" class="ghost danger" data-metre-supprimer-archive="${esc(archive.id)}">Retirer</button>
            </span>
          </li>`;
        })
        .join("");
    }

    // Le nombre de propositions dit d'un coup d'oeil s'il reste quelque chose a
    // confirmer, sans ouvrir la boite de dialogue.
    const boutonConfirmer = $("#confirm-matches");
    if (boutonConfirmer) {
      const propositions = analysed.filter((row) => row.ouvrageId && !row.manual).length;
      boutonConfirmer.textContent = propositions
        ? `Confirmer et mémoriser (${propositions})`
        : "Confirmer et mémoriser";
    }
  }

  function flagMessage(row, kind) {
    if (kind === "quantite") {
      return (
        `Quantité absente ou nulle dans le fichier importé pour le poste « ${row.numero} ». Ce poste ne peut pas ` +
        "être chiffré tant qu’une quantité n’est pas renseignée : corrigez le fichier source (ou obtenez la " +
        "quantité manquante) puis réimportez-le."
      );
    }
    const suggestion = ouvrageById(row.suggestionId || row.ouvrageId);
    if (suggestion && (C.isForfaitUnit(suggestion.unite) || C.isForfaitUnit(row.unite))) {
      return (
        `Forfait contre quantité : le poste « ${row.numero} » est en « ${row.unite || "?"} » × ` +
        `${number.format(row.quantite)}, l’ouvrage le plus proche (« ${suggestion.nom} ») est un forfait ` +
        `(${suggestion.unite}). Un prix global ne se multiplie pas par une quantité : créez un ouvrage à l’unité ` +
        "du poste, ou, si c’est bien un forfait, ramenez la quantité à 1 dans le fichier."
      );
    }
    if (suggestion) {
      return (
        `Unité incompatible : le poste « ${row.numero} » est en « ${row.unite || "?"} », l’ouvrage le plus proche ` +
        `(« ${suggestion.nom} ») est en « ${suggestion.unite} ». Une quantité en ${row.unite || "?"} ne peut pas ` +
        `être chiffrée avec un prix au ${suggestion.unite} : choisissez un ouvrage dont l’unité correspond, ou ` +
        "créez-en un nouveau dans la bibliothèque."
      );
    }
    return `Unité « ${row.unite || "?"} » du poste « ${row.numero} » incompatible avec l’ouvrage retenu.`;
  }

  /*
   * Ouvre l'explication d'un drapeau juste sous sa ligne, et la referme au clic
   * suivant. Elle etait envoyee au message general, ancre en haut de la page : sur
   * telephone il s'affichait plus de 3 000 px au-dessus du poste concerne, donc
   * cliquer sur « ! » ne montrait rien. Ici elle reste sous les yeux le temps de
   * corriger. Une seule ouverte a la fois.
   */
  function toggleFlagDetail(bouton, index, kind) {
    const row = state.metre.analysed[index];
    const ligne = bouton.closest("tr");
    if (!row || !ligne) return;
    const suivante = ligne.nextElementSibling;
    const dejaOuverte = suivante && suivante.classList.contains("flag-detail-row");
    document.querySelectorAll("#metre-lines tr.flag-detail-row").forEach((element) => element.remove());
    document
      .querySelectorAll('#metre-lines .flag[aria-expanded="true"]')
      .forEach((element) => element.setAttribute("aria-expanded", "false"));
    if (dejaOuverte) return;

    const detail = document.createElement("tr");
    detail.className = kind === "unite" ? "flag-detail-row danger" : "flag-detail-row";
    const cellule = document.createElement("td");
    cellule.colSpan = 7;
    cellule.textContent = flagMessage(row, kind);
    detail.append(cellule);
    ligne.after(detail);
    bouton.setAttribute("aria-expanded", "true");
  }

  // Applique l'ouvrage que l'analyse a designe comme le plus proche.
  function applySuggestion(index) {
    const row = state.metre.analysed[index];
    if (!row) return;
    const ouvrage = ouvrageById(row.suggestionId || row.ouvrageId);
    if (!ouvrage) return;
    if (!C.unitsCompatible(ouvrage.unite, row.unite, row.quantite)) {
      notify(`« ${ouvrage.nom} » (${ouvrage.unite}) ne peut pas chiffrer ce poste.`, "danger");
      return;
    }
    confirmerLigne(row, ouvrage);
    saveState();
    render();
    notify(`Poste « ${row.numero} » rattaché à « ${ouvrage.nom} » et mémorisé.`, "info");
  }

  function matchBadge(row, index) {
    // Un poste "pour memoire"/"hors marche" sans ouvrage rattache n'est pas une
    // anomalie a traiter : c'est le statut normal de ce type de poste.
    if (row.pourMemoire && !row.ouvrageId && !row.unitWarning) {
      return `<span class="match memo">pour mémoire</span>`;
    }
    // row.unitWarning avec un ouvrageId encore renseigne : forme laissee par une
    // session sauvegardee avant le garde-fou sur l'unite. Ne jamais l'afficher comme
    // une correspondance valable, quelle que soit sa confiance mémorisée.
    if (!row.ouvrageId || row.unitWarning) {
      const suggestion = ouvrageById(row.suggestionId || row.ouvrageId);
      const blocs = [`<span class="match none">à traiter</span>`];
      if (suggestion && C.unitsCompatible(suggestion.unite, row.unite, row.quantite)) {
        // L'app a deja identifie le plus proche : un clic doit suffire a l'appliquer,
        // au lieu d'aller le rechercher a la main dans la liste.
        blocs.push(
          `<button type="button" class="ghost apply-suggestion" data-metre-apply="${index}">Utiliser « ${esc(suggestion.nom)} »</button>`,
        );
      } else if (suggestion) {
        blocs.push(`<small>proche : ${esc(suggestion.nom)} (${esc(suggestion.unite)}), unité incompatible</small>`);
      }
      if (!row.pourMemoire) {
        blocs.push(
          `<button type="button" class="ghost create-ouvrage" data-metre-create-ouvrage="${index}">Créer un ouvrage à partir de ce poste</button>`,
        );
      }
      return blocs.join("");
    }
    // Vert : la correspondance est certaine (code memorise ou confirmation manuelle).
    // Ambre : proposition d'apres le libelle, a verifier. C'est ce que dit la legende
    // au-dessus du tableau — un pourcentage seul n'apprenait rien a personne.
    return row.confidence >= 0.99
      ? `<span class="match high">${esc(row.reason || "confirmé")}</span>`
      : `<span class="match medium">libellé ${percent.format(row.confidence)}</span>`;
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
    // headerFor et non findHeader : les selects doivent proposer exactement la colonne
    // que l'analyse retiendra, exclusions comprises.
    [
      ["#map-poste", "poste"],
      ["#map-description", "description"],
      ["#map-unite", "unite"],
      ["#map-quantite", "quantite"],
      ["#map-prix", "prixUnitaire"],
    ].forEach(([selector, cle]) => {
      const select = $(selector);
      select.innerHTML = html;
      select.value = C.headerFor(list, cle) || "";
    });
  }

  function analyseMetre() {
    if (!state.metre.rows.length) {
      notify("Chargez d’abord un métré.", "danger");
      return;
    }
    const commune = String(state.metre.commune || "").trim();
    if (!commune) {
      // Sans commune, les codes du catalogue de depart s'appliqueraient comme des
      // certitudes a 100 % : c'est l'origine de l'affaire « 09.04 », ou un poste bien
      // reel disparaissait derriere un ouvrage sans rapport. Chaque marche construit
      // desormais sa propre codification.
      const setup = $("#metre-setup");
      if (setup) setup.open = true;
      const champ = $("#metre-commune");
      champ?.focus();
      champ?.scrollIntoView({ behavior: "smooth", block: "center" });
      notify(
        "Indiquez la commune ou le pouvoir adjudicateur avant d’analyser : les codes de métré appris lui restent propres.",
        "danger",
      );
      return;
    }
    const mapping = mappingSelectors();
    state.metre.mapping = mapping;

    // Objet (meme vide) des qu'une commune est renseignee : signale a findMatch()
    // qu'aucun retour au refsMetre global n'est autorise pour cet import, meme si
    // cette commune n'a encore aucun code appris.
    const communeCodes = commune ? state.mappingCommunes[C.resolveCommuneKey(state.mappingCommunes, commune)] || {} : null;
    state.metre.analysedCommune = commune;

    const { analysed, alerts } = C.analyseRows(state.metre.rows, mapping, state.ouvrages, communeCodes);
    state.metre.analysed = analysed;
    // Une analyse repart des prix du jour : elle n'est plus une photographie.
    state.metre.fige = false;
    state.metre.contexte = C.contextePrix(state.settings);
    state.metre.alerts = alerts;
    saveState();
    render();
    // Le reglage a fait son travail : on replie, c'est le tableau qu'on corrige
    // ensuite — sur telephone il commencait sinon a plus d'un ecran de defilement.
    const setup = $("#metre-setup");
    if (setup) setup.open = false;
    $(".metre-table")?.scrollIntoView({ behavior: "smooth", block: "start" });
    const chiffres = state.metre.analysed.filter((row) => row.ouvrageId).length;
    notify(`${chiffres} poste(s) sur ${state.metre.analysed.length} rapproché(s) automatiquement.`, "info");
  }

  // Vrai quand le champ commune ne correspond plus a la commune de la derniere analyse
  // (comparaison insensible a la casse/aux accents). Sans analyse, rien a comparer.
  function communeDivergente() {
    if (!state.metre.analysed.length) return false;
    return C.normalizeText(state.metre.commune || "") !== C.normalizeText(state.metre.analysedCommune || "");
  }

  // Enregistre la correspondance choisie : elle sera reconnue au prochain marche.
  // La regle (commune de l'analyse, un code pour un seul ouvrage) est dans core.js.
  const learnMatch = (row) => C.memoriserCode(state, row);

  // Seuil a partir duquel un ouvrage existant est propose avant d'en creer un nouveau.
  const SIMILARITE_OUVRAGE_SEUIL = 0.55;

  /*
   * Ce qui separe l'ouvrage saisi de celui qui existe deja, signal par signal puis
   * matiere par matiere. Presente en tableau : le detail d'une composition sur dix
   * lignes n'etait pas lisible dans un dialogue natif.
   */
  function proximiteOuvrageHtml(payload, match) {
    const pct = (valeur) => (valeur === null || valeur === undefined ? "—" : `${Math.round(valeur * 100)} %`);
    const d = match.detail;
    const signaux = [
      ["Libellé", d.textScore],
      ["Composition", d.composantScore],
      ["Rendement", d.rendementScore],
      ["Matériel", d.materielScore],
    ];

    const existant = new Map((match.ouvrage.composants || []).map((c) => [c.materiauId, c.quantite]));
    const saisi = new Map((payload.composants || []).map((c) => [c.materiauId, c.quantite]));
    const tousMateriaux = [...new Set([...existant.keys(), ...saisi.keys()])];
    const lignes = tousMateriaux.map((id) => {
      const a = existant.has(id) ? number.format(existant.get(id)) : "—";
      const b = saisi.has(id) ? number.format(saisi.get(id)) : "—";
      return [materialById(id)?.nom || "matériau inconnu", a, b];
    });
    lignes.push([`Main-d’œuvre (h/${payload.unite || "unité"})`, number.format(match.ouvrage.heures), number.format(payload.heures)]);
    lignes.push(["Matériel", euro.format(match.ouvrage.materiel), euro.format(payload.materiel)]);

    return `
      <p>Un ouvrage proche existe déjà : <strong>${esc(match.ouvrage.nom)}</strong> (${esc(match.ouvrage.poste)}).
      Proximité globale <strong>${pct(match.score)}</strong>.</p>
      <table>
        <thead><tr><th>Signal</th><th class="num">Proximité</th></tr></thead>
        <tbody>${signaux.map(([nom, valeur]) => `<tr><td>${nom}</td><td class="num">${pct(valeur)}</td></tr>`).join("")}</tbody>
      </table>
      <table>
        <thead><tr><th>Composition</th><th class="num">Existant</th><th class="num">Saisi</th></tr></thead>
        <tbody>${lignes
          .map(
            ([nom, a, b]) =>
              `<tr class="${a === b ? "" : "change"}"><td>${esc(nom)}</td><td class="num">${esc(a)}</td><td class="num">${esc(b)}</td></tr>`,
          )
          .join("")}</tbody>
      </table>`;
  }

  // Rattache le poste de metre a l'origine de "Créer un ouvrage à partir de ce poste"
  // a l'ouvrage effectivement sauvegarde (nouveau, modifie, ou existant reutilise).
  // Retourne { status, row } : "aucun" (pas de poste en attente ou poste disparu),
  // "autreMetre" / "autrePoste" (le poste vise n'est plus celui d'origine),
  // "unite" (rattachement refuse : unites incompatibles) ou "ok". L'appelant
  // s'en sert pour dire la verite dans le toast — un poste promis "rattache
  // automatiquement" qui ne l'est pas doit etre signale, pas passe sous silence.
  function linkCreatedOuvrageToMetreRow(ouvrageId) {
    const attente = posteEnAttente;
    posteEnAttente = null;
    const cible = C.resoudrePosteEnAttente(attente, state.metre);
    if (cible.status !== "ok") return { status: cible.status, row: null, numero: cible.numero || "" };
    const row = cible.row;
    const ouvrage = ouvrageById(ouvrageId);
    if (!ouvrage) return { status: "aucun", row };
    if (!C.unitsCompatible(ouvrage.unite, row.unite, row.quantite)) return { status: "unite", row, ouvrage };
    confirmerLigne(row, ouvrage);
    return { status: "ok", row, ouvrage };
  }

  // Un seul endroit ou une ligne devient une correspondance confirmee : choix
  // manuel, suggestion appliquee ou rattachement apres creation d'un ouvrage.
  function confirmerLigne(row, ouvrage) {
    row.ouvrageId = ouvrage.id;
    row.manual = true;
    row.confidence = 1;
    row.reason = "confirmé";
    row.suggestionId = "";
    row.unitWarning = false;
    learnMatch(row);
  }

  // « Rattaché automatiquement » a ete promis a l'utilisateur : si le poste vise
  // n'existe plus dans le metre affiche, il faut le dire, pas rattacher au hasard.
  function messageRattachementPerdu(lien) {
    const poste = lien.numero ? `« ${lien.numero} » ` : "";
    return lien.status === "autreMetre"
      ? `le poste ${poste}appartenait à un autre métré : rattachement annulé.`
      : `le poste ${poste}n’est plus au même rang dans le métré : rattachement annulé.`;
  }

  function messageRattachementUnite(lien) {
    return (
      `Le poste « ${lien.row.numero} » (${lien.row.unite || "unité ?"}) n’a pas été rattaché : ` +
      `l’ouvrage est en « ${lien.ouvrage.unite} », unité incompatible. Rattachez-le manuellement dans le métré.`
    );
  }

  /* --------------------------------------------------------------- historique */

  /*
   * Le metre en cours est tenu a jour dans l'historique (IndexedDB), pas seulement
   * archive au moment de le quitter : une page fermee par accident ne doit rien
   * couter. saveState() planifie l'ecriture, groupee pour ne pas recopier les lignes
   * a chaque frappe.
   */
  let archivageTimer = 0;
  function planifierArchivage() {
    if (!state.metre.id || !state.metre.analysed.length) return;
    clearTimeout(archivageTimer);
    archivageTimer = setTimeout(archiverMetreCourant, 1500);
  }

  async function archiverMetreCourant() {
    if (!state.metre.id || !state.metre.analysed.length) return;
    const entree = {
      id: state.metre.id,
      fileName: state.metre.fileName,
      commune: state.metre.analysedCommune || state.metre.commune || "",
      date: Date.now(),
      resume: C.resumeMetre(state.metre, metreRowPrice),
      // Copie : l'etat continue de vivre apres l'archivage, l'archive doit rester
      // celle du moment ou elle a ete ecrite — prix compris, d'ou le puHtva pose sur
      // chaque ligne. Sans lui, rouvrir un metre rendu en septembre l'afficherait aux
      // prix de decembre.
      metre: {
        ...JSON.parse(JSON.stringify(state.metre)),
        contexte: state.metre.contexte || C.contextePrix(state.settings),
        analysed: state.metre.analysed.map((row) => ({ ...row, puHtva: C.roundMoney(metreRowPu(row)) })),
      },
      source: sourceArrayBuffer || null,
    };
    if (!(await DGStore.saveArchive(entree))) return;
    metreArchives = await DGStore.listArchives();
    renderMetre();
  }

  // Rouvre un metre archive : lignes, analyse, colonnes et fichier recu.
  async function rouvrirMetre(id) {
    const archive = await DGStore.loadArchive(id);
    if (!archive || !archive.metre) {
      notify("Ce métré n’est plus disponible dans l’historique.", "danger");
      return;
    }
    await archiverMetreCourant();
    state.metre = normalizeState({ ...state, metre: archive.metre }).metre;
    // Un metre rouvert est une photographie : montants et export restent ceux rendus.
    state.metre.fige = true;
    sourceArrayBuffer = archive.source || null;
    sourceFileName = sourceArrayBuffer ? archive.fileName || "" : "";
    await DGStore.saveSource(state.metre.id, sourceFileName, sourceArrayBuffer);
    populateFieldMap(Object.keys(state.metre.rows[0] || {}));
    appliquerMappingAuxSelects();
    saveState();
    render();
    goToView("metre");
    const setup = $("#metre-setup");
    if (setup) setup.open = false;
    notify(
      `Métré « ${archive.fileName} » rouvert${sourceArrayBuffer ? "" : " — le fichier d’origine n’a pas été retrouvé"}.`,
      sourceArrayBuffer ? "info" : "warning",
    );
  }

  async function supprimerArchive(id) {
    const archive = metreArchives.find((entree) => entree.id === id);
    if (!window.confirm(`Retirer « ${archive?.fileName || "ce métré"} » de l’historique ?`)) return;
    await DGStore.deleteArchive(id);
    metreArchives = await DGStore.listArchives();
    renderMetre();
  }

  // Colonnes choisies : reposees sur les selecteurs apres un import ou une reouverture.
  function appliquerMappingAuxSelects() {
    const mapping = state.metre.mapping || {};
    Object.entries({
      "#map-poste": mapping.poste,
      "#map-description": mapping.description,
      "#map-unite": mapping.unite,
      "#map-quantite": mapping.quantite,
      "#map-prix": mapping.prixUnitaire,
    }).forEach(([selecteur, valeur]) => {
      const select = $(selecteur);
      if (select && valeur) select.value = valeur;
    });
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

  // Plage d'une feuille ramenee a l'origine A1 (voir l'import du metre).
  function rangeFromA1(sheet) {
    const ref = sheet && sheet["!ref"];
    if (!ref) return undefined;
    const range = XLSX.utils.decode_range(ref);
    range.s.r = 0;
    range.s.c = 0;
    return XLSX.utils.encode_range(range);
  }

  function requireXlsx() {
    if (globalThis.XLSX) return true;
    notify("La bibliothèque XLSX n’est pas chargée (connexion internet requise au premier lancement).", "danger");
    return false;
  }

  /*
   * Ecrit les prix unitaires dans le classeur recu et le renvoie : feuilles,
   * formules, fusions de cellules, largeurs de colonnes, sous-totaux et
   * recapitulatif sont conserves. Pas la mise en forme (polices, fonds, bordures) :
   * l'edition communautaire de SheetJS ne la reecrit pas — c'est dit a l'utilisateur.
   *
   * Reparti a chaque export depuis les octets d'origine (sourceArrayBuffer),
   * jamais depuis un classeur deja modifie : sinon un prix ecrit lors d'un export
   * precedent restait dans le fichier meme apres que l'utilisateur ait retire le
   * rapprochement correspondant (le poste etait simplement ignore, pas efface).
   */
  function exportMetreSource() {
    if (!requireXlsx()) return;
    // Le classeur en memoire doit etre CELUI du metre affiche : apres un import JSON
    // (autre marche, meme session), les coordonnees de l'analyse n'ont aucun sens
    // dans l'ancien fichier — les prix y seraient ecrits n'importe ou.
    if (!sourceArrayBuffer || sourceFileName !== state.metre.fileName) {
      notify(`Réimportez le fichier « ${state.metre.fileName || "du métré"} » pour pouvoir le compléter.`, "danger");
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
      sheet[address] = { t: "n", v: C.roundMoney(metreRowPu(row)), z: "#,##0.00" };
      written += 1;
    });

    if (!written) {
      notify("Aucun prix à reporter : rapprochez d’abord les postes.", "danger");
      return;
    }
    const base = sourceFileName.replace(/\.(xlsx|xlsm|xls)$/i, "") || "metre";
    XLSX.writeFile(workbook, `${base}-chiffre.xlsx`);
    notify(
      `${written} prix reporté(s) dans le fichier d’origine${skipped ? `, ${skipped} poste(s) laissé(s) vide(s)` : ""}. ` +
        "Formules et fusions conservées ; polices, fonds et bordures du fichier d’origine ne le sont pas.",
      "info",
    );
  }

  function metreRecapRows() {
    return {
      parametres: [
        ["Entreprise", state.entrepreneur.nom],
        ["N° TVA", state.entrepreneur.numeroTva],
        ["Coefficient K", C.coefficientK(state.settings)],
        ["Formule K", state.settings.formuleK === "multiplicative" ? "multiplicative" : "additive"],
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
            utilisable ? C.roundMoney(metreRowPu(row)) : "",
            C.roundMoney(metreRowPrice(row)),
            C.METRE_STATUS_LABELS[C.metreRowStatus(row, Boolean(ouvrage))],
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

  // Un nom de fichier par devis : trois devis exportes ne doivent pas se recouvrir
  // dans le dossier de telechargement.
  function nomFichierDevis(extension) {
    const numero = (devisCourant().numero || "sans-numero").replace(/[^\w.-]+/g, "-");
    return `devis-${numero}.${extension}`;
  }

  function devisRows() {
    const totals = calculateDevisTotals();
    return [
      [state.entrepreneur.nom || "Devis"],
      [state.entrepreneur.adresse],
      [state.entrepreneur.numeroTva ? `TVA ${state.entrepreneur.numeroTva}` : ""],
      [],
      ["Devis", devisCourant().numero],
      ["Date", devisCourant().date],
      ["Statut", devisCourant().statut === "fige" ? "Figé" : "Brouillon"],
      ["Client", devisCourant().client],
      ["Adresse du chantier", devisCourant().adresse],
      ["Objet", devisCourant().objet],
      [],
      // Les prix exportes sont ceux figes sur chaque ligne, pas ceux de la
      // bibliotheque au moment de l'export : c'est le meme document a chaque fois.
      ["Ouvrage", "Unité", "Quantité", "PU HTVA", "Total HTVA"],
      ...devisCourant().lignes.map((ligne) => [
        ligne.nom,
        ligne.unite,
        ligne.quantite,
        ligne.puHtva,
        C.roundMoney(ligne.puHtva * ligne.quantite),
      ]),
      [],
      ["Total HTVA", "", "", "", C.roundMoney(totals.ht)],
      [`TVA ${number.format(devisCourant().tva)} %`, "", "", "", C.roundMoney(totals.tva)],
      ["Total TVAC", "", "", "", C.roundMoney(totals.ttc)],
      [],
      ["Prix arrêtés avec"],
      ["Coût horaire", C.roundMoney(devisCourant().contexte?.coutHoraire || 0)],
      ["Coefficient K", devisCourant().contexte?.coefficientK || 0],
      ["Formule K", devisCourant().contexte?.formuleK === "multiplicative" ? "multiplicative" : "additive"],
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
    // Sur telephone la navigation occupe tout le premier ecran : sans ceci, changer
    // de vue laissait l'utilisateur devant le meme menu.
    window.scrollTo({ top: 0 });
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

  $("#ouvrage-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formulaire = event.currentTarget;
    const data = Object.fromEntries(new FormData(formulaire));
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

    // Avant de creer un ouvrage (pas en modification), on verifie qu'il n'existe pas
    // deja quelque chose de tres proche : sinon deux communes avec des libelles
    // legerement differents pour le meme ouvrage finissent en quasi-doublons.
    if (!editingOuvrageId) {
      const match = C.bestOuvrageMatch(payload, state.ouvrages);
      if (match && match.score >= SIMILARITE_OUVRAGE_SEUIL) {
        const reutiliser = await askDialog({
          titre: "Un ouvrage très proche existe déjà",
          corpsHtml: proximiteOuvrageHtml(payload, match),
          corpsTexte: `« ${match.ouvrage.nom} » — proximité ${Math.round(match.score * 100)} %.`,
          ok: "Utiliser l’existant",
          annuler: "Créer quand même",
        });
        if (reutiliser) {
          // Le libelle de cette commune (et ses mots cles) enrichissent l'ouvrage
          // conserve : la prochaine fois que cette formulation revient — autre lot,
          // code different — le rapprochement par libelle la reconnaitra d'emblee.
          match.ouvrage.motsCles = C.normalizeKeywords([match.ouvrage.motsCles, payload.motsCles, payload.nom]);
          const lien = linkCreatedOuvrageToMetreRow(match.ouvrage.id);
          formulaire.reset();
          setComposantRows([]);
          updateEditForms();
          saveState();
          render();
          if (lien.status === "unite") {
            notify(`Ouvrage existant conservé : « ${match.ouvrage.nom} ». ${messageRattachementUnite(lien)}`, "danger");
          } else if (lien.status === "autreMetre" || lien.status === "autrePoste") {
            notify(`Ouvrage existant conservé : « ${match.ouvrage.nom} », mais ${messageRattachementPerdu(lien)}`, "danger");
          } else {
            notify(
              lien.status === "ok"
                ? `Poste « ${lien.row.numero} » rattaché à l’ouvrage existant « ${match.ouvrage.nom} ». Rien de nouveau créé.`
                : `Ouvrage existant conservé : « ${match.ouvrage.nom} ». Rien de nouveau créé.`,
              "info",
            );
          }
          return;
        }
      }
    }

    let savedId;
    if (editingOuvrageId) {
      const ouvrage = ouvrageById(editingOuvrageId);
      if (ouvrage) Object.assign(ouvrage, payload);
      savedId = editingOuvrageId;
      editingOuvrageId = "";
    } else {
      const usedCodes = new Set(state.ouvrages.map((ouvrage) => ouvrage.poste));
      savedId = uid();
      state.ouvrages.push({ id: savedId, poste: C.nextInternalCode(usedCodes, payload.nom), ...payload });
    }
    const lien = linkCreatedOuvrageToMetreRow(savedId);
    formulaire.reset();
    setComposantRows([]);
    updateEditForms();
    saveState();
    render();
    if (lien.status === "unite") {
      notify(`Ouvrage enregistré, mais ${messageRattachementUnite(lien)}`, "danger");
    } else if (lien.status === "autreMetre" || lien.status === "autrePoste") {
      notify(`Ouvrage enregistré, mais ${messageRattachementPerdu(lien)}`, "danger");
    } else if (lien.status === "ok") {
      notify(`Ouvrage enregistré et rattaché au poste « ${lien.row.numero} ».`, "info");
    } else {
      notify("Ouvrage enregistré.", "info");
    }
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
    if (
      event.target.type === "range" ||
      event.target.name === "coutHoraire" ||
      event.target.name === "tva" ||
      event.target.name === "formuleK"
    ) {
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
    const devis = devisCourant();
    Object.assign(devis, {
      numero: String(data.numero || "").trim() || devis.numero,
      date: data.date || devis.date,
      client: data.client,
      adresse: data.adresse,
      objet: data.objet,
      tva: Number(data.tva) || 0,
    });
    editingDevisMeta = false;
    saveState();
    render();
  });

  function nouveauDevis(modele) {
    const date = todayLocalISO();
    const devis = {
      id: uid(),
      numero: C.numeroDevisSuivant(state.devisList, date.slice(0, 4)),
      date,
      client: modele?.client || "",
      adresse: modele?.adresse || "",
      objet: modele?.objet || "",
      tva: modele ? modele.tva : Number(state.settings.tva) || 21,
      // Un duplicata repart en brouillon : c'est une nouvelle proposition, meme si
      // elle herite des prix arretes de l'original.
      statut: "brouillon",
      contexte: modele ? modele.contexte : C.contextePrix(state.settings),
      // Copie des lignes : dupliquer un devis ne doit pas partager ses lignes avec
      // l'original, sinon modifier l'un modifierait l'autre.
      lignes: (modele?.lignes || []).map((ligne) => ({ ...ligne, id: uid() })),
    };
    state.devisList.push(devis);
    state.devisCourantId = devis.id;
    editingDevisMeta = true;
    editingDevisLineId = "";
    saveState();
    render();
    notify(`Devis « ${devis.numero} » créé.`, "info");
  }

  $("#nouveau-devis").addEventListener("click", () => nouveauDevis(null));

  $("#figer-devis").addEventListener("click", () => {
    const devis = devisCourant();
    if (devis.statut === "fige") {
      if (!window.confirm(`Rouvrir « ${devis.numero} » en brouillon ? Ses prix redeviennent modifiables.`)) return;
      devis.statut = "brouillon";
      notify(`Devis « ${devis.numero} » rouvert en brouillon.`, "info");
    } else {
      if (!devis.lignes.length) {
        notify("Ajoutez au moins une ligne avant de figer ce devis.", "danger");
        return;
      }
      if (
        !window.confirm(
          `Figer « ${devis.numero} » ? Son montant ne bougera plus, quoi qu'il arrive ensuite aux prix de la bibliothèque.`,
        )
      )
        return;
      devis.statut = "fige";
      notify(`Devis « ${devis.numero} » figé : ${euro.format(totauxDevis(devis).ttc)} TVAC.`, "info");
    }
    saveState();
    render();
  });

  // Refige toutes les lignes aux prix d'aujourd'hui : c'est le passage explicite du
  // « montant chiffré » au « montant si je le refaisais maintenant ».
  $("#actualiser-devis").addEventListener("click", () => {
    const devis = devisCourant();
    if (refuserSiFige(devis)) return;
    const avant = totauxDevis(devis).ht;
    devis.lignes = devis.lignes.map((ligne) => (ouvrageById(ligne.ouvrageId) ? figerLigne(ligne) : ligne));
    devis.contexte = C.contextePrix(state.settings);
    const apres = totauxDevis(devis).ht;
    saveState();
    render();
    const ecart = C.roundMoney(apres - avant);
    notify(
      `Prix actualisés : total HTVA ${euro.format(avant)} → ${euro.format(apres)} (${ecart >= 0 ? "+" : ""}${euro.format(ecart)}).`,
      "info",
    );
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
    const devis = devisCourant();
    if (refuserSiFige(devis)) return;
    const payload = { ouvrageId: data.ouvrage, quantite: Number(data.quantite) || 0 };
    if (editingDevisLineId) {
      const ligne = devis.lignes.find((item) => item.id === editingDevisLineId);
      // Le prix est arrete a cet instant : c'est ce montant, et lui seul, qui vaudra
      // engagement, quoi qu'il advienne ensuite de la bibliotheque.
      if (ligne) Object.assign(ligne, figerLigne({ ...ligne, ...payload }));
      editingDevisLineId = "";
    } else {
      devis.lignes.push(figerLigne({ id: uid(), ...payload }));
    }
    // Les reglages en vigueur suivent le devis tant qu'il est en brouillon.
    devis.contexte = C.contextePrix(state.settings);
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

    if (data.infoToggle) {
      const info = document.getElementById(data.infoToggle);
      if (!info) return;
      const hidden = info.hasAttribute("hidden");
      info.toggleAttribute("hidden", !hidden);
      target.setAttribute("aria-expanded", String(hidden));
      return;
    }
    if (data.metreFlagRow !== undefined) {
      toggleFlagDetail(target, Number(data.metreFlagRow), data.metreFlagKind);
      return;
    }
    if (data.devisOuvrir) {
      state.devisCourantId = data.devisOuvrir;
      editingDevisMeta = false;
      editingDevisLineId = "";
      saveState();
      render();
      return;
    }
    if (data.devisDupliquer) {
      const modele = state.devisList.find((devis) => devis.id === data.devisDupliquer);
      if (modele) nouveauDevis(modele);
      return;
    }
    if (data.devisSupprimer) {
      const devis = state.devisList.find((item) => item.id === data.devisSupprimer);
      if (!devis || state.devisList.length < 2) return;
      if (!window.confirm(`Supprimer le devis « ${devis.numero} » et ses ${devis.lignes.length} ligne(s) ?`)) return;
      state.devisList = state.devisList.filter((item) => item.id !== data.devisSupprimer);
      if (state.devisCourantId === data.devisSupprimer) state.devisCourantId = state.devisList[0].id;
      editingDevisLineId = "";
      saveState();
      render();
      return;
    }
    if (data.metreApply !== undefined) return applySuggestion(Number(data.metreApply));
    if (data.metreRouvrir) {
      rouvrirMetre(data.metreRouvrir);
      return;
    }
    if (data.metreSupprimerArchive) {
      supprimerArchive(data.metreSupprimerArchive);
      return;
    }
    if (data.metreCreateOuvrage !== undefined) return startOuvrageCreationFromMetreRow(data.metreCreateOuvrage);
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
      const usedDevis = state.devisList.reduce(
        (total, devis) => total + devis.lignes.filter((ligne) => ligne.ouvrageId === data.deleteOuvrage).length,
        0,
      );
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
      C.supprimerOuvrage(state, data.deleteOuvrage);
      if (editingOuvrageId === data.deleteOuvrage) editingOuvrageId = "";
    } else if (data.deleteLigne) {
      if (refuserSiFige(devisCourant())) return;
      devisCourant().lignes = devisCourant().lignes.filter((ligne) => ligne.id !== data.deleteLigne);
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

    C.fusionnerOuvrages(state, fromId, toId);
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
    posteEnAttente = null;
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
    posteEnAttente = null;
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

  // Pré-remplit le formulaire "nouvel ouvrage" avec le libellé/l'unité d'un poste de
  // métré non reconnu : evite de retaper le meme concept avec des mots differents,
  // la cause la plus frequente des quasi-doublons entre communes.
  async function startOuvrageCreationFromMetreRow(index) {
    const row = state.metre.analysed[Number(index)];
    if (!row) return;
    goToView("ouvrages");
    editingOuvrageId = "";
    posteEnAttente = { metreId: state.metre.id, rowIndex: Number(index), numero: String(row.numero) };
    const form = $("#ouvrage-form");
    form.reset();
    setComposantRows([]);
    form.elements.nom.value = row.description;
    form.elements.unite.value = row.unite;
    updateEditForms();
    form.scrollIntoView({ behavior: "smooth", block: "start" });

    // Dernier maillon avant la saisie a la main : si une recette technique decrit ce
    // poste, la proposer plutot que de laisser un formulaire vide.
    const applique = await proposerRecette(row);
    if (applique) return;
    notify(`Complétez la composition, puis enregistrez : le poste « ${row.numero} » sera rattaché automatiquement.`, "info");
  }

  function recetteHtml(brouillon, row) {
    const ligne = (nom, quantite, unite, suffixe = "") =>
      `<tr><td>${esc(nom)}${suffixe}</td><td class="num">${esc(number.format(quantite))}</td><td>${esc(unite)}</td></tr>`;
    const connus = brouillon.composants.map((composant) => {
      const materiau = materialById(composant.materiauId);
      return ligne(materiau ? materiau.nom : "?", composant.quantite, materiau ? materiau.unite : "");
    });
    const nouveaux = brouillon.manquants.map((manquant) =>
      ligne(manquant.nom, manquant.quantite, manquant.unite, ` <em>(nouveau, ${euro.format(manquant.prix)}/${esc(manquant.unite)})</em>`),
    );
    return `
      <p>Le poste « ${esc(row.numero)} » ressemble à un ouvrage connu du métier :
        <strong>${esc(brouillon.nom)}</strong>, au ${esc(brouillon.unite)}.</p>
      <table>
        <thead><tr><th>Composant</th><th class="num">Par ${esc(brouillon.unite)}</th><th>Unité</th></tr></thead>
        <tbody>${connus.concat(nouveaux).join("")}</tbody>
      </table>
      <p>Main-d’œuvre proposée : <strong>${esc(number.format(brouillon.heures))} h/${esc(brouillon.unite)}</strong>,
        matériel ${esc(euro.format(brouillon.materiel))}.</p>
      ${brouillon.note ? `<p>${esc(brouillon.note)}</p>` : ""}
      <p><strong>Ces valeurs sont indicatives</strong> : elles viennent de l’usage courant du métier, pas de vos
        prix ni de vos rendements. Vérifiez-les dans le formulaire avant d’enregistrer.</p>
      ${
        brouillon.manquants.length
          ? `<p>${brouillon.manquants.length} matériau(x) seront ajoutés à votre bibliothèque, sans date de prix —
             ils apparaîtront donc comme « prix non daté » tant que vous ne les aurez pas confirmés.</p>`
          : ""
      }`;
  }

  /*
   * Genere un brouillon d'ouvrage a partir d'une recette, apres accord explicite.
   * Rien n'est enregistre ici : le formulaire est prerempli, et c'est l'utilisateur
   * qui valide. Les materiaux manquants, eux, sont bien crees — sans quoi le
   * formulaire afficherait une composition amputee, donc un prix trop bas.
   */
  async function proposerRecette(row) {
    const recette = C.recettePourPoste(row.description, row.unite, CATALOG.recettes);
    if (!recette) return false;
    const brouillon = C.preparerRecette(recette, state.materiaux);
    const accepte = await askDialog({
      titre: "Partir d’une recette technique ?",
      corpsHtml: recetteHtml(brouillon, row),
      corpsTexte: `${brouillon.nom} — ${brouillon.composants.length + brouillon.manquants.length} composant(s), ${number.format(brouillon.heures)} h/${brouillon.unite}. Valeurs indicatives à vérifier.`,
      ok: "Préremplir le formulaire",
      annuler: "Saisir moi-même",
    });
    if (!accepte) return false;

    const composants = brouillon.composants.slice();
    brouillon.manquants.forEach((manquant) => {
      const id = uid();
      state.materiaux.push({
        id,
        nom: manquant.nom,
        unite: manquant.unite,
        fournisseur: "",
        reference: "",
        conditionnement: "",
        prix: manquant.prix,
        // Pas de date : un prix indicatif ne doit pas passer pour un prix relevé.
        datePrix: "",
      });
      composants.push({ materiauId: id, quantite: manquant.quantite });
    });
    if (brouillon.manquants.length) saveState();

    const form = $("#ouvrage-form");
    form.elements.nom.value = row.description;
    form.elements.unite.value = brouillon.unite;
    form.elements.heures.value = brouillon.heures;
    form.elements.materiel.value = brouillon.materiel;
    form.elements.motsCles.value = C.normalizeKeywords([brouillon.motsCles, row.description]);
    // materialOptionsHtml est reconstruit au rendu : les nouveaux materiaux doivent y
    // etre avant que setComposantRows ne remplisse les selects.
    render();
    setComposantRows(composants);
    updateEditForms();
    notify(
      `Proposition « ${brouillon.nom} » : vérifiez rendement et prix, puis enregistrez — le poste « ${row.numero} » sera rattaché.`,
      "info",
    );
    return true;
  }

  function startDevisLineEdit(id) {
    if (refuserSiFige(devisCourant())) return;
    const ligne = devisCourant().lignes.find((item) => item.id === id);
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
    if (chosen && !C.unitsCompatible(chosen.unite, row.unite, row.quantite)) {
      event.target.value = row.ouvrageId || "";
      const forfait = C.isForfaitUnit(chosen.unite) || C.isForfaitUnit(row.unite);
      notify(
        forfait
          ? `Forfait contre quantité : « ${chosen.nom} » (${chosen.unite}) est un prix global, il ne peut pas être multiplié par ${number.format(row.quantite)} ${row.unite || "?"}.`
          : `Unité incompatible : « ${row.unite || "?"} » ne peut pas être chiffré avec « ${chosen.nom} » (${chosen.unite}).`,
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

  $("#confirm-matches").addEventListener("click", async () => {
    const proposals = state.metre.analysed.filter((row) => row.ouvrageId && !row.manual);
    if (!proposals.length) {
      notify("Aucune proposition à confirmer.", "info");
      return;
    }
    // On memorise des codes pour les marches suivants : il faut voir lesquels, et
    // vers quel ouvrage, avant de valider — pas seulement leur nombre.
    const commune = String(state.metre.analysedCommune || "").trim();
    const confirme = await askDialog({
      titre: `Mémoriser ${proposals.length} correspondance(s) ?`,
      corpsHtml: `
        <p>Ces codes seront reconnus d’emblée ${
          commune ? `au prochain marché de <strong>${esc(commune)}</strong>` : "sur les prochains marchés"
        }.</p>
        <table>
          <thead><tr><th>Poste</th><th>Ouvrage</th></tr></thead>
          <tbody>${proposals
            .map(
              (row) =>
                `<tr><td>${esc(row.numero)}</td><td>${esc(ouvrageById(row.ouvrageId)?.nom || "")}</td></tr>`,
            )
            .join("")}</tbody>
        </table>`,
      corpsTexte: `${proposals.length} correspondance(s). Les codes de métré seront mémorisés.`,
      ok: "Mémoriser",
    });
    if (!confirme) return;
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
      // Variable locale : sourceArrayBuffer/sourceFileName ne sont remplaces qu'une
      // fois la lecture entierement reussie. Sans ça, un fichier corrompu pouvait
      // laisser sourceArrayBuffer pointer vers les octets invalides pendant que
      // l'ancien metre restait affiche — un « Compléter le fichier reçu » ulterieur
      // aurait alors tente de relire ces octets et echoue silencieusement.
      let nextArrayBuffer = null;

      if (["xlsx", "xlsm", "xls"].includes(extension)) {
        if (!requireXlsx()) return;
        nextArrayBuffer = await file.arrayBuffer();
        const nextWorkbook = XLSX.read(nextArrayBuffer, { cellFormula: true, cellStyles: true });
        nextWorkbook.SheetNames.forEach((sheetName) => {
          if (C.normalizeText(sheetName).includes("recap")) return;
          const sheet = nextWorkbook.Sheets[sheetName];
          // Plage explicite depuis A1 : sans elle, sheet_to_json indexe depuis la
          // premiere cellule occupee (B3 si lignes 1-2 et colonne A sont vides) alors
          // que l'export prend __row/__cols pour des coordonnees absolues — les prix
          // partaient deux lignes et une colonne trop haut, sans aucun message.
          const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: true, range: rangeFromA1(sheet) });
          const parsed = C.rowsFromGrid(grid, sheetName);
          rows = rows.concat(parsed.rows);
          skipped += parsed.skipped;
          parsed.headers.forEach((header) => {
            if (!headers.includes(header)) headers.push(header);
          });
        });
      } else {
        // Pas file.text() : un CSV d'Excel Windows est en general en Windows-1252, et
        // le decoder en UTF-8 detruit chaque accent — donc l'en-tete, donc le fichier.
        const texte = C.decoderTexte(await file.arrayBuffer());
        const parsed = C.rowsFromGrid(C.parseDelimited(texte), file.name);
        rows = parsed.rows;
        skipped = parsed.skipped;
        headers = parsed.headers;
      }

      if (!rows.length) {
        notify("Aucune ligne exploitable : vérifiez que le fichier contient désignation, unité et quantité.", "danger");
      }
      // Le metre en cours part dans l'historique AVANT que les octets en memoire ne
      // soient remplaces : archive apres coup, il repartirait avec le classeur du
      // marche suivant, et sa reouverture ne retrouverait plus aucune de ses feuilles.
      clearTimeout(archivageTimer);
      await archiverMetreCourant();
      sourceArrayBuffer = nextArrayBuffer;
      sourceFileName = file.name;
      // La commune est conservee d'un import a l'autre : plusieurs lots d'un meme
      // marche sont generalement importes l'un apres l'autre.
      state.metre = { ...emptyMetre(), id: uid(), commune: state.metre.commune, fileName: file.name, rows, skipped };
      await DGStore.saveSource(state.metre.id, sourceFileName, sourceArrayBuffer);
      populateFieldMap(headers);
      saveState();
      render();
      // Le bloc s'etait replie apres l'analyse precedente : un nouveau fichier veut
      // dire nouvelles colonnes a verifier, et « Analyser le métré » est dedans.
      const setup = $("#metre-setup");
      if (setup) setup.open = true;
      if (rows.length) notify(`${rows.length} poste(s) lu(s). Vérifiez les colonnes puis lancez l’analyse.`, "info");
    } catch (error) {
      notify(`Lecture impossible : ${error.message}`, "danger");
    } finally {
      event.target.value = "";
    }
  });

  // "change" (validation du champ) et non "input" : saveState() serialise tout l'etat,
  // lignes du tableur importe comprises — le faire a chaque caractere se sentait sur
  // un telephone avec un gros metre.
  $("#metre-commune").addEventListener("change", (event) => {
    state.metre.commune = event.target.value;
    saveState();
    renderMetre();
    if (communeDivergente()) {
      notify(
        `Commune modifiée : relancez l’analyse pour l’appliquer. Tant que ce n’est pas fait, les confirmations restent mémorisées pour « ${
          state.metre.analysedCommune || "aucune commune"
        } ».`,
        "warning",
      );
    }
  });

  $("#toast-close").addEventListener("click", hideToast);

  // Repasser un metre archive aux prix du jour : l'autre lecture, celle du « combien
  // coûterait ce marché maintenant ».
  $("#recalculer-metre").addEventListener("click", () => {
    if (!state.metre.fige) return;
    const avant = state.metre.analysed.reduce((somme, row) => somme + metreRowPrice(row), 0);
    state.metre.fige = false;
    state.metre.contexte = C.contextePrix(state.settings);
    const apres = state.metre.analysed.reduce((somme, row) => somme + metreRowPrice(row), 0);
    saveState();
    render();
    const ecart = C.roundMoney(apres - avant);
    notify(
      `Métré recalculé aux prix actuels : ${euro.format(avant)} → ${euro.format(apres)} (${ecart >= 0 ? "+" : ""}${euro.format(ecart)}).`,
      "info",
    );
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

  $("#export-devis").addEventListener("click", () => exportCsv(nomFichierDevis("csv"), devisRows()));

  $("#export-devis-xlsx").addEventListener("click", () => {
    if (!requireXlsx()) return;
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(devisRows()), "Devis");
    XLSX.writeFile(workbook, nomFichierDevis("xlsx"));
  });

  $("#export-devis-json").addEventListener("click", () => {
    downloadBlob(
      nomFichierDevis("json"),
      new Blob([JSON.stringify({ devis: devisCourant() }, null, 2)], { type: "application/json" }),
    );
  });

  $("#import-devis-json").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      const devis = imported.devis || imported;
      if (!Array.isArray(devis.lignes)) throw new Error("structure invalide");
      // Un devis importe s'ajoute a la liste au lieu d'ecraser celui qui est ouvert.
      const [importe] = normalizeState({ ...state, devisList: [devis], devisCourantId: "" }).devisList;
      importe.id = uid();
      if (state.devisList.some((autre) => autre.numero === importe.numero)) {
        importe.numero = C.numeroDevisSuivant(state.devisList, (importe.date || todayLocalISO()).slice(0, 4));
      }
      state.devisList.push(importe);
      state.devisCourantId = importe.id;
      editingDevisMeta = false;
      saveState();
      render();
      notify(`Devis « ${importe.numero} » importé et ouvert.`, "info");
    } catch {
      notify("Ce fichier n’est pas un devis exporté par l’application.", "danger");
    } finally {
      event.target.value = "";
    }
  });

  $("#export-data").addEventListener("click", () => {
    const payload = C.donneesExportables(state);
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
      const metreCourant = state.metre;
      const metre = C.metreApresImport(imported, metreCourant);
      const metreRemplace = metre !== metreCourant;
      state = normalizeState({ ...imported, metre });
      if (!state.catalogVersion) state.catalogVersion = CATALOG_VERSION;
      if (metreRemplace) {
        // Le classeur en memoire appartenait a l'ancien etat : sans ceci, « Compléter
        // le fichier reçu » ecrivait l'analyse importee dans le fichier precedent.
        sourceArrayBuffer = null;
        sourceFileName = "";
        DGStore.clearSource();
      }
      saveState();
      render();
      // Le metre conserve garde ses postes et ses quantites, mais ses rapprochements
      // designent les ouvrages de l'ancienne bibliotheque : le dire plutot que de
      // laisser decouvrir des lignes « ouvrage supprimé ».
      const metreConserve = !metreRemplace && metreCourant.analysed.length > 0;
      notify(
        metreConserve
          ? "Données importées. Le métré en cours est conservé — relancez l’analyse pour le rapprocher de la bibliothèque importée."
          : "Données importées.",
        "info",
      );
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
    sourceArrayBuffer = null;
    sourceFileName = "";
    metreArchives = [];
    DGStore.clearSource();
    seedCatalog(true);
    saveState();
    render();
    notify("Application réinitialisée.", "info");
  });

  /* --------------------------------------------------------------------- init */

  populateFieldMap(Object.keys(state.metre.rows[0] || {}));
  if (state.metre.mapping?.poste) appliquerMappingAuxSelects();
  updateEditForms();
  resetChantierForm();
  render();
  setComposantRows([]);
  saveState();
  if (corruptedStateKey) {
    notify(
      "Les données enregistrées étaient illisibles : l’application repart du catalogue. " +
        `Une copie brute est conservée dans le navigateur sous la clé « ${corruptedStateKey} ».`,
      "danger",
    );
  }
  const versionEl = $("#app-version");
  if (versionEl) versionEl.textContent = `v${APP_VERSION}`;
  const aProposVersion = $("#about-version");
  if (aProposVersion) aProposVersion.textContent = `v${APP_VERSION}`;

  /*
   * Le service worker sert deja le reseau en premier : un rechargement suffit
   * normalement. Ce bouton existe pour le cas ou l'ecran affiche encore l'ancienne
   * version alors qu'une nouvelle vient d'etre publiee — il force la verification
   * plutot que de laisser chercher comment vider un cache sur telephone.
   */
  const boutonMaj = $("#check-update");
  if (boutonMaj) {
    boutonMaj.addEventListener("click", async () => {
      boutonMaj.disabled = true;
      try {
        if ("serviceWorker" in navigator) {
          const inscriptions = await navigator.serviceWorker.getRegistrations();
          await Promise.all(inscriptions.map((inscription) => inscription.update()));
        }
        notify("Vérification effectuée : rechargement…", "info");
        // Laisse le message s'afficher avant de recharger.
        setTimeout(() => window.location.reload(), 600);
      } catch {
        boutonMaj.disabled = false;
        notify("Vérification impossible : rechargez la page manuellement.", "danger");
      }
    });
  }
  // L'attribut est deja pose par le script en tete de <head> (evite un flash) :
  // ceci ne fait que synchroniser l'etat visuel des boutons avec ce choix.
  applyTheme(document.documentElement.getAttribute("data-theme") || "auto");

  /*
   * Donnees lourdes : IndexedDB est asynchrone, donc restaurees apres le premier
   * rendu. Le classeur n'est repris que s'il correspond bien au metre affiche — un
   * import JSON a pu changer de marche entre-temps.
   */
  (async () => {
    const [source, archives] = await Promise.all([DGStore.loadSource(), DGStore.listArchives()]);
    metreArchives = archives;
    if (source && source.metreId && source.metreId === state.metre.id && source.fileName === state.metre.fileName) {
      sourceArrayBuffer = source.octets || null;
      sourceFileName = source.fileName || "";
    }
    renderMetre();
  })();

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
