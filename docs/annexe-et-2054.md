# Annexe des comptes, méthodes comptables et formulaires 2054, 2055, 2033-C

Le guide d'utilisation (à quoi servent l'annexe et les tableaux, étapes, règles expliquées) est sur le site : [L'annexe et les tableaux 2054, 2055, 2033-C](https://www.kledg.com/fr/docs/l-annexe-et-les-tableaux-fiscaux). Cette page décrit le fonctionnement technique : code, API, règles de calcul, droits et limites d'implémentation.

Les comptes annuels comprennent le bilan, le compte de résultat et une annexe (PCG art. 811-1). Kledg établit l'annexe à partir des écritures validées, des immobilisations, des provisions, du registre des méthodes comptables et de la composition du capital, selon la catégorie de taille de la société ; il prépare aussi les formulaires d'immobilisations et d'amortissements de la liasse fiscale. Code : `lib/annexe` ; pages États, Annexe (`/reports/annexe`), États, Immobilisations (2054, 2055) (`/reports/fixed-asset-movements`) et Saisie, Méthodes comptables (`/accounting-methods`) ; outils MCP `get_annexe`, `get_fixed_asset_movements` et, avec l'accès brouillons, `manage_accounting_methods`, `manage_accounting_changes` et `update_annexe_notes` (voir [mcp.md](mcp.md)).

Kledg n'invente rien : ce que les comptes ne disent pas (engagements hors bilan, événements postérieurs à la clôture, échéances des dettes, effectif...) est demandé, et l'annexe ne se génère que lorsque rien ne manque. Les montants viennent des écritures validées de l'exercice, à-nouveaux compris, écriture de clôture exclue.

Textes vérifiés le 5 octobre 2026 : règlement ANC n° 2014-03 relatif au plan comptable général, version consolidée au 1er janvier 2026 (recueil publié par l'ANC) ; formulaires DGFiP n° 2054-SD, 2055-SD (liasse 2050, édition 2026) et 2033-C-SD (édition 2026), et la notice 2033-NOT-SD.

## Méthodes comptables, changements et corrections d'erreurs

### Le registre des méthodes

Une société applique ses méthodes de façon permanente (PCG art. 121-5) ; l'annexe donne la liste des principales méthodes retenues quand il existe un choix (art. 831-1, 3°). Le registre tient, par sujet (évaluation des stocks, amortissements, chiffre d'affaires, contrats à long terme, frais de développement, frais d'établissement, frais d'acquisition, coûts d'emprunt, retraites, subventions, devises, autre), la méthode retenue, son application et sa date d'adoption. Une **méthode de référence** (retraites provisionnées, frais de développement à l'actif, frais d'établissement en charges, frais d'acquisition incorporés au coût) est irréversible une fois adoptée (art. 121-5) : Kledg refuse de la redéclasser (409).

### Changements et corrections

| Type | Source | Traitement | Écriture de rattrapage préparée par Kledg |
|---|---|---|---|
| Changement de réglementation | PCG art. 122-1, 122-3 | Comme un changement de méthode | idem |
| Changement de méthode à l'initiative de la société | art. 122-2 (choix entre méthodes admises, meilleure information, justifié), 122-3 | Effet calculé rétrospectivement ; impact à l'ouverture, après impôt, en **report à nouveau** dès l'ouverture ; en **résultat exceptionnel** si des règles fiscales l'imposent ; **prospectif** si l'effet ne peut être calculé objectivement | Report à nouveau : débit ou crédit du compte de bilan ajusté, 444 pour l'effet d'impôt, 110 (impact positif) ou 119 (négatif), au premier jour de l'exercice. Résultat : 778 ou 678, au dernier jour |
| Changement d'estimation | art. 122-5 | Toujours **prospectif** : l'exercice en cours et les suivants (contrainte `CHECK` de la base) | Aucune |
| Correction d'erreur | art. 122-6 | En **résultat** de l'exercice où elle est constatée, hors résultat courant ; en **report à nouveau** quand elle corrige une écriture imputée directement sur les capitaux propres | 678 ou 778 au dernier jour (ou à la date choisie) ; 110 ou 119 |

Chaque changement porte son libellé, sa nature et sa justification, l'impact avant impôt (signé : positif s'il augmente les capitaux propres ou le résultat), l'effet d'impôt et le compte de bilan ajusté. L'annexe les mentionne avec leur impact (art. 831-2). Les comptes 110, 119, 678, 778 et 444 sont ceux du plan de comptes en vigueur (ANC 2022-06). Pour une correction en résultat, l'impôt suit le calcul de l'impôt de l'exercice : Kledg ne passe pas de ligne 444.

- **Préparer l'écriture** (`POST /api/accounting-changes/[id]/entry`, droit `entries:create`) crée l'écriture en **brouillon** au journal OD (référence `CHG-<année>`), sous le verrou de la ligne de l'exercice ; relancée, elle remplace le brouillon. Un exercice clôturé est refusé.
- Modifier le traitement, l'impact, le compte ou la date supprime le brouillon lié (à préparer de nouveau) ; une fois l'écriture **validée**, la modification et la suppression sont refusées (409) : contre-passez d'abord (PCG art. 1031-3).

## Formulaires 2054-SD, 2055-SD et 2033-C-SD

La page lit les mouvements des comptes 20 à 28 dans les écritures validées de l'exercice, ligne par ligne des formulaires, avec le code de chaque case.

| Mouvement d'un compte d'immobilisation (20 à 27) | Colonne |
|---|---|
| Écriture d'à-nouveaux (journal AN, ou RAN, OU d'un FEC importé) | Valeur brute au début |
| Débit dans une écriture qui crédite un écart de réévaluation (105) | Augmentation consécutive à une réévaluation |
| Autre débit | Acquisitions, créations, apports et virements de poste à poste |
| Crédit dans une écriture qui débite une autre immobilisation (une immobilisation en cours mise en service) | Diminution par virement de poste à poste |
| Autre crédit | Cessions à des tiers ou mises hors service |
| Somme algébrique (PCG art. 832-1) | Valeur brute à la fin |

Un amortissement (28) : à-nouveaux au début, crédits en dotations, débits en diminutions (éléments sortis, reprises). Une écriture et sa contre-passation du même exercice s'annulent et ne figurent pas. Les dépréciations (29) ne sont pas des amortissements : elles vont au relevé des provisions (2056, 2033-D) et au tableau des dépréciations de l'annexe.

Correspondance des comptes (le préfixe le plus précis l'emporte, comme pour le bilan) :

| Ligne du 2054 (cases du cadre A) | Comptes |
|---|---|
| Frais d'établissement et de développement (CZ, D8, D9) | 201, 203 |
| Autres postes d'immobilisations incorporelles (KD, KE, KF) | autres 20, 232, 237 |
| Terrains (KG) | 211, 212 |
| Constructions sur sol propre (KJ), sur sol d'autrui (KM) | 213, 214 |
| Installations générales des constructions (KP) | 2135, 2145 |
| Installations techniques, matériel et outillage (KS) | 215 |
| Installations générales, agencements divers (KV) | 2181 |
| Matériel de transport (KY) | 2182 |
| Matériel de bureau et informatique, mobilier (LB) | 2183, 2184 |
| Emballages récupérables et divers (LE) | autres 21, 22 |
| Immobilisations corporelles en cours (LH), avances et acomptes (LK) | 231, 238 |
| Participations mises en équivalence (8G) | aucune (toujours vide) |
| Autres participations (8U) | 26 |
| Autres titres immobilisés (1P) | 271, 272, 273, 277 |
| Prêts et autres immobilisations financières (1T) | autres 27, 267, 268 (sans 269 ni 279) |

Le 2055 (cadre A) suit les mêmes lignes sur les comptes 280 à 2818 (fonds commercial 2806, 2807 à part) ; le 2033-C (cadres I et II) regroupe les lignes de la liasse simplifiée (cases 400 à 496 et 495 à 576), le fonds commercial (206, 207) à part.

### Contrôles

- **Bilan** : la valeur brute à la fin (total du 2054) égale l'actif immobilisé brut du bilan complet (case BJ) ; les amortissements à la fin (2055) plus les dépréciations (29) égalent sa colonne amortissements (BK). Un écart signale un compte de la classe 2 rangé ailleurs dans la présentation du bilan.
- **Registre des immobilisations** : pour chaque ligne qui a des immobilisations au registre, les acquisitions et les sorties de l'exercice, la valeur brute à la fin, les dotations de l'exercice et les amortissements cumulés (plan d'amortissement et montants enregistrés, `lib/fixed-assets/cumulative-depreciation.ts`) sont comparés aux écritures. Kledg signale l'écart, il ne corrige rien.
- Les écritures en brouillon sur les comptes de la classe 2 sont signalées : elles ne comptent qu'une fois validées.

Exports PDF et CSV (`GET /api/reports/fixed-asset-movements/export?format=pdf|csv`, droit `reports:export`) : une ligne CSV par formulaire, ligne, colonne et case.

Non repris : le cadre B du 2055 (amortissements dérogatoires), son cadre C (charges réparties), la colonne « valeur d'origine » des immobilisations réévaluées (réévaluation légale) et le cadre III du 2033-C (plus et moins-values) : à remplir à la main.

## L'annexe selon la catégorie de la société

La catégorie est celle confirmée sur la page Approbation des comptes (seuils du décret n° 2024-152, voir [approbation](approbation-des-comptes.md#taille-de-la-société)), sinon celle que Kledg propose d'après les comptes ; la page le signale.

| Catégorie | Annexe | Articles appliqués |
|---|---|---|
| Micro-entreprise | Facultative (C. com. L123-16-1) : Kledg génère les **informations à la suite du bilan** (règlement appliqué, engagements hors bilan dont crédit-bail et retraites, engagements envers les entités liées, avances aux dirigeants, actions propres) | PCG art. 811-7 |
| Petite entreprise au régime réel simplifié | Annexe simplifiée | PCG art. 811-8 (C. com. L123-25) : 831-1, 831-2, 832-1, 832-3, 832-8, 832-9, 832-12, 832-13, 832-15, 834-2, 836-1, 836-3, 836-5, 838-1 et suivants |
| Petite entreprise | Annexe simplifiée | PCG art. 811-9 (C. com. L123-16) : les précédents et 832-2, 832-4 à 832-7, 832-10, 832-11, 832-14, 832-17, 832-19, 832-21, 833-1, 833-2, 835-1, 836-2, 837-1 |
| Moyenne ou grande entreprise | Annexe complète | PCG art. 831-1 à 838-x, dont les rémunérations des dirigeants (835-2) et l'entité consolidante (831-4) |

Les numéros d'articles sont ceux du PCG en vigueur au 1er janvier 2026 (règlement ANC n° 2022-06 et suivants) : le chapitre III du titre VIII y suit l'ordre des postes (831 principes et méthodes, 832 postes du bilan et du compte de résultat, 833 fiscalité, 834 transactions, 835 dirigeants, 836 hors bilan, 837 effectif, 838 autres). Une information sans importance significative n'est pas fournie (art. 811-6) : une note sans rien dans les comptes (pas de réévaluation, pas d'actions propres, pas de résultat exceptionnel) est omise.

| Note | Source | Données |
|---|---|---|
| Règles et méthodes comptables | art. 831-1 | Règlement ANC appliqué, dérogations (demandées), registre des méthodes, modes et durées d'amortissement du registre des immobilisations (art. 832-1) |
| Changements de méthode, d'estimation, corrections d'erreurs | art. 122-1 à 122-6, 831-2 | Registre de l'exercice ; « aucun changement enregistré » s'il est vide |
| Immobilisations | art. 832-1, 832-2 | Rapport 2054 : par rubrique, puis détail (réévaluations, entrées, virements, cessions) |
| Amortissements | art. 832-1 | Rapport 2055 |
| Provisions et dépréciations | art. 832-1, 832-8, 832-13 | Comptes 15, 290 à 297, 39, 49, 59 : début, dotations, reprises, fin |
| Réévaluation | art. 832-3 | Compte 105 |
| Filiales et participations | art. 832-5, C. com. L233-15 | Tableau des participations de la [vue groupe](vue-groupe.md) (sociétés suivies dans Kledg et accessibles) ; les titres 261 qu'aucune société de Kledg n'explique demandent les chiffres de la société détenue |
| État des créances | art. 832-9 | Soldes débiteurs par nature ; part à plus d'un an demandée |
| Capital et variation des capitaux propres | art. 832-11 | Titres et valeur nominale de la société ; comptes 101 à 14 au début, augmentations, diminutions, résultat de l'exercice, fin |
| Actions propres | art. 832-12 | Comptes 502, 2771, 2772 |
| État des dettes | art. 832-15 | Soldes créditeurs par nature ; parts à plus d'un an et à plus de cinq ans demandées |
| Charges à payer, produits à recevoir, régularisation | art. 832-10, 832-17, 832-19 | 408, 4282, 4286, 4382, 4386, 4482, 4486, 4686, 1688 ; 418, 4287, 4387, 4487, 4687, 2768 ; 486, 487 |
| Résultat exceptionnel | art. 832-21 | Comptes 67, 687, 77, 787 |
| Crédits d'impôt | art. 833-2 | Demandés |
| Parties liées | art. 834-2 | Demandé (ou « Néant ») |
| Dirigeants | art. 835-1, 835-2 | Avances et crédits (demandés) ; rémunérations globales pour une moyenne ou grande entreprise, ou leur omission quand elles identifieraient un dirigeant |
| Engagements hors bilan | art. 836-1 à 836-5 | Demandés : cautions, sûretés, crédit-bail (redevances restant à payer, prix d'achat résiduel), retraites, entités liées, autres |
| Effectif | art. 837-1 | Demandé, ou celui de la page Approbation |
| Entité consolidante | art. 831-4 | Demandée pour une société d'un groupe (réponse de la page Approbation) |
| Événements postérieurs, autres informations | art. 831-1, 4° et 5° | Demandés (« Néant » possible) |

L'annexe se télécharge en **PDF** et en **Markdown** (`GET /api/annexe/export?format=pdf|md`, droit `reports:export`), avec le moteur de documents de l'approbation (`lib/approval/documents`). Elle figure dans les documents de la page Approbation des comptes (document `annexe`, avec la même liste de ce qui manque), juste avant la liste du dépôt au greffe : obligatoire sauf pour une micro-entreprise.

## Données et droits

- Lecture (`reports:read`) : tous les membres. Réponses de l'annexe (`PUT /api/annexe`, `closing:execute`) : administrateur et comptable. Registre des méthodes et changements (`entries:create`, suppression `entries:delete`) : administrateur et comptable. Exports (`reports:export`), limités comme les autres exports.
- Migration `20261110090000_annexe_and_accounting_methods` : tables `accounting_methods`, `accounting_changes` (clé étrangère composée sur l'exercice, écriture liée unique, un changement d'estimation toujours prospectif, effet d'impôt positif) et `annexe_notes` (une ligne par exercice, réponses en JSON validées par `AnnexeDetailsSchema`, `lib/annexe/schemas.ts`). Pas de verrou des exercices clôturés sur ces tables : l'annexe s'écrit après la clôture ; seules les écritures sont verrouillées.
- Sécurité au niveau des lignes : tables de société, politiques `kledg_rls_*` sur `companyId` ([rls.md](rls.md)). Journal d'audit : `CREATE_ACCOUNTING_METHOD`, `UPDATE_ACCOUNTING_METHOD`, `DELETE_ACCOUNTING_METHOD`, `CREATE_ACCOUNTING_CHANGE`, `UPDATE_ACCOUNTING_CHANGE`, `DELETE_ACCOUNTING_CHANGE`, `PREPARE_ACCOUNTING_CHANGE_ENTRY`, `SAVE_ANNEXE_NOTES`.

## Ce que Kledg ne fait pas

- Le calcul rétrospectif de l'effet d'un changement de méthode et la présentation des exercices antérieurs retraités (art. 831-3) : l'impact se saisit, les postes retraités se rédigent dans le Markdown.
- Les tableaux propres à certaines activités (art. 838-1 et suivants : bons de souscription, contrats à long terme, quotas d'émission, instruments financiers...), la ventilation du chiffre d'affaires (832-18), les honoraires des commissaires aux comptes (832-20) et la fiscalité différée (833-3, 833-4) : à compléter dans le Markdown si la société est concernée.
- Les amortissements dérogatoires, les plus et moins-values de cession et la réévaluation légale élément par élément (formulaires 2055 cadre B, 2033-C cadre III, 2054 bis).
