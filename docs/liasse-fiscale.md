# Liasse fiscale

Le guide d'utilisation (à quoi sert la liasse, comment la préparer et la déposer) est sur le site : [La liasse fiscale](https://www.kledg.com/fr/docs/la-liasse-fiscale). Cette page décrit le fonctionnement technique : code, API, règles de calcul, contrôles, droits et limites.

La page États, Liasse fiscale (`/reports/liasse-fiscale`) réunit tous les tableaux de la déclaration de résultat d'une société à l'impôt sur les sociétés, selon son régime à la clôture (`corporateTaxStatusOf`, `lib/corporate-tax/load-corporate-tax.service.ts`, avec l'historique des régimes) :

- régime simplifié (CGI art. 302 septies A bis) : déclaration 2065-SD et tableaux 2033-A-SD à 2033-G-SD ;
- régime réel normal (CGI art. 53 A) : déclaration 2065-SD et tableaux 2050-SD à 2059-G-SD.

Pour chaque tableau, la page dit où Kledg le prépare : sur cette page (case par case), sur une autre page (bilan, compte de résultat, impôt sur les sociétés, immobilisations), ou nulle part (à remplir à la main). Code : `lib/liasse` ; API `GET /api/reports/liasse` et `GET /api/reports/liasse/export?format=pdf|csv` ; outils MCP `get_liasse_fiscale` et `export_report` (rapport `liasse`), voir [mcp.md](mcp.md).

Une société qui n'est pas à l'impôt sur les sociétés (impôt sur le revenu, micro) n'a pas de tableau (statut `not-subject`) ; une société dont le régime n'est pas renseigné est invitée à le choisir (`missing-regime`).

## La règle : ce que les livres ne disent pas est demandé

Chaque case d'un tableau préparé ici est une cellule (`lib/liasse/cells.ts`) avec le code de la case imprimé sur le formulaire et son origine :

| Origine | Sens |
|---|---|
| `books` (Écritures) | Écritures validées de l'exercice, à-nouveaux compris, écriture de clôture exclue |
| `record` (Fiche Kledg) | Informations de la société, associés, registre des provisions, sociétés du groupe |
| `worksheet` (Calcul IS) | Calcul de la page Impôt sur les sociétés ([impot-societes.md](impot-societes.md)) |
| `answer` (Réponse) | Réponse donnée dans l'annexe ou sur la page Approbation des comptes |
| `manual` (À remplir à la main) | Rien dans Kledg ne le dit : la cellule n'a pas de valeur, seulement la raison, et parfois un repère tiré des comptes (jamais la réponse) |

Un total qui additionne des cases à remplir à la main les compte pour zéro et les nomme (`pending`), pour qu'un total n'ait jamais l'air complet quand il ne l'est pas.

## Tableaux du régime simplifié

Formulaires vérifiés le 11 novembre 2026 : liasse n° 2033-SD 2026 (cerfa 15948*08), notice n° 2033-NOT-SD 2026, formulaire n° 2065-SD 2026 (cerfa 11084*28) et sa notice.

| Tableau | Où | Cases calculées | À remplir à la main |
|---|---|---|---|
| 2065-SD et 2065 bis-SD | Ici | Exercice, régime (cases à cocher), désignation, adresse du siège, SIRET du siège, mél, bénéfice imposable au taux normal, à 15 %, déficit (calcul IS), comptabilité informatisée (oui, Kledg) | Groupe fiscal, PME innovantes, taxation au tonnage, activité (repère : code APE), plus-values, abattements et exonérations, CES et CTM, imputations, revenus locatifs, professionnels et signataire, cadres G (distributions), H (rémunérations des associés), I (divers), J (salaires DSN, repère : compte 641 ; rétrocessions ; moins-values à long terme), K |
| 2033-A-SD | Page Bilan, présentation simplifiée | Toutes les cases (010 à 180) | |
| 2033-B-SD | Pages Compte de résultat (cadre A) et Impôt sur les sociétés (cadre B, lignes 310 à 372) | Voir [impot-societes.md](impot-societes.md) | Ce que le calcul de l'IS liste comme non lu dans les livres |
| 2033-C-SD | Page Immobilisations (2054, 2055) | Cadres I et II ([annexe-et-2054.md](annexe-et-2054.md)) | Cadre III (plus et moins-values) |
| 2033-D-SD | Ici | Cadre I A (600 à 686 sauf 601 à 607 quand le compte 145 a bougé), I B (770 et 775 ; tout à zéro sans amortissement dérogatoire), I C (dotations des provisions non déductibles du registre, total 780), cadre II (982, 983, 984, 860, 870), cadre III (374, 378) | 601 à 607 (majorations de 30 %), I B par ligne d'immobilisation quand le compte 145 a bougé, I C ligne 1 (congés payés, régime optionnel) et charges à payer non déductibles, 982 bis et 982 ter, 381, 325, 327, 399, 398, 397, cadre IV (690 à 693) |
| 2033-E-SD | Ici | Exercice et durée en mois, effectif moyen (376, si répondu), 108, 118, 115, 113, 111, 121, 145, 125, 148, totaux 106, 144, 152, valeur ajoutée 137, chiffre d'affaires ramené à 12 mois (022), période de référence (024, 016) | 657, 651, 861, 119, 143 (repère : 72), 153 (repère : 7714), 310 (repère : 612 et 613), 133 (repère : 63), 128, 135, 150, 117, 020, 023, 026, date de cessation |
| 2033-F-SD | Ici | Identification, 901 à 906, cadre I (forme, dénomination, SIREN, pourcentage, parts, adresse) et cadre II (nom, prénoms, nom d'usage, pourcentage, parts) des associés à 10 % ou plus | Titre (civilité), date et lieu de naissance et adresse des personnes physiques : enregistrés sur la fiche de l'associé, jamais recopiés par Kledg ; ce que les fiches n'ont pas |
| 2033-G-SD | Ici | Identification, 905, forme, dénomination, SIREN, pourcentage, adresse des sociétés détenues à 10 % ou plus | 905 quand une filiale n'est pas accessible ; forme et adresse d'une participation hors Kledg |

### Règles de calcul

- **Provisions (2033-D cadre I A)** (`lib/liasse/provisions.ts`) : comptes 145 (amortissements dérogatoires), autres 14 (provisions réglementées), 15 (risques et charges), 29 (immobilisations), 39 (stocks et en-cours), 491 (comptes clients), autres 49 et 59 (autres dépréciations), le préfixe le plus précis l'emporte (PCG art. 932-1, plan modifié par le règlement ANC n° 2022-06). À-nouveaux au début, crédits en dotations, débits en reprises, somme algébrique à la fin ; une écriture et sa contre-passation du même exercice s'annulent, comme pour le 2054.
- **Provisions non déductibles (cadre I C)** : la déductibilité n'est connue que pour les provisions du registre (indicateur `taxDeductible`, CGI art. 39, 1-5° et 39, 2). Les dotations validées de l'exercice des provisions marquées non déductibles forment le total 780, à reporter ligne 322 du 2033-B-SD : Kledg le signale, il ne l'ajoute pas lui-même au calcul de l'IS.
- **Déficits (cadre II)** (`lib/liasse/deficits.ts`) : ceux du calcul de l'IS (déficits reportés d'après les déclarations enregistrées, imputation de l'article 209, I du CGI). 984 = 982 - 983, sans les déficits transférés de plein droit (982 bis) que Kledg ne suit pas ; 870 = 984 + 860. Sans déficits connus à l'ouverture, les cases sont à remplir.
- **TVA (374, 378)** (`lib/liasse/vat.ts`) : TVA collectée, crédits moins débits des comptes 4457 sauf 44574 (TVA en attente, comptée quand elle devient exigible) ; TVA déductible sur biens et services, débits moins crédits de 44566 (44562, immobilisations, exclu par le libellé du formulaire). Écritures de liquidation (celles qui touchent 4455 ou 44567, PCG art. 944-44) et à-nouveaux exclus.
- **Valeur ajoutée (2033-E)** (`lib/liasse/value-added.ts`) : comptes nommés par la notice 2033-NOT-SD (BOI-CVAE-BASE-20) : 701 à 709 (108), 751 (118), 752 à 758 sauf 755 (115), 74 (113), solde de 603 et 713 ensemble (111 s'il est créditeur, 145 s'il est débiteur), 601 à 609 sauf 603 (121), 61 et 62 sauf 612 et 613 (125), 651 à 658 sauf 655 (148). Depuis le règlement ANC n° 2022-06, les cessions d'immobilisations courantes passent en 757 et 657 : elles sont dans 115 et 148. Le tableau est dû au-delà de 152 500 € de chiffre d'affaires ramené à douze mois (notice) ; en dessous, la page le dit.
- **Capital (2033-F)** (`lib/liasse/capital.ts`) : la composition du capital (`lib/reports/capital-composition`), seuil de 10 % (annexe III au CGI, art. 38) apprécié sur le nombre de parts quand il est connu. Une entreprise individuelle ne sert ni le 2033-F ni le 2033-G (notice).
- **Filiales (2033-G)** : sociétés de Kledg dont les associés nomment la société (vue groupe, `lib/group/get-participations.service.ts`), lues avec les droits de l'utilisateur dans chacune, et participations hors Kledg répondues dans l'annexe.
- **Résultat (2065-SD)** (`lib/liasse/form-2065.ts`) : la notice demande de ventiler le résultat fiscal par taux ; Kledg reprend la base au taux réduit et la base au taux normal du calcul de l'IS, et le déficit de l'exercice.

## Tableaux du régime réel normal

Formulaires vérifiés le 11 novembre 2026 : liasse n° 2050 2026 (tableaux 2050-SD à 2059-G-SD) et notice n° 2032-NOT-SD 2026.

| Tableau | Où | Cases calculées | À remplir à la main |
|---|---|---|---|
| 2065-SD et 2065 bis-SD | Ici | Comme au régime simplifié | Comme au régime simplifié, sans le cadre J |
| 2050-SD à 2053-SD | Pages Bilan et Compte de résultat, présentation complète | Toutes les cases | |
| 2054-SD, 2055-SD | Page Immobilisations (2054, 2055) | 2054 et 2055 cadre A | Valeur d'origine des immobilisations réévaluées, 2055 cadres B et C |
| 2054 bis-SD | Nulle part | | Tout (réévaluation légale) |
| 2056-SD | Ici | 3V, 3X, 3Y, 3Z, 4A à 5E, EO à ER, 5V à 5Y, 5Z, 6A à 6H, 9U à 9X, 06 à 09, 6N à 7C et leurs colonnes, UB à UD, UE à UK ; 3T, 3U, IJ, 5R à zéro quand la ligne « autres » qui en comprend les comptes est vide ; 02 à 05 toujours à zéro (pas de compte de titres mis en équivalence) | D3 à D6 (majorations de 30 %) quand le compte 145 a bougé ; 3T, 3U, IJ, 5R quand la ligne « autres » a bougé ; case 10 |
| 2057-SD | Ici | Montant brut de chaque ligne (UL à VS, 7Y à 8L sauf VG et VH avec un emprunt 164), UL à UW, totaux VT, VU, VV, VY, VZ et colonnes des dettes quand l'annexe dit qu'aucune créance ou dette n'est à plus d'un an, ou d'après la part répondue ; VD, VE, VJ, VK | Z1, UO, VX, Z2 ; VG et VH avec un emprunt 164 (repères) ; la ventilation ligne par ligne quand une part est à plus d'un an ; VF, VL (repères : 455) |
| 2058-A-SD | Page Impôt sur les sociétés | Lignes WA à XO ([impot-societes.md](impot-societes.md)) | Ce que le calcul de l'IS liste comme non lu dans les livres |
| 2058-B-SD | Ici | Cadre I (K4, K5, K6, YJ, YK) ; cadre III : dotations et reprises des provisions non déductibles du registre (8X à 9C, 9D à 9J), totaux YN et YO | K4 bis, K4 ter, ZT, ZV, ZW, charges à payer non déductibles (9K à 9T), L1 |
| 2058-C-SD | Ici | Affectation : 0C, 0D, 0E, 0F, ZB, ZD, ZE, ZG, ZH ; renseignements : YT, XQ, YU, SS, YV, ST, ZJ, YW, 9Z, YX, YY, YZ, ZR | ZF, YQ, J7, YR (repère : engagements de crédit-bail de l'annexe), YS, J8, ES (repère : 6281), ZS, 0B (repère : 641), 0S, ZK, RG, RH, régime de groupe (JA à JJ), JQ à JT |
| 2059-A-SD à 2059-D-SD | Nulle part | | Tout (plus et moins-values, moins-values à long terme, réserve spéciale) |
| 2059-E-SD | Ici | Comme le 2033-E, avec les codes YP, OA à OG, GX, GY, GZ | YF, YG, RL, OL, OE, XT, OS, OZ, OU, O9, OY, SA, EV, EY, HX, HR |
| 2059-F-SD | Ici | Comme le 2033-F, avec les codes P1 à P6 ; SIRET de l'établissement du siège | Comme le 2033-F ; SIRET sans établissement du siège |
| 2059-G-SD | Ici | Comme le 2033-G, nombre de filiales en P5 | Comme le 2033-G |

### Règles de calcul du régime normal

- **2056** (`lib/liasse/form-2056.ts`) : mêmes mouvements que le 2033-D, ligne par ligne des comptes du plan : 143 (hausse des prix), 145, autres 14 ; 1511, 1512, 1514, 1515, 1521, 1523, 1524, 1525, autres 15 ; 290, 291 à 293, 2961, autres 29 ; 39 ; 491 ; autres 49 et 59. Les lignes sans compte propre (gisements, investissement, prêts d'installation, congés à payer) valent zéro quand la ligne qui en comprend les comptes est vide, sinon elles sont à ventiler à la main. « Dont dotations et reprises » vient du compte de résultat : 6815 à 6817 et 7815 à 7817 (exploitation), 6865, 6866 et 7865, 7866 (financières), 6872 à 6876 et 7872 à 7876 (exceptionnelles).
- **2057** (`lib/liasse/form-2057.ts`) : montants bruts avant dépréciation (notice 2032-NOT-SD), solde de chaque compte à la clôture, débiteur pour une créance et créditeur pour une dette, avec les comptes de l'état des créances et de l'état des dettes de l'annexe (PCG art. 832-9 et 832-15) ; le préfixe le plus précis choisit la ligne. Les échéances viennent des réponses de l'annexe : sans part à plus d'un an, tout est à un an au plus ; avec une part, les totaux en viennent et la ventilation ligne par ligne est à faire. Les découverts (512, 514, 517, 519 créditeurs) sont à un an au plus à l'origine ; la durée à l'origine des emprunts 164 n'est pas connue. Renvois : prêts accordés et remboursés (débits et crédits de 274), emprunts souscrits et remboursés (crédits et débits de 16, sans 1688 ni 169).
- **2058-B** (`lib/liasse/form-2058b.ts`) : déficits du calcul de l'IS (comme le cadre II du 2033-D) ; provisions non déductibles du registre, une par emplacement du formulaire, les suivantes additionnées dans le dernier emplacement (le formulaire demande le détail sur feuillet séparé). YN et YO se reportent lignes WI et WU du 2058-A : Kledg le signale.
- **2058-C** (`lib/liasse/form-2058c.ts`) : le tableau d'affectation montre l'affectation, faite pendant l'exercice déclaré, du résultat de l'exercice précédent : report à nouveau à l'ouverture (0C, 11), résultat à l'ouverture (0D, 12), prélèvements sur réserves (0E, débits de 106) ; réserve légale (ZB, crédits de 1061), autres réserves (ZD, crédits des autres 106), dividendes (ZE, crédits de 457), report à nouveau à la clôture (ZG, 11). Renseignements divers : détail de la ligne FW du 2052 (604, 605, 606, 608, 609, 61, 62) et de la ligne FX (63, dont 63511 pour la CFE et la CVAE), TVA de l'exercice comme le 2033-D.
- **2059-E, 2059-F, 2059-G** : mêmes règles que les tableaux 2033-E, 2033-F et 2033-G.

## Contrôles

| Tableau | Contrôle |
|---|---|
| 2033-D, 2056 | Provisions réglementées à la fin (145 et autres 14) et case 140 du bilan simplifié (DK au réel normal) ; provisions pour risques et charges (15) et case 154 (DR) ; montant à la fin de chaque ligne et registre des provisions (mouvements validés) ; dotations et reprises du relevé et dotations et reprises aux provisions du compte de résultat ; dotations sans provision au registre (déductibilité inconnue) ; reprises de provisions non déductibles (à déduire) |
| 2057 | Total des dettes (VY) et case EC du bilan ; parts à plus d'un an répondues dans l'annexe supérieures aux totaux |
| 2058-B | Provisions non déductibles à réintégrer (WI) ou à déduire (WU) au 2058-A |
| 2058-C | Total des origines (0F) et total des affectations (ZH), comme le demande le formulaire ; dividendes (ZE) et autres réserves (ZD) et affectation votée à l'approbation des comptes de l'exercice précédent ; résultat précédent resté au compte 12 |
| 2033-F, 2059-F | Contrôles de la composition du capital (parts, pourcentages, capital social et nominal, capital comptabilisé au compte 101) ; identité complète (naissance, adresse) des personnes physiques à déclarer |
| 2033-G, 2059-G | Solde des titres de participation (261) sans filiale ni participation enregistrée ; sous-comptes 261 qui ne nomment aucune filiale accessible |
| 2065 | Calcul de l'IS fiable (brouillons, questions sans réponse, déficits inconnus : voir [impot-societes.md](impot-societes.md)) |
| Liasse | Écritures en brouillon sur l'exercice ; exercice pas encore terminé |

Le 2033-C garde ses propres contrôles avec le bilan et le registre des immobilisations ([annexe-et-2054.md](annexe-et-2054.md)).

## Exports

`GET /api/reports/liasse/export?companyId=&fiscalYearId=&format=pdf|csv` (droit `reports:export`, limité comme les autres exports) : le PDF reprend la liste des tableaux et chaque tableau préparé ici, case par case ; le CSV a une ligne par case (formulaire, cadre, ligne, colonne, case, valeur, origine, comptes, remarque), à recopier ou à transmettre. Une société sans liasse reçoit 409.

## Dépôt : hors du périmètre

Kledg prépare la liasse, il ne la dépose pas. La déclaration se dépose par voie électronique (CGI art. 1649 quater B quater) : en saisissant les montants dans l'espace professionnel sur impots.gouv.fr (mode EFI), ou par un partenaire EDI agréé par la DGFiP (procédure EDI-TDFC), qui reçoit les montants de Kledg (CSV). Kledg n'est pas partenaire EDI.

## Données et droits

- Lecture (`reports:read`) : tous les membres. Exports (`reports:export`) : administrateur et comptable.
- Aucune table : la liasse se recalcule à chaque lecture à partir des écritures et des fiches.
- Les données personnelles des associés (naissance, adresse) ne sortent jamais de leur fiche : la liasse dit seulement si elles sont renseignées.
- Les filiales sont lues avec les droits de l'utilisateur dans chacune (`readIfAllowed`) ; une filiale inaccessible est comptée, jamais lue.

## Points incertains des formulaires 2026

- 2033-F-SD : le formulaire imprime les cases 901 à 906, la notice 2033-NOT-SD parle des « case P1 », « P2 », « P3 et P4 » (les codes du 2059-F-SD). Kledg suit le formulaire.
- 2033-G-SD : le formulaire imprime 905 pour le nombre de filiales, déjà le code du total des associés sur le 2033-F-SD ; la notice dit « case P5 ». Kledg suit le formulaire.
- 2033-E-SD : la notice rattache les loyers à une ligne « 146 », le formulaire imprime 310 ; elle range aussi le compte 613 dans les services extérieurs (125) alors que le libellé de 125 exclut les loyers. Kledg suit le libellé du formulaire : 612 et 613 vont à 310, à remplir à la main.
- 2059-F-SD et 2059-G-SD : les deux formulaires impriment P5, l'un pour le total des associés, l'autre pour le nombre de filiales ; la notice 2032-NOT-SD écrit « case PI » pour P1. La notice 2033-NOT-SD demande « le numéro SIRET de l'entreprise déclarante » quand le 2033-F-SD imprime « SIREN ». Kledg suit chaque formulaire.
- 2057-SD : la ligne des totaux des dettes n'imprime que deux codes, VY et VZ, pour quatre colonnes. Kledg lit VY comme le total du montant brut et VZ comme le total à un an au plus, d'après leur place sous les colonnes ; les deux autres totaux restent sans code.
- 2057-SD : pour les créances de l'actif circulant (VA à VS) et pour toutes les dettes, le formulaire n'imprime de code que pour le montant brut ; les colonnes d'échéance n'ont de code qu'aux totaux.
- 2065-SD : le formulaire papier n'imprime aucun code de case, et deux cadres portent la lettre F (contribution exceptionnelle, comptabilité informatisée) et deux la lettre I (contribution des transporteurs maritimes, divers). Kledg nomme les champs par leur libellé.
