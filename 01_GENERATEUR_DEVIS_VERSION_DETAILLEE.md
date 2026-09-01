# À quoi sert le Générateur de devis ?

Le **Générateur de devis** est une application destinée aux entreprises du bâtiment pour les aider à **calculer plus facilement et plus précisément le prix de leurs travaux**.

Son objectif est simple : éviter de devoir recalculer manuellement le prix de chaque poste d’un devis ou d’un cahier des charges.

L’application mémorise progressivement la manière dont l’entreprise travaille : le coût de sa main-d’œuvre, le prix de ses matériaux, le temps nécessaire pour réaliser certains travaux et les différents frais qu’elle doit couvrir.

À partir de ces informations, elle peut calculer automatiquement un prix de vente cohérent.

## Un exemple simple

Imaginons qu’une entreprise doive remettre un prix pour réaliser **100 m² d’enduit de façade**.

Pour calculer correctement son prix, elle doit savoir plusieurs choses :

- combien d’heures de travail sont nécessaires pour réaliser 1 m² ;
- combien coûte une heure de travail à l’entreprise ;
- quelle quantité d’enduit est nécessaire par m² ;
- combien coûte cet enduit ;
- quel matériel est nécessaire ;
- quels sont les frais généraux de l’entreprise ;
- quelle marge doit être appliquée.

Le Générateur de devis rassemble toutes ces informations et effectue automatiquement le calcul.

```text
Main-d'œuvre          25 €
Matériaux             20 €
Matériel               5 €
                      ----
Coût du travail       50 €

+ frais de l'entreprise
+ imprévus
+ marge

Prix de vente         67 € / m²
```

L’entreprise ne doit donc plus refaire tous ces calculs pour chaque nouveau devis.

## Une bibliothèque des travaux de l'entreprise

Le cœur de l'application est une **bibliothèque de travaux**.

On peut par exemple y trouver :

```text
Peinture murale
Pose de carrelage
Enduit de façade
Isolation
Faux plafond
Démolition
Maçonnerie
Étanchéité
...
```

Dans l'application, ces travaux sont appelés des **ouvrages**.

Pour chacun d'eux, l'application connaît sa composition.

Par exemple :

```text
1 m² d'enduit de façade

nécessite :

→ du temps de travail
→ une certaine quantité d'enduit
→ éventuellement un isolant
→ des accessoires
→ du matériel
```

Cette bibliothèque constitue progressivement la mémoire de l'entreprise.

## Le prix de la main-d'œuvre

L'application tient compte du **coût réel d'une heure de travail pour l'entreprise**.

Il ne s'agit pas simplement du salaire payé à l'ouvrier.

Le coût peut notamment comprendre le salaire et les différentes charges supportées par l'employeur.

L'application peut ainsi déterminer combien coûte réellement la main-d'œuvre nécessaire pour effectuer un travail.

## Le temps nécessaire pour réaliser les travaux

Un autre élément très important est le **rendement**.

Il indique combien de temps l'entreprise met normalement pour effectuer un travail.

Par exemple :

```text
50 m² réalisés
par 2 personnes
pendant 7 heures
```

représentent :

```text
14 heures de travail
pour 50 m²
```

soit :

```text
0,28 heure par m²
```

L'application peut utiliser cette information pour calculer les prochains devis.

Et surtout, les rendements peuvent être corrigés à partir de **chantiers réellement réalisés**.

Au fil du temps, les estimations deviennent donc plus proches de la manière dont l'entreprise travaille réellement.

## Le prix des matériaux

L'application possède également une bibliothèque de matériaux.

Par exemple :

```text
Enduit
Peinture
Carrelage
Isolant
Mortier
Silicone
Membrane d'étanchéité
...
```

Chaque matériau possède un prix.

L'objectif est également de pouvoir conserver des informations telles que :

```text
Fournisseur
Référence du produit
Conditionnement
Prix
Date du prix
```

Par exemple :

```text
Enduit façade

Fournisseur :       fournisseur habituel
Conditionnement :   sac de 25 kg
Prix du sac :       87,50 €

Prix calculé :      3,50 €/kg
```

Cela permet de travailler avec des prix réellement constatés plutôt qu'avec de simples estimations.

## Les frais et la marge de l'entreprise

Le prix des ouvriers et des matériaux ne suffit pas pour déterminer le prix de vente.

L'entreprise doit également couvrir ses autres dépenses.

Le Générateur de devis permet donc de tenir compte notamment :

- des frais généraux ;
- des frais liés au chantier ;
- des imprévus ;
- de la marge souhaitée.

Le prix proposé au client est donc construit à partir du **coût réel estimé du travail**, auquel sont ajoutés les frais et la marge définis par l'entreprise.

## Créer un devis pour un client

L'application permet de créer directement un devis.

L'utilisateur indique par exemple :

```text
Client
Adresse du chantier
Objet des travaux
TVA
```

Il sélectionne ensuite les travaux :

```text
Peinture murale       125 m²
Faux plafond           42 m²
Carrelage              36 m²
```

L'application récupère automatiquement les prix calculés dans la bibliothèque et calcule :

```text
Total HTVA
TVA
Total TVAC
```

Elle peut ensuite produire un fichier Excel qui peut servir de base au devis destiné au client.

## Répondre à un marché public

L'une des fonctions les plus intéressantes de l'application concerne les **métrés ou bordereaux de prix reçus dans le cadre des marchés publics**.

