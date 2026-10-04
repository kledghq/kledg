# Provisions, dépréciations et subventions d'investissement

Les travaux d'inventaire de la clôture : les provisions pour risques et charges, les dépréciations des immobilisations, des stocks, des créances et des valeurs mobilières, la reprise des subventions d'investissement, et la composition du capital. Code : `lib/provisions`, `lib/investment-grants`, `lib/year-end`, `lib/reports/capital-composition` ; pages Saisie, Provisions et dépréciations (`/provisions`), Saisie, Subventions d'investissement (`/investment-grants`), Saisie, Travaux de clôture (`/year-end`) et États, Composition du capital (`/reports/capital-composition`) ; outils MCP `get_year_end_inventory` et `get_capital_composition`.

Kledg ne passe jamais une écriture d'inventaire seul : il propose les dotations, les reprises et les quotes-parts de subventions **en brouillon**, que l'utilisateur vérifie et valide (PCG art. 1031-3). La clôture refuse un exercice qui contient encore des brouillons.

## Provisions et dépréciations

Une provision pour risques et charges et une dépréciation fonctionnent de la même façon dans les comptes : un compte au solde créditeur (15, 29, 39, 49 ou 59) est ajusté à chaque clôture, par une **dotation** (débit 68, crédit du compte) quand il faut davantage, par une **reprise** (débit du compte, crédit 78) quand il faut moins. Kledg les tient dans une seule table (`provisions`), avec une catégorie.

| Catégorie | Comptes | Dotation | Reprise | Source |
|---|---|---|---|---|
| Provision pour risques et charges | 1511 à 1518 (risques), 1521 à 1527 (charges) | 6815, 6865 (financière), 6875 (exceptionnelle) | 7815, 7865, 7875 | PCG art. 322-1 et suivants |
| Dépréciation d'une immobilisation | 290x, 291x, 293x (incorporelles, corporelles) ; 296x, 297x (financières) | 68161, 68162 ; 68662 ; 6876 | 78161, 78162 ; 78662 ; 7876 | PCG art. 214-15 et suivants |
| Dépréciation des stocks | 391 à 397 | 68173 | 78173 | PCG art. 214-15 et suivants |
| Dépréciation d'une créance | 491, 495x, 496x | 68174 ; 6866 (comptes du groupe et des associés) | 78174 ; 7866 | idem |
| Dépréciation de valeurs mobilières | 590x | 68665 | 78665 | idem |

Les comptes sont ceux du plan de comptes modifié par le règlement ANC 2022-06 (exercices ouverts à partir du 1er janvier 2025) : les provisions pour charges sont en 152 (1521 pensions, 1522 restructurations, 1523 impôts, 1524 renouvellement, 1525 gros entretien, 1526 remise en état, 1527 autres), plus en 153 à 158. Le « résultat » (exploitation, financier, exceptionnel) choisit les comptes de dotation et de reprise ; une catégorie n'accepte que ceux qui ont un sens (une dépréciation de titres de participation est financière ou exceptionnelle, pas d'exploitation).

- **Création** : catégorie, compte, libellé, objet et estimation (la provision doit être « nettement précisée quant à son objet », c'est la pièce justificative de l'écriture), date d'origine, date de fin éventuelle, montant déjà comptabilisé avant Kledg pour une société reprise en cours de vie. Une dépréciation d'immobilisation peut être rattachée à une immobilisation de Kledg ; une dépréciation de créance à un client (compte auxiliaire).
- **Évaluation à la clôture** : le montant que le compte doit avoir au dernier jour de l'exercice (meilleure estimation, revue à chaque clôture, PCG art. 322-1 et suivants). Pour une immobilisation rattachée, on peut saisir sa **valeur actuelle** (la plus élevée de la valeur vénale et de la valeur d'usage) : la dépréciation est l'excédent de la valeur nette comptable à la fin de l'exercice sur cette valeur, jamais négative (PCG art. 214-15 et suivants). La valeur nette comptable vient du plan d'amortissement de l'immobilisation, ou des montants enregistrés pour chaque exercice quand il y en a (`lib/fixed-assets/cumulative-depreciation.ts`).
- **Mouvement** : montant requis moins solde à l'ouverture (montant déjà comptabilisé plus les mouvements des exercices précédents) moins ce qui est déjà passé pour cette clôture. Positif, c'est une dotation ; négatif, une reprise.
- **Fin du risque** : une date de fin dans l'exercice, sans évaluation, demande un solde nul : tout le solde est repris.
- **Fonds commercial** : une dépréciation du compte 2907 n'est jamais reprise (PCG art. 214-19). Kledg la marque non réversible et ne propose aucune reprise ; une hausse reste dotée.
- **Fiscalité** : chaque provision porte l'indication « déductible ». Par défaut, les provisions pour amendes et pénalités (1514, CGI art. 39, 2) et pour indemnités de départ à la retraite (1521, CGI art. 39, 1-5°) ne le sont pas ; l'utilisateur corrige les autres cas (une provision pour impôt sur les sociétés, par exemple, CGI art. 213). Une provision déductible doit couvrir une perte ou une charge nettement précisée que des événements en cours rendent probable, être comptabilisée dans l'exercice et figurer sur le relevé des provisions (formulaire 2056, ou 2033-D au régime simplifié) : CGI art. 39, 1-5° ; BOFiP BOI-BIC-PROV-20-10 et BOI-BIC-PROV-20-20. Kledg ne calcule pas les réintégrations de la liasse.

