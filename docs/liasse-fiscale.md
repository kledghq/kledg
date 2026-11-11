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

## Contrôles

| Tableau | Contrôle |
|---|---|
| 2033-D | Provisions réglementées à la fin (145 et autres 14) et case 140 du bilan simplifié ; provisions pour risques et charges (15) et case 154 ; montant à la fin de chaque ligne et registre des provisions (mouvements validés) ; dotations sans provision au registre (déductibilité inconnue) ; reprises de provisions non déductibles (à déduire) |
| 2033-F | Contrôles de la composition du capital (parts, pourcentages, capital social et nominal, capital comptabilisé au compte 101) ; identité complète (naissance, adresse) des personnes physiques à déclarer |
| 2033-G | Solde des titres de participation (261) sans filiale ni participation enregistrée ; sous-comptes 261 qui ne nomment aucune filiale accessible |
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
- 2065-SD : le formulaire papier n'imprime aucun code de case, et deux cadres portent la lettre F (contribution exceptionnelle, comptabilité informatisée) et deux la lettre I (contribution des transporteurs maritimes, divers). Kledg nomme les champs par leur libellé.