Dans ce cas, l'entreprise reçoit généralement un fichier Excel contenant parfois des dizaines ou des centaines de postes à chiffrer.

Par exemple :

```text
01.01   Démolition cloison          45 m²
01.02   Maçonnerie                  28 m²
02.01   Isolation façade           120 m²
02.02   Enduit extérieur           120 m²
...
```

Il faut normalement retrouver chaque travail, déterminer son prix et reporter celui-ci dans le fichier.

L'application automatise une grande partie de cette opération.

## L'application analyse automatiquement le fichier Excel

Lorsqu'un métré est chargé, elle cherche à reconnaître :

```text
le numéro du poste
la description
l'unité
la quantité
la colonne du prix unitaire
```

Elle peut également travailler avec plusieurs feuilles Excel.

L'utilisateur peut vérifier les colonnes détectées avant de continuer.

## Elle recherche le travail correspondant

Les descriptions utilisées dans les cahiers des charges ne sont pas toujours les mêmes que celles utilisées par l'entreprise.

Un cahier des charges peut par exemple parler de :

```text
carrelage mural
```

alors que l'entreprise utilise le terme :

```text
faïence
```

L'application possède donc un système de vocabulaire et de rapprochement des descriptions.

Elle recherche dans la bibliothèque les travaux qui ressemblent au poste demandé.

Mais elle **ne décide pas seule**.

Elle propose une correspondance et l'utilisateur peut la confirmer ou la modifier.

Le principe est :

```text
L'application propose
        ↓
L'utilisateur contrôle
        ↓
L'application calcule
```

## Elle contrôle également les unités

L'application évite certaines erreurs évidentes.

Par exemple, elle ne doit pas associer :

```text
10 mètres de tuyauterie
```

avec un ouvrage calculé :

```text
au m²
```

Les unités doivent être compatibles.

## Elle remplit ensuite le fichier reçu

Lorsque les correspondances ont été validées, l'application calcule les prix et les reporte dans le **fichier Excel d'origine**.

Elle essaie de conserver :

```text
les feuilles
la présentation
les formules
les sous-totaux
les totaux
```

Le but est de rendre au pouvoir adjudicateur son propre document, mais avec les prix complétés.

## Elle détecte aussi des problèmes

Avant de produire le résultat, l'application peut signaler différents problèmes :

```text
quantité manquante
quantité incorrecte
poste présent plusieurs fois
unité incompatible
poste que l'application ne sait pas chiffrer
colonne non reconnue
```

L'objectif est d'éviter qu'une erreur passe inaperçue.

## L'application apprend aussi les correspondances

Supposons qu'un pouvoir adjudicateur utilise régulièrement :

```text
04.12
Enduit minéral sur isolant
```

et que l'entreprise ait indiqué que ce poste correspond à son ouvrage :

```text
40.20
Enduit de façade
```

Cette correspondance peut être conservée.

Lors d'un prochain marché utilisant la même codification, elle pourra être réutilisée.

Cela permet de gagner progressivement du temps.

## Contrôler et justifier un prix

L'application ne se contente pas d'afficher :

```text
Enduit façade : 67 €/m²
```

Elle peut également expliquer **comment ce prix a été obtenu**.

Par exemple :

```text
Main-d'œuvre       25,00 €
Enduit             18,00 €
Accessoires         2,50 €
Matériel            4,50 €
                   -------
Coût direct         50,00 €

Frais + marge       16,62 €

Prix proposé        66,62 €/m²
```

Cette décomposition permet de contrôler le calcul et peut également aider lorsqu'il faut expliquer ou justifier un prix.

## Une application qui peut s'améliorer avec les chantiers

Le Générateur de devis peut progressivement passer d'une bibliothèque contenant des estimations à une bibliothèque construite à partir de **l'expérience réelle de l'entreprise**.

Après un chantier, on peut comparer :

```text
Ce que nous avions prévu
          ↓
Ce qui s'est réellement passé
```

Par exemple :

```text
Prévision :
0,40 heure/m²

Réalité du chantier :
0,55 heure/m²
```

L'entreprise peut alors corriger son rendement.

Même principe pour les matériaux :

```text
Prix prévu :
3,80 €/kg

Prix réellement payé :
3,42 €/kg
```

La bibliothèque peut être actualisée et le devis suivant devient ainsi plus précis.

## En résumé

Le Générateur de devis fonctionne comme une **mémoire de chiffrage de l'entreprise**.

Il rassemble :

```text
le coût de la main-d'œuvre
+
le temps nécessaire pour travailler
+
le prix des matériaux
+
le matériel nécessaire
+
les frais de l'entreprise
+
la marge
```

pour obtenir :

```text
UN PRIX DE VENTE
```

Il peut ensuite utiliser ces prix pour créer un devis client ou compléter un métré de marché public.

Sa véritable valeur apparaît avec le temps :

```text
DEVIS
   ↓
CHANTIER
   ↓
TEMPS ET COÛTS RÉELS
   ↓
CORRECTION DE LA BIBLIOTHÈQUE
   ↓
DEVIS SUIVANT PLUS PRÉCIS
```

Le Générateur de devis n'est donc pas simplement un programme qui remplit un fichier Excel.

C'est un outil destiné à aider une entreprise du bâtiment à **construire, conserver et améliorer sa propre méthode de calcul des prix**.
