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
    // Au-dela, un prix materiau date est signale comme a verifier. 0 desactive l'alerte.
    peremptionJours: 180,
    // "additive" : K = 1 + somme des taux / 100. "multiplicative" : chaque taux
    // s'applique sur la base deja majoree par les precedents (K plus eleve).
    formuleK: "additive",
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
    ["Film de protection", "m2", 0.9, "Interne", "CAT-PROTECTION-FILM", "Bâchage au m²"],
    ["Panneaux de protection", "m2", 0.9, "Interne", "CAT-PROTECTION-PANNEAUX", "Panneaux rigides au m²"],
    ["Consommables de protection", "m2", 0.4, "Interne", "CAT-PROTECTION-CONSO", "Adhésifs et fixations"],
    ["Évacuation déchets", "m3", 72, "Centre de tri", "CAT-DECHETS", "m³ évacué"],
    ["Consommables démolition", "m2", 1.5, "Interne", "CAT-DEMO", "Usure outillage et sacs"],
    ["Briques", "m2", 28, "Négociant matériaux", "CAT-MACON-BRIQUES", "m² de maçonnerie"],
    ["Mortier de maçonnerie", "m2", 10, "Négociant matériaux", "CAT-MACON-MORTIER", "m² de maçonnerie"],
    ["Mortier de chaux", "m2", 9.5, "Négociant matériaux", "CAT-CHAUX", "Jointoiement au m²"],
    ["Mortier de réparation béton", "m2", 22, "Négociant matériaux", "CAT-BETON-MORTIER", "Réparation au m²"],
    ["Primaire d’accrochage béton", "m2", 4, "Négociant matériaux", "CAT-BETON-PRIMAIRE", "Accrochage au m²"],
    ["Passivant anticorrosion", "m2", 6, "Négociant matériaux", "CAT-BETON-PASSIVANT", "Protection des aciers au m²"],
    ["Linteau préfabriqué", "m", 42, "Négociant matériaux", "CAT-LINTEAU", "Mètre courant"],
    ["Pierre bleue", "m", 75, "Carrier / fournisseur", "CAT-PIERRE", "Seuil au mètre"],
    ["Enduit de façade", "m2", 13.5, "Fournisseur façade", "CAT-ENDUIT-ARME-ENDUIT", "Enduit au m²"],
    ["Treillis d’armature façade", "m2", 3.2, "Fournisseur façade", "CAT-ENDUIT-ARME-TREILLIS", "Treillis en fibre de verre au m²"],
    ["Accessoires d’enduit (baguettes, profilés)", "m2", 1.5, "Fournisseur façade", "CAT-ENDUIT-ARME-ACCESS", "Baguettes d’angle et profilés au m²"],
    ["Primaire façade", "m2", 2.3, "Fournisseur peinture", "CAT-SILOXANE-PRIMAIRE", "Accrochage au m²"],
    ["Peinture façade siloxane", "m2", 5.5, "Fournisseur peinture", "CAT-SILOXANE-FINITION", "Finition au m²"],
    ["Solin et couvre-mur", "m", 36, "Fournisseur toiture", "CAT-SOLIN", "Mètre courant"],
    ["Cimentage hydrofuge", "m2", 12.5, "Négociant matériaux", "CAT-CIMENTAGE", "Mortier hydrofuge"],
    ["Étanchéité bitumineuse", "m2", 24, "Fournisseur toiture", "CAT-BITUME", "Bicouche au m²"],
    ["Membrane EPDM", "m2", 18, "Fournisseur toiture", "CAT-EPDM-MEMBRANE", "Membrane au m²"],
    ["Colle de fixation EPDM", "m2", 4, "Fournisseur toiture", "CAT-EPDM-COLLE", "Collage au m²"],
    ["Étanchéité liquide", "m2", 14.5, "Fournisseur étanchéité", "CAT-ETANCH-LIQ", "Système sous carrelage"],
    ["Tube PVC évacuation 110", "m", 13, "Sanitaire", "CAT-PVC110-TUBE", "Tube au mètre"],
    ["Raccords PVC évacuation 110", "m", 5, "Sanitaire", "CAT-PVC110-RACCORDS", "Raccords au mètre"],
    ["PIR 80 mm", "m2", 26, "Isolation", "CAT-PIR80", "Panneaux isolants"],
    ["Laine minérale 100 mm", "m2", 11, "Isolation", "CAT-LAINE100", "Rouleaux ou panneaux"],
    ["Membrane pare-vapeur", "m2", 3.4, "Isolation", "CAT-PAREVAPEUR-MEMBRANE", "Membrane au m²"],
    ["Adhésifs pare-vapeur", "m2", 0.8, "Isolation", "CAT-PAREVAPEUR-ADHESIF", "Rubans et adhésifs au m²"],
    ["Chape armée", "m2", 18, "Négociant matériaux", "CAT-CHAPE", "Chape 6 cm"],
    ["Plâtre et enduit intérieur", "m2", 8.5, "Négociant matériaux", "CAT-PLATRE", "Deux couches"],
    ["Plaque BA13", "m2", 8, "Parachèvement", "CAT-BA13-PLAQUE", "Plaque au m²"],
    ["Rails et montants", "m2", 6, "Parachèvement", "CAT-BA13-RAILS", "Ossature au m²"],
    ["Suspentes et fixations BA13", "m2", 3, "Parachèvement", "CAT-BA13-SUSPENTES", "Fixations au m²"],
    ["Faïence murale", "m2", 24, "Carrelage", "CAT-FAIENCE-CARRELAGE", "Carrelage mural au m²"],
    ["Colle carrelage mural", "m2", 7, "Carrelage", "CAT-FAIENCE-COLLE", "Collage au m²"],
    ["Grès cérame", "m2", 26, "Carrelage", "CAT-GRES-CARRELAGE", "Carrelage au m²"],
    ["Colle carrelage sol", "m2", 6, "Carrelage", "CAT-GRES-COLLE", "Collage au m²"],
    ["Joints carrelage sol", "m2", 2, "Carrelage", "CAT-GRES-JOINTS", "Jointoiement au m²"],
    ["Profilés de finition", "m", 5.8, "Parachèvement", "CAT-PROFILES", "Cornière ou profilé au mètre"],
    ["Primaire intérieur", "m2", 1.4, "Fournisseur peinture", "CAT-PEINT-INT-PRIMAIRE", "Accrochage au m²"],
    ["Peinture intérieure", "m2", 3.8, "Fournisseur peinture", "CAT-PEINT-INT-FINITION", "Deux couches au m²"],
    ["Primaire bois", "m2", 3.3, "Fournisseur peinture", "CAT-PEINT-BOIS-PRIMAIRE", "Accrochage au m²"],
    ["Peinture bois", "m2", 6.5, "Fournisseur peinture", "CAT-PEINT-BOIS-FINITION", "Finition au m²"],
    ["Châssis PVC double vitrage", "m2", 295, "Menuiserie", "CAT-CHASSIS", "Châssis pose comprise"],
    ["Porte bois massif", "pce", 950, "Menuiserie", "CAT-PORTE", "Pièce"],
    ["Garde-corps acier", "m", 145, "Métallerie", "CAT-GC", "Mètre courant"],
    ["Cuvette suspendue", "pce", 260, "Sanitaire", "CAT-WC-CUVETTE", "Pièce"],
    ["Bâti-support WC", "pce", 210, "Sanitaire", "CAT-WC-BATI", "Pièce"],
    ["Accessoires WC (fixation, plaque de commande)", "pce", 50, "Sanitaire", "CAT-WC-ACCESS", "Pièce"],
    ["Tube multicouche diamètre 16", "m", 5.4, "Sanitaire", "CAT-MC16-TUBE", "Tube au mètre"],
    ["Raccords multicouche diamètre 16", "m", 2, "Sanitaire", "CAT-MC16-RACCORDS", "Raccords au mètre"],
    ["Blochet d’encastrement", "pce", 3, "Électricité", "CAT-PRISE-BLOCHET", "Boîte au point"],
    ["Prise 2P+T", "pce", 9, "Électricité", "CAT-PRISE-APPAREIL", "Appareillage à la pièce"],
    ["Câble d’alimentation prise", "pce", 10, "Électricité", "CAT-PRISE-CABLE", "Câble par point"],
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
   * toutes. Les prix ventiles ici sont une repartition indicative du prix groupe
   * d'origine — a corriger des que les prix reellement obtenus par fourniture
   * sont connus.
   */
  const ouvrages = [
    ["00.01", "Installation de chantier, amenée et repli", "FF", 18, [["Forfait installation de chantier", 1]], 350, "installation chantier amenee repli generalites"],
    ["00.02", "Échafaudage de façade, location comprise", "m2", 0.08, [["Location échafaudage", 1]], 1.5, "echafaudage facade location montage demontage"],
    ["00.03", "Signalisation, clôture et sécurisation des accès", "FF", 8, [["Forfait installation de chantier", 0.35]], 180, "signalisation cloture securisation acces chantier"],
    ["00.04", "Protection des ouvrages conservés", "m2", 0.09, [["Film de protection", 1], ["Panneaux de protection", 1], ["Consommables de protection", 1]], 0.8, "protection ouvrages conserves film panneau bachage maintenus"],
    ["00.05", "Évacuation des déchets, tri et taxes comprises", "m3", 0.45, [["Évacuation déchets", 1]], 8, "evacuation dechets tri taxes container conteneur decharge"],
    ["00.06", "Dossier as-built, PV de réception, garanties", "FF", 6, [["Forfait contrôle et réception", 0.35]], 0, "as built pv reception garanties dossier"],
    ["01.01", "Piquage d’enduit dégradé", "m2", 0.22, [["Consommables démolition", 1]], 2, "piquage enduit degrade demolition facade enduits"],
    ["01.02", "Démolition de cloison légère", "m2", 0.3, [["Consommables démolition", 1]], 3, "demolition cloison legere cloisons depose"],
    ["01.03", "Dépose de plafond existant", "m2", 0.2, [["Consommables démolition", 1]], 2.5, "depose plafond existant faux plafonds demolition"],
    ["01.04", "Dépose de menuiserie extérieure", "pce", 1.25, [["Consommables démolition", 2]], 12, "depose menuiserie exterieure chassis porte exterieurs"],
    ["01.05", "Dépose de revêtements de sol et chape existante", "m2", 0.28, [["Consommables démolition", 1.2]], 4, "depose revetement sol chape existante"],
    ["01.06", "Dépose d’appareils sanitaires et tuyauterie", "pce", 1.1, [["Consommables démolition", 1.5]], 10, "depose sanitaires tuyauterie appareil"],
    ["01.07", "Sciage de béton armé et découpe de trémie", "m", 1.25, [["Sciage béton armé", 1]], 12, "sciage beton arme decoupe tremie escalier"],
    ["02.01", "Maçonnerie de rebouchage en briques", "m2", 0.75, [["Briques", 1], ["Mortier de maçonnerie", 1]], 6, "maconnerie rebouchage briques baies"],
    ["02.02", "Rejointoiement de maçonnerie, mortier de chaux", "m2", 0.32, [["Mortier de chaux", 1]], 3, "rejointoiement maconnerie mortier chaux naturelle"],
    ["02.03", "Réparation de béton dégradé, passivation des aciers", "m2", 0.7, [["Mortier de réparation béton", 1], ["Primaire d’accrochage béton", 1], ["Passivant anticorrosion", 1]], 5, "reparation beton degrade betons passivation aciers armatures"],
    ["02.04", "Pose de linteau préfabriqué, étançonnement compris", "m", 0.9, [["Linteau préfabriqué", 1]], 12, "pose linteau prefabrique etanconnement"],
    ["02.05", "Seuil en pierre bleue, pose comprise", "m", 0.85, [["Pierre bleue", 1]], 8, "seuil seuils appui appuis pierre bleue pose"],
    ["03.01", "Nettoyage haute pression de façade", "m2", 0.08, [["Consommables démolition", 0.5]], 2.5, "nettoyage haute pression facade"],
    ["03.02", "Enduit de façade minéral armé", "m2", 0.35, [["Enduit de façade", 1], ["Treillis d’armature façade", 1], ["Accessoires d’enduit (baguettes, profilés)", 1]], 4.5, "enduit facade mineral arme crepi treillis armature"],
    ["03.03", "Peinture de façade siloxane", "m2", 0.16, [["Primaire façade", 1], ["Peinture façade siloxane", 1]], 2, "peinture facade siloxane exterieur"],
    ["03.04", "Solin, relevé et couvre-mur", "m", 0.45, [["Solin et couvre-mur", 1]], 5, "solin releve couvre mur zinc etancheite"],
    ["03.05", "Cimentage hydrofuge de soubassement", "m2", 0.3, [["Cimentage hydrofuge", 1]], 3, "cimentage hydrofuge soubassement"],
    ["04.01", "Étanchéité bitumineuse bicouche", "m2", 0.28, [["Étanchéité bitumineuse", 1]], 5, "etancheite bitumineuse bicouche roofing toiture plate"],
    ["04.02", "Étanchéité EPDM collée", "m2", 0.24, [["Membrane EPDM", 1], ["Colle de fixation EPDM", 1]], 4, "etancheite epdm collee membrane"],
    ["04.03", "Étanchéité liquide sous carrelage", "m2", 0.18, [["Étanchéité liquide", 1]], 2.5, "etancheite liquide sous carrelage sanitaires"],
    ["04.04", "Évacuation PVC diamètre 110", "m", 0.38, [["Tube PVC évacuation 110", 1], ["Raccords PVC évacuation 110", 1]], 4, "evacuation pvc 110 tuyauterie descente descentes eau pluviale"],
    ["05.01", "Isolation PIR 80 mm sous plafond", "m2", 0.18, [["PIR 80 mm", 1]], 2.5, "isolation pir 80 sous plafond dalle panneaux"],
    ["05.02", "Isolation laine minérale 100 mm", "m2", 0.16, [["Laine minérale 100 mm", 1]], 2, "isolation laine minerale 100 ossature bois"],
    ["05.03", "Pare-vapeur et étanchéité à l’air", "m2", 0.11, [["Membrane pare-vapeur", 1], ["Adhésifs pare-vapeur", 1]], 1.2, "pare vapeur etancheite air membrane"],
    ["06.01", "Chape de ravoirage armée 6 cm", "m2", 0.28, [["Chape armée", 1]], 4, "chape ravoirage armee 6 cm"],
    ["06.02", "Plafonnage sur maçonnerie, deux couches", "m2", 0.38, [["Plâtre et enduit intérieur", 1]], 2.5, "plafonnage maconnerie maconneries deux couches dressees"],
    ["06.03", "Faux plafond BA13 sur ossature", "m2", 0.42, [["Plaque BA13", 1], ["Rails et montants", 1], ["Suspentes et fixations BA13", 1]], 3.5, "faux plafond ba13 plaques ossature"],
    ["06.04", "Faïence murale, profilés de finition compris", "m2", 0.62, [["Faïence murale", 1], ["Colle carrelage mural", 1]], 5, "faience murale profiles finition carrelage mural sanitaires"],
    ["06.05", "Carrelage de sol grès cérame", "m2", 0.55, [["Grès cérame", 1], ["Colle carrelage sol", 1], ["Joints carrelage sol", 1]], 5, "carrelage sol gres cerame"],
    ["06.06", "Rebouchage et enduit de rattrapage sur linteaux", "m", 0.32, [["Plâtre et enduit intérieur", 0.35]], 2.5, "rebouchage enduit rattrapage linteaux"],
    ["06.07", "Cornières et profilés de finition", "m", 0.12, [["Profilés de finition", 1]], 1, "cornieres profiles finition"],
    ["07.01", "Peinture murs intérieurs, deux couches", "m2", 0.15, [["Primaire intérieur", 1], ["Peinture intérieure", 1]], 1.5, "peinture murs interieurs deux couches"],
    ["07.02", "Peinture plafonds intérieurs, deux couches", "m2", 0.17, [["Primaire intérieur", 1.1], ["Peinture intérieure", 1.1]], 1.5, "peinture plafonds interieurs deux couches"],
    ["07.03", "Peinture sur menuiseries bois, ponçage compris", "m2", 0.38, [["Primaire bois", 1], ["Peinture bois", 1]], 3, "peinture menuiseries bois poncage"],
    ["07.04", "Enduit de lissage avant peinture", "m2", 0.18, [["Plâtre et enduit intérieur", 0.55]], 1.5, "enduit lissage avant mise peinture"],
    ["08.01", "Châssis PVC double vitrage", "m2", 1.2, [["Châssis PVC double vitrage", 1]], 25, "chassis pvc double vitrage menuiserie exterieure pose"],
    ["08.02", "Porte d’entrée bois massif", "pce", 3.5, [["Porte bois massif", 1]], 45, "porte entree bois massif menuiserie quincaillerie"],
    ["08.03", "Garde-corps acier thermolaqué", "m", 0.9, [["Garde-corps acier", 1]], 18, "garde corps acier thermolaque"],
    ["08.04", "WC suspendu complet, bâti-support inclus", "pce", 3.2, [["Cuvette suspendue", 1], ["Bâti-support WC", 1], ["Accessoires WC (fixation, plaque de commande)", 1]], 35, "wc suspendu complet bati support sanitaire"],
    ["08.05", "Essais d’étanchéité, rinçage, mise en service", "FF", 5, [["Forfait contrôle et réception", 0.45]], 0, "essais etancheite rincage mise service"],
    ["08.06", "Alimentation multicouche diamètre 16", "m", 0.24, [["Tube multicouche diamètre 16", 1], ["Raccords multicouche diamètre 16", 1]], 2.5, "alimentation multicouche 16 tube tuyauterie sanitaire"],
    ["09.01", "Prise de courant 2P+T encastrée", "pce", 0.65, [["Blochet d’encastrement", 1], ["Prise 2P+T", 1], ["Câble d’alimentation prise", 1]], 6, "prise prises courant 2pt encastree encastrees electricite"],
    ["09.02", "Mise à la terre et liaisons équipotentielles RGIE", "FF", 7, [["Forfait contrôle et réception", 0.65]], 80, "mise terre liaisons equipotentielles rgie"],
    ["09.03", "Contrôle de conformité par organisme agréé", "FF", 2, [["Forfait contrôle et réception", 1]], 0, "controle conformite organisme agree rgie"],
    // Pas de code de metre pre-enregistre ici : "09.04" n'est qu'un numero de
    // lot/poste generique, propre au marche d'origine de cet exemple. Un vrai poste
    // 09.04 d'un autre marche n'a aucune raison de designer ce meme ouvrage "pour
    // memoire" — un code connu errone ferait disparaitre un poste bien reel derriere
    // un prix quasi nul, avec une confiance de 100 % qui masque le probleme.
    ["", "Mobilier de vestiaire (pour mémoire, hors marché)", "pce", 0, [["Mobilier vestiaire", 1]], 0, "mobilier vestiaire pour memoire hors marche"],
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


  /*
   * Recettes techniques : la composition typique d'un ouvrage courant, proposée quand
   * un poste de métré n'a été reconnu ni par un code communal, ni par un ouvrage
   * proche. C'est le dernier maillon avant la saisie à la main.
   *
   * Ce sont des POINTS DE DÉPART À VALIDER, pas des références. Les rendements et les
   * prix indicatifs viennent de l'usage courant du métier, pas d'un relevé chez un
   * fournisseur : l'application le dit à chaque proposition, et l'entrepreneur corrige
   * avant d'enregistrer. Le retour de chantier fera ensuite son travail habituel.
   *
   * exige : tous ces mots doivent être présents dans le libellé du poste.
   * parmi : au moins un, quand la liste n'est pas vide — c'est ce qui distingue un
   *         joint de dilatation EN TOITURE d'un joint de dilatation dans une chape.
   */
  const recettes = [
    {
      id: "eta-joint-dilatation-toiture",
      nom: "Remise en état de joint de dilatation en toiture",
      unite: "m",
      exige: ["joint", "dilatation"],
      parmi: ["toiture", "terrasse", "acrotere", "etancheite"],
      heures: 0.45,
      materiel: 1.5,
      motsCles: "joint dilatation toiture terrasse etancheite mastic fond de joint",
      note:
        "Rendement pour un joint de 20 à 30 mm : dégarnissage, nettoyage, primaire, " +
        "fond de joint et mastic. Au-delà de 40 mm ou avec couvre-joint métallique, " +
        "comptez davantage et ajoutez la fourniture correspondante.",
      composants: [
        { materiau: "Fond de joint mousse", unite: "m", quantite: 1.05, prixIndicatif: 0.9 },
        { materiau: "Mastic polyuréthane, cartouche 600 ml", unite: "pce", quantite: 0.35, prixIndicatif: 9.5 },
        { materiau: "Primaire d'accrochage pour joint", unite: "m", quantite: 1, prixIndicatif: 0.6 },
      ],
    },
    {
      id: "eta-solin-couvre-mur",
      nom: "Solin, relevé et couvre-mur",
      unite: "m",
      exige: ["solin"],
      parmi: [],
      heures: 0.6,
      materiel: 2,
      motsCles: "solin releve couvre mur etancheite zinc",
      note:
        "Dépose de l'ancien solin, engravure, relevé et couvre-mur. La fourniture est " +
        "chiffrée en zinc : en aluminium laqué ou en inox, corrigez le prix matière.",
      composants: [
        { materiau: "Zinc pour solin et couvre-mur", unite: "m", quantite: 1.1, prixIndicatif: 22 },
        { materiau: "Bande d'étanchéité de relevé", unite: "m", quantite: 1.05, prixIndicatif: 7.5 },
        { materiau: "Mastic polyuréthane, cartouche 600 ml", unite: "pce", quantite: 0.2, prixIndicatif: 9.5 },
      ],
    },
    {
      id: "eta-joint-facade-mastic",
      nom: "Réfection de joint souple en façade",
      unite: "m",
      exige: ["joint"],
      parmi: ["facade", "mastic", "souple", "elastique"],
      heures: 0.3,
      materiel: 0.8,
      motsCles: "joint souple facade mastic elastique fond de joint",
      note:
        "Dégarnissage, fond de joint et mastic élastique. Ne couvre pas le " +
        "rejointoiement d'une maçonnerie au mortier, qui est un autre ouvrage.",
      composants: [
        { materiau: "Fond de joint mousse", unite: "m", quantite: 1.05, prixIndicatif: 0.9 },
        { materiau: "Mastic polyuréthane, cartouche 600 ml", unite: "pce", quantite: 0.25, prixIndicatif: 9.5 },
      ],
    },
  ];

  root.DGCatalog = {
    defaultSettings,
    defaultEntrepreneur,
    defaultDevis,
    materiaux,
    ouvrages,
    referencesConnues,
    recettes,
    lotLabels,
  };
})(globalThis);
