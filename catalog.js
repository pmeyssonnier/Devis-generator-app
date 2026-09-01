/*
 * catalog.js — donnees de demarrage (materiaux, ouvrages, lots).
 * Charge avant core.js et app.js. Ne depend d'aucun DOM.
 */
(function (root) {
  "use strict";

  // Reglages par defaut a la premiere ouverture.
  const defaultSettings = {
    coutHoraire: 47.5,
    fraisGeneraux: 12,
    fraisChantier: 5,
    imprevus: 4,
    marge: 18,
    tva: 21,
  };

  const defaultEntrepreneur = {
    nom: "",
    adresse: "",
    tel: "",
    email: "",
    numeroTva: "",
  };

  const defaultDevis = {
    client: "",
    adresse: "",
    objet: "",
    tva: 21,
    lignes: [],
  };

  // [nom, unite de prix, prix, fournisseur, reference, conditionnement]
  const materiaux = [
    ["Forfait installation de chantier", "FF", 2850, "Interne", "CAT-00-FF", "Forfait"],
    ["Location échafaudage", "m2", 4.8, "Location", "CAT-ECHAFAUD", "m² de façade"],
    ["Protection chantier", "m2", 2.2, "Interne", "CAT-PROTECTION", "Film, panneaux et consommables"],
    ["Évacuation déchets", "m3", 72, "Centre de tri", "CAT-DECHETS", "m³ évacué"],
    ["Consommables démolition", "m2", 1.5, "Interne", "CAT-DEMO", "Usure outillage et sacs"],
    ["Briques et mortier", "m2", 38, "Négociant matériaux", "CAT-MACON", "m² de maçonnerie"],
    ["Mortier de chaux", "m2", 9.5, "Négociant matériaux", "CAT-CHAUX", "Jointoiement au m²"],
    ["Kit réparation béton", "m2", 32, "Négociant matériaux", "CAT-BETON", "Mortier, primaire et passivant"],
    ["Linteau préfabriqué", "m", 42, "Négociant matériaux", "CAT-LINTEAU", "Mètre courant"],
    ["Pierre bleue", "m", 75, "Carrier / fournisseur", "CAT-PIERRE", "Seuil au mètre"],
    ["Enduit façade armé", "m2", 18.2, "Fournisseur façade", "CAT-ENDUIT-ARME", "Enduit, treillis et accessoires"],
    ["Peinture façade siloxane", "m2", 7.8, "Fournisseur peinture", "CAT-SILOXANE", "Primaire et peinture"],
    ["Solin et couvre-mur", "m", 36, "Fournisseur toiture", "CAT-SOLIN", "Mètre courant"],
    ["Cimentage hydrofuge", "m2", 12.5, "Négociant matériaux", "CAT-CIMENTAGE", "Mortier hydrofuge"],
    ["Étanchéité bitumineuse", "m2", 24, "Fournisseur toiture", "CAT-BITUME", "Bicouche au m²"],
    ["Membrane EPDM", "m2", 22, "Fournisseur toiture", "CAT-EPDM", "Membrane et colle"],
    ["Étanchéité liquide", "m2", 14.5, "Fournisseur étanchéité", "CAT-ETANCH-LIQ", "Système sous carrelage"],
    ["PVC évacuation 110", "m", 18, "Sanitaire", "CAT-PVC110", "Tube et raccords"],
    ["PIR 80 mm", "m2", 26, "Isolation", "CAT-PIR80", "Panneaux isolants"],
    ["Laine minérale 100 mm", "m2", 11, "Isolation", "CAT-LAINE100", "Rouleaux ou panneaux"],
    ["Pare-vapeur", "m2", 4.2, "Isolation", "CAT-PAREVAPEUR", "Membrane et adhésifs"],
    ["Chape armée", "m2", 18, "Négociant matériaux", "CAT-CHAPE", "Chape 6 cm"],
    ["Plâtre et enduit intérieur", "m2", 8.5, "Négociant matériaux", "CAT-PLATRE", "Deux couches"],
    ["Plaque BA13 et ossature", "m2", 17, "Parachèvement", "CAT-BA13", "Plaques, rails et suspentes"],
    ["Faïence murale", "m2", 31, "Carrelage", "CAT-FAIENCE", "Carrelage mural et colle"],
    ["Carrelage grès cérame", "m2", 34, "Carrelage", "CAT-GRES", "Grès cérame, colle et joints"],
    ["Profilés de finition", "m", 5.8, "Parachèvement", "CAT-PROFILES", "Cornière ou profilé au mètre"],
    ["Peinture intérieure", "m2", 5.2, "Fournisseur peinture", "CAT-PEINT-INT", "Primaire et deux couches"],
    ["Peinture bois", "m2", 9.8, "Fournisseur peinture", "CAT-PEINT-BOIS", "Ponçage, primaire et finition"],
    ["Châssis PVC double vitrage", "m2", 295, "Menuiserie", "CAT-CHASSIS", "Châssis pose comprise"],
    ["Porte bois massif", "pce", 950, "Menuiserie", "CAT-PORTE", "Pièce"],
    ["Garde-corps acier", "m", 145, "Métallerie", "CAT-GC", "Mètre courant"],
    ["WC suspendu complet", "pce", 520, "Sanitaire", "CAT-WC", "Cuvette, bâti et accessoires"],
    ["Multicouche diamètre 16", "m", 7.4, "Sanitaire", "CAT-MC16", "Tube et raccords"],
    ["Prise 2P+T encastrée", "pce", 22, "Électricité", "CAT-PRISE", "Blochet, prise et câble"],
    ["Forfait contrôle et réception", "FF", 450, "Organisme / interne", "CAT-CONTROLE", "Forfait"],
    ["Sciage béton armé", "m", 58, "Sous-traitance / interne", "CAT-SCIAGE", "Mètre linéaire"],
    ["Mobilier vestiaire", "pce", 0, "Hors marché", "CAT-MOB-VEST", "Pour mémoire"],
  ].map(([nom, unite, prix, fournisseur, reference, conditionnement]) => ({
    nom,
    unite,
    prix,
    fournisseur,
    reference,
    conditionnement,
    datePrix: "",
  }));

  /*
   * [ref metre, nom, unite, heures/unite, composants, materiel/unite, mots cles]
   *
   * composants : [[nom du materiau, quantite par unite d'ouvrage], ...]. Un ouvrage
   * qui combine plusieurs fournitures (isolant + enduit + accessoires) les enumere
   * toutes ; le catalogue de depart n'en declare qu'une par ouvrage, les fournitures
   * groupees restant a detailler au fur et a mesure des prix reellement obtenus.
   */
  const ouvrages = [
    ["00.01", "Installation de chantier, amenée et repli", "FF", 18, [["Forfait installation de chantier", 1]], 350, "installation chantier amenee repli generalites"],
    ["00.02", "Échafaudage de façade, location comprise", "m2", 0.08, [["Location échafaudage", 1]], 1.5, "echafaudage facade location montage demontage"],
    ["00.03", "Signalisation, clôture et sécurisation des accès", "FF", 8, [["Forfait installation de chantier", 0.35]], 180, "signalisation cloture securisation acces chantier"],
    ["00.04", "Protection des ouvrages conservés", "m2", 0.09, [["Protection chantier", 1]], 0.8, "protection ouvrages conserves film panneau bachage maintenus"],
    ["00.05", "Évacuation des déchets, tri et taxes comprises", "m3", 0.45, [["Évacuation déchets", 1]], 8, "evacuation dechets tri taxes container conteneur decharge"],
    ["00.06", "Dossier as-built, PV de réception, garanties", "FF", 6, [["Forfait contrôle et réception", 0.35]], 0, "as built pv reception garanties dossier"],
    ["01.01", "Piquage d’enduit dégradé", "m2", 0.22, [["Consommables démolition", 1]], 2, "piquage enduit degrade demolition facade enduits"],
    ["01.02", "Démolition de cloison légère", "m2", 0.3, [["Consommables démolition", 1]], 3, "demolition cloison legere cloisons depose"],
    ["01.03", "Dépose de plafond existant", "m2", 0.2, [["Consommables démolition", 1]], 2.5, "depose plafond existant faux plafonds demolition"],
    ["01.04", "Dépose de menuiserie extérieure", "pce", 1.25, [["Consommables démolition", 2]], 12, "depose menuiserie exterieure chassis porte exterieurs"],
    ["01.05", "Dépose de revêtements de sol et chape existante", "m2", 0.28, [["Consommables démolition", 1.2]], 4, "depose revetement sol chape existante"],
    ["01.06", "Dépose d’appareils sanitaires et tuyauterie", "pce", 1.1, [["Consommables démolition", 1.5]], 10, "depose sanitaires tuyauterie appareil"],
    ["01.07", "Sciage de béton armé et découpe de trémie", "m", 1.25, [["Sciage béton armé", 1]], 12, "sciage beton arme decoupe tremie escalier"],
    ["02.01", "Maçonnerie de rebouchage en briques", "m2", 0.75, [["Briques et mortier", 1]], 6, "maconnerie rebouchage briques baies"],
    ["02.02", "Rejointoiement de maçonnerie, mortier de chaux", "m2", 0.32, [["Mortier de chaux", 1]], 3, "rejointoiement maconnerie mortier chaux naturelle"],
    ["02.03", "Réparation de béton dégradé, passivation des aciers", "m2", 0.7, [["Kit réparation béton", 1]], 5, "reparation beton degrade betons passivation aciers armatures"],
    ["02.04", "Pose de linteau préfabriqué, étançonnement compris", "m", 0.9, [["Linteau préfabriqué", 1]], 12, "pose linteau prefabrique etanconnement"],
    ["02.05", "Seuil en pierre bleue, pose comprise", "m", 0.85, [["Pierre bleue", 1]], 8, "seuil seuils appui appuis pierre bleue pose"],
    ["03.01", "Nettoyage haute pression de façade", "m2", 0.08, [["Consommables démolition", 0.5]], 2.5, "nettoyage haute pression facade"],
    ["03.02", "Enduit de façade minéral armé", "m2", 0.35, [["Enduit façade armé", 1]], 4.5, "enduit facade mineral arme crepi treillis armature"],
    ["03.03", "Peinture de façade siloxane", "m2", 0.16, [["Peinture façade siloxane", 1]], 2, "peinture facade siloxane exterieur"],
    ["03.04", "Solin, relevé et couvre-mur", "m", 0.45, [["Solin et couvre-mur", 1]], 5, "solin releve couvre mur zinc etancheite"],
    ["03.05", "Cimentage hydrofuge de soubassement", "m2", 0.3, [["Cimentage hydrofuge", 1]], 3, "cimentage hydrofuge soubassement"],
    ["04.01", "Étanchéité bitumineuse bicouche", "m2", 0.28, [["Étanchéité bitumineuse", 1]], 5, "etancheite bitumineuse bicouche roofing toiture plate"],
    ["04.02", "Étanchéité EPDM collée", "m2", 0.24, [["Membrane EPDM", 1]], 4, "etancheite epdm collee membrane"],
    ["04.03", "Étanchéité liquide sous carrelage", "m2", 0.18, [["Étanchéité liquide", 1]], 2.5, "etancheite liquide sous carrelage sanitaires"],
    ["04.04", "Évacuation PVC diamètre 110", "m", 0.38, [["PVC évacuation 110", 1]], 4, "evacuation pvc 110 tuyauterie descente descentes eau pluviale"],
    ["05.01", "Isolation PIR 80 mm sous plafond", "m2", 0.18, [["PIR 80 mm", 1]], 2.5, "isolation pir 80 sous plafond dalle panneaux"],
    ["05.02", "Isolation laine minérale 100 mm", "m2", 0.16, [["Laine minérale 100 mm", 1]], 2, "isolation laine minerale 100 ossature bois"],
    ["05.03", "Pare-vapeur et étanchéité à l’air", "m2", 0.11, [["Pare-vapeur", 1]], 1.2, "pare vapeur etancheite air membrane"],
    ["06.01", "Chape de ravoirage armée 6 cm", "m2", 0.28, [["Chape armée", 1]], 4, "chape ravoirage armee 6 cm"],
    ["06.02", "Plafonnage sur maçonnerie, deux couches", "m2", 0.38, [["Plâtre et enduit intérieur", 1]], 2.5, "plafonnage maconnerie maconneries deux couches dressees"],
    ["06.03", "Faux plafond BA13 sur ossature", "m2", 0.42, [["Plaque BA13 et ossature", 1]], 3.5, "faux plafond ba13 plaques ossature"],
    ["06.04", "Faïence murale, profilés de finition compris", "m2", 0.62, [["Faïence murale", 1]], 5, "faience murale profiles finition carrelage mural sanitaires"],
    ["06.05", "Carrelage de sol grès cérame", "m2", 0.55, [["Carrelage grès cérame", 1]], 5, "carrelage sol gres cerame"],
    ["06.06", "Rebouchage et enduit de rattrapage sur linteaux", "m", 0.32, [["Plâtre et enduit intérieur", 0.35]], 2.5, "rebouchage enduit rattrapage linteaux"],
    ["06.07", "Cornières et profilés de finition", "m", 0.12, [["Profilés de finition", 1]], 1, "cornieres profiles finition"],
    ["07.01", "Peinture murs intérieurs, deux couches", "m2", 0.15, [["Peinture intérieure", 1]], 1.5, "peinture murs interieurs deux couches"],
    ["07.02", "Peinture plafonds intérieurs, deux couches", "m2", 0.17, [["Peinture intérieure", 1.1]], 1.5, "peinture plafonds interieurs deux couches"],
    ["07.03", "Peinture sur menuiseries bois, ponçage compris", "m2", 0.38, [["Peinture bois", 1]], 3, "peinture menuiseries bois poncage"],
    ["07.04", "Enduit de lissage avant peinture", "m2", 0.18, [["Plâtre et enduit intérieur", 0.55]], 1.5, "enduit lissage avant mise peinture"],
    ["08.01", "Châssis PVC double vitrage", "m2", 1.2, [["Châssis PVC double vitrage", 1]], 25, "chassis pvc double vitrage menuiserie exterieure pose"],
    ["08.02", "Porte d’entrée bois massif", "pce", 3.5, [["Porte bois massif", 1]], 45, "porte entree bois massif menuiserie quincaillerie"],
    ["08.03", "Garde-corps acier thermolaqué", "m", 0.9, [["Garde-corps acier", 1]], 18, "garde corps acier thermolaque"],
    ["08.04", "WC suspendu complet, bâti-support inclus", "pce", 3.2, [["WC suspendu complet", 1]], 35, "wc suspendu complet bati support sanitaire"],
    ["08.05", "Essais d’étanchéité, rinçage, mise en service", "FF", 5, [["Forfait contrôle et réception", 0.45]], 0, "essais etancheite rincage mise service"],
    ["08.06", "Alimentation multicouche diamètre 16", "m", 0.24, [["Multicouche diamètre 16", 1]], 2.5, "alimentation multicouche 16 tube tuyauterie sanitaire"],
    ["09.01", "Prise de courant 2P+T encastrée", "pce", 0.65, [["Prise 2P+T encastrée", 1]], 6, "prise prises courant 2pt encastree encastrees electricite"],
    ["09.02", "Mise à la terre et liaisons équipotentielles RGIE", "FF", 7, [["Forfait contrôle et réception", 0.65]], 80, "mise terre liaisons equipotentielles rgie"],
    ["09.03", "Contrôle de conformité par organisme agréé", "FF", 2, [["Forfait contrôle et réception", 1]], 0, "controle conformite organisme agree rgie"],
    ["09.04", "Mobilier de vestiaire (pour mémoire, hors marché)", "pce", 0, [["Mobilier vestiaire", 1]], 0, "mobilier vestiaire pour memoire hors marche"],
  ].map(([ref, nom, unite, heures, composants, materiel, motsCles]) => ({
    ref,
    nom,
    unite,
    heures,
    composants: composants.map(([materiau, quantite]) => ({ materiau, quantite })),
    materiel,
    motsCles,
  }));

  // Codifications deja rencontrees sur des marches, rattachees a l'ouvrage du
  // catalogue. C'est le point de depart de la memoire des correspondances.
  const referencesConnues = {
    "00.01": ["1.01"],
    "00.02": ["1.02"],
    "00.04": ["1.03"],
    "00.05": ["1.08"],
    "00.06": ["6.04"],
    "01.01": ["1.04"],
    "01.02": ["1.05"],
    "01.03": ["1.06"],
    "01.04": ["1.07"],
    "01.07": ["1.09", "10.01"],
    "02.01": ["2.01"],
    "02.02": ["2.02"],
    "02.03": ["2.03"],
    "02.05": ["2.07"],
    "03.01": ["2.04"],
    "03.02": ["2.05"],
    "03.03": ["2.06"],
    "03.04": ["2.08"],
    "03.05": ["2.09"],
    "04.01": ["3.01"],
    "04.02": ["3.02"],
    "04.03": ["5.04"],
    "04.04": ["3.06"],
    "05.01": ["3.03"],
    "05.02": ["3.04.a"],
    "05.03": ["3.05"],
    "06.01": ["4.03"],
    "06.02": ["4.01"],
    "06.03": ["4.02"],
    "06.04": ["4.05"],
    "06.05": ["4.04"],
    "06.07": ["4.09"],
    "07.01": ["4.07"],
    "07.02": ["4.08"],
    "07.04": ["4.06"],
    "08.01": ["5.01"],
    "08.02": ["5.02"],
    "08.03": ["5.03"],
    "08.04": ["5.05"],
    "08.05": ["5.07"],
    "08.06": ["5.06"],
    "09.01": ["6.01"],
    "09.02": ["6.02"],
    "09.03": ["6.03"],
    "09.04": ["5.08"],
  };

  const lotLabels = {
    "00": "LOT 00 — Installations de chantier et généralités",
    "01": "LOT 01 — Démolitions et déposes",
    "02": "LOT 02 — Maçonnerie et structure",
    "03": "LOT 03 — Façades",
    "04": "LOT 04 — Étanchéité",
    "05": "LOT 05 — Isolation",
    "06": "LOT 06 — Plafonnage, chapes et revêtements",
    "07": "LOT 07 — Peintures et finitions",
    "08": "LOT 08 — Menuiseries et sanitaire",
    "09": "LOT 09 — Électricité et conformité",
  };

  root.DGCatalog = {
    defaultSettings,
    defaultEntrepreneur,
    defaultDevis,
    materiaux,
    ouvrages,
    referencesConnues,
    lotLabels,
  };
})(globalThis);