### Créances douteuses

La carte « Créances en retard à la clôture » de l'onglet Dépréciations lit la balance âgée au dernier jour de l'exercice ([lettrage et tiers](lettrage-et-tiers.md)) et liste les clients dont des factures sont en retard de plus de 30, 60 ou 90 jours (90 par défaut). Ce sont des suggestions : l'utilisateur juge le risque de chaque client.

- **Créer la dépréciation** prépare une dépréciation au compte 491 pour ce client. Elle se calcule sur le montant **hors taxe** de la créance (la TVA d'une créance devenue irrécouvrable se récupère, CGI art. 272, 1) multiplié par la perte probable, client par client : une dépréciation forfaitaire de toutes les créances n'est pas déductible (CGI art. 39, 1-5°).
- **Reclasser en 416** prépare en brouillon, au dernier jour de l'exercice, l'écriture qui passe tout ce que le client doit du compte 411 au compte 416 « Clients douteux ou litigieux », avec son compte auxiliaire sur les deux lignes. Un client dont les créances sont sur plusieurs comptes collectifs se reclasse à la main.

API : `GET /api/provisions/doubtful-receivables?companyId=&fiscalYearId=&minDaysOverdue=` (droit `reports:read`), `POST /api/provisions/doubtful-receivables/reclassify` (droit `entries:create`).

## Subventions d'investissement

Une subvention reçue pour financer une immobilisation s'inscrit en capitaux propres (131) et se reprend au résultat (débit 139, crédit 747) au fil de la vie de ce qu'elle finance (PCG art. 312-1 ; CGI art. 42 septies ; BOFiP BOI-BIC-PDSTK-10-30-10-20). L'écriture de réception (débit 441 ou 512, crédit 131) se passe comme une écriture ordinaire.

| Rythme | Quote-part reprise | Cas |
|---|---|---|
| Au rythme de l'amortissement de l'immobilisation | subvention x amortissements cumulés / base amortissable | bien amortissable suivi dans Kledg |
| Linéaire sur la durée d'amortissement | comme un amortissement linéaire de la subvention, prorata temporis, à partir de la date d'octroi | bien amortissable qui n'est pas dans Kledg |
| Sur la durée d'inaliénabilité | un n-ième par exercice | bien non amortissable frappé d'une clause d'inaliénabilité |
| Par dixièmes | un dixième par exercice | bien non amortissable sans clause d'inaliénabilité |

- Les quotes-parts sont des différences de montants cumulés arrondis au centime : elles s'additionnent exactement à la subvention (1 000 € sur 3 ans : 333,33 €, 333,34 €, 333,33 €).
- L'année où l'immobilisation financée sort de l'actif, le solde non repris est viré au résultat (CGI art. 42 septies).
- Une quote-part passée en trop n'est jamais reprise en sens inverse : elle réduit les suivantes.
- Le compte 747 est celui du plan 2025 (« Quote-part des subventions d'investissement virée au résultat de l'exercice », produits d'exploitation, ligne FO du 2052 et 230 du 2033-B). L'ancien plan utilisait le 777 en produits exceptionnels ; le compte se change par subvention.
- Une immobilisation financée par une subvention ne se supprime pas tant que la subvention la suit (clé étrangère `RESTRICT` et message en français) : modifiez la subvention, ou enregistrez la sortie de l'immobilisation.
- Une fois une quote-part validée, le montant, le rythme et les comptes de la subvention sont figés ; une subvention qui a une quote-part validée ne se supprime pas (contre-passez d'abord).
- Quand la subvention est entièrement reprise, les comptes 131 et 139 se soldent l'un par l'autre par une écriture manuelle (débit 131, crédit 139) : Kledg ne la propose pas.

## Travaux de clôture

La page Travaux de clôture montre, pour l'exercice choisi, chaque provision, dépréciation et subvention concernée avec son statut :

| Statut | Signification |
|---|---|
| À évaluer | aucun montant requis pour cette clôture |
| À comptabiliser | un mouvement reste à passer |
| Brouillon, Comptabilisée | l'écriture liée passe le mouvement, en brouillon ou validée |
| À jour | rien à passer |
| À corriger | l'écriture liée ne correspond plus (évaluation changée, brouillon modifié) |

**Préparer les écritures** (`POST /api/year-end/entries`, droit `entries:create`) crée une écriture en brouillon par élément, au journal OD, datée du dernier jour de l'exercice, et la lie à l'évaluation ou à la quote-part de l'exercice (`provision_assessments.entryId`, `investment_grant_transfers.entryId`). L'opération :

- est **idempotente** : relancée, elle ne crée rien deux fois ; elle tourne sous le verrou de la ligne de l'exercice (comme la clôture et les dotations aux amortissements) ;
- **remplace un brouillon** qui ne correspond plus ; une écriture **validée** qui ne correspond plus n'est jamais touchée : il faut la contre-passer, après quoi le mouvement est proposé de nouveau ;
- crée les comptes manquants de l'exercice et le journal OD si besoin ;
- refuse un exercice clôturé.

Ce qui est comptabilisé se lit dans les lignes de l'écriture liée (crédit moins débit du compte de provision, débit moins crédit du 139), jamais dans une copie : un brouillon modifié à la main est lu tel qu'il est, une écriture contre-passée compte pour zéro.

Les contrôles de la clôture (`lib/accounting/fiscal-year-closure/validate-fiscal-year-closure.service.ts`) avertissent des provisions sans évaluation, des écritures d'inventaire à préparer et de celles à corriger. Les brouillons, eux, bloquent la clôture.

### Données et garanties

| Table | Contenu |
|---|---|
| `provisions` | une provision ou une dépréciation (catégorie, compte, résultat, déductibilité, réversibilité, immobilisation ou client, dates, montant repris) |
| `provision_assessments` | le montant requis à la clôture d'un exercice, la valeur actuelle éventuelle, la base de l'estimation et l'écriture liée |
| `investment_grants` | une subvention (montant, date d'octroi, rythme, immobilisation, durée, comptes, montant déjà repris) |
| `investment_grant_transfers` | l'écriture de la quote-part d'un exercice |

- Les quatre tables portent les politiques de sécurité au niveau des lignes d'une table de société ([rls.md](rls.md)).
- Une évaluation et une quote-part restent dans la société de leur provision, de leur subvention et de leur exercice : clés étrangères composites sur (`id`, `companyId`).
- Le compte d'une provision appartient à sa catégorie, les montants sont positifs, une subvention « au rythme de l'amortissement » nomme son immobilisation : contraintes `CHECK` de la migration `20261026090000_provisions_and_investment_grants`.
- Les lignes d'un exercice clôturé ne changent plus : déclencheur `kledg_lock_closed_year_adjustments` (PCG art. 1031-4), contourné seulement par la suppression d'une société entière.

## Composition du capital

La page États, Composition du capital (`GET /api/reports/capital-composition?companyId=&fiscalYearId=`, droit `reports:read`) reprend les associés enregistrés dans les informations de la société.

- Pour chacun : nombre de parts sociales ou d'actions (selon la forme juridique), pourcentage calculé sur le nombre total de titres (le pourcentage enregistré s'affiche s'il diffère), valeur nominale détenue (titres x valeur nominale), SIREN d'une personne morale.
- **Liasse** : les associés qui détiennent au moins 10 % du capital sont marqués, ce sont ceux des formulaires 2033-F (régime simplifié) et 2059-F (régime normal).
- **Contrôles** : capital social différent du nombre de titres multiplié par la valeur nominale (Code de commerce art. L223-2 pour les SARL, L228-1 pour les sociétés par actions), titres ou pourcentages qui ne font pas le total, nombre de titres manquant, capital comptabilisé au compte 101 à la fin de l'exercice différent du capital social.
- Aucune donnée personnelle hors le nom : la date et le lieu de naissance, l'adresse et les coordonnées restent sur la fiche de l'associé.
- La page s'imprime pour l'annexe ou l'assemblée générale. Les participations détenues (2033-G, 2059-G) ne sont pas encore reprises.

## Ce qui n'est pas repris de Ledgerly

- Les méthodes comptables, changements de méthode et d'estimation, corrections d'erreurs et frais de développement : prévus pour kledg-labs.
- Le transfert d'une dépréciation en amortissement pour raisons fiscales et la révision du plan d'amortissement après une dépréciation (la base amortissable devient la valeur nette comptable dépréciée) : le plan d'une immobilisation dépréciée se corrige à la main.
- Le PDF de la composition du capital et le tableau des participations.
