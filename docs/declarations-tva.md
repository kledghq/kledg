# Déclarations de TVA

Kledg **prépare** la déclaration de TVA de chaque période à partir des
écritures validées : chaque montant sur sa ligne du formulaire officiel, avec
le numéro de la case, les contrôles qui disent si les chiffres sont complets
et ce qui reste à remplir à la main. **Vous déposez** la déclaration dans
votre espace professionnel sur impots.gouv.fr : Kledg ne dépose rien, ne
paie rien et ne transmet rien à l'administration.

Page : États, Déclarations de TVA (`/<société>/declarations-tva`, mode
expert). Code : `lib/vat-returns`. Remplace la partie TVA du module de
déclarations de l'ancienne application, réécrite ; l'IS, la CFE et la CVAE
n'en font pas partie.

## Quelle déclaration

Le formulaire et la période suivent le régime de TVA de la société (champ
`vatRegime` ou historique des régimes, qui l'emporte sur la période qu'il
couvre) et les paramètres des échéances, par la même règle que le
calendrier (`vatFilingAt`, `lib/deadlines/engine.ts`) :

| Régime | Déclaration | Période | Source |
| --- | --- | --- | --- |
| Réel normal (et mini réel) | 3310-CA3-SD | Le mois ; le trimestre quand la TVA annuelle est inférieure à 4 000 € (option « trimestrielle » des paramètres des échéances) | CGI art. 287, 2 ; BOI-TVA-DECLA-20-20-10-10 |
| Réel simplifié, jusqu'en 2026 | 3517-S-SD CA12 | L'année civile, avec deux acomptes en juillet (55 %) et en décembre (40 %) | CGI art. 287, 3 ; BOI-TVA-DECLA-20-20-30-10 |
| Réel simplifié, à partir de 2027 | 3310-CA3-SD | Le trimestre par défaut, le mois sur demande : le régime simplifié de TVA est supprimé au 1er janvier 2027. Le trimestre suppose un chiffre d'affaires (comptes 70 des écritures validées) d'au plus 1 000 000 € l'année civile précédente et 1 100 000 € l'année en cours : au-delà de 1 000 000 € l'année précédente, Kledg passe au mois ; au-delà de 1 100 000 € dans l'année, l'échéance l'indique (mois d'office dès le dépassement) | loi n° 2025-127, art. 38 ; impots.gouv.fr |
| Franchise en base, exonération | Aucune | La page indique qu'il n'y a rien à déposer | CGI art. 293 B ; BOI-TVA-DECLA-40 |
| Inconnu | Aucune | La page demande de renseigner le régime | |

Les périodes sont nommées comme les échéances du calendrier : `2026-09`
(CA3 de septembre), `2026-T3` (CA3 du 3e trimestre), `2026` (CA12 de
l'année). Par défaut, la page ouvre la dernière période terminée dont la
déclaration n'est pas encore échue ; sinon la période en cours. Chaque
échéance de TVA de la page Échéances porte un lien « Préparer la
déclaration » vers sa période ; un acompte de juillet ou de décembre ouvre
la CA12 de l'année précédente, sur laquelle il est calculé.

Non couvert : l'option CA12E (exercice qui ne finit pas le 31 décembre), un
changement de régime au milieu d'un trimestre ou d'une année (la période
reste celle du premier mois), les déclarations des DOM.

## Ce que Kledg lit dans les comptes

Seules les **écritures validées** datées dans la période sont lues : la
validation rend l'écriture définitive (PCG art. 1031-3). Les écritures
d'à-nouveaux (journal AN), de clôture (journal CL) et de liquidation de la
TVA (référence `TVA-...`, ou toute écriture qui touche 4455, ou qui solde
44567 avec la TVA collectée ou déductible) ne sont pas des opérations de la
période et sont laissées de côté.

| Compte (PCG art. 944-44 ; une subdivision compte comme sa racine, 445710 comme 44571) | Lecture |
| --- | --- |
| 4457 TVA collectée (44571), sauf 44574 et 44578 | TVA due sur les ventes de la période |
| 44574 TVA collectée en attente d'encaissement | Pas encore due : les prestations de services sont taxées à l'encaissement (CGI art. 269, 2, c). Elle est déclarée quand le règlement de la facture la vire au 44571 ([factures et tiers](factures-et-tiers.md)) ; la page affiche le montant en attente |
| 4452 TVA due intracommunautaire | TVA autoliquidée : acquisitions intracommunautaires de biens (CGI art. 256 bis) et services d'un prestataire non établi en France (CGI art. 283, 2). La TVA déductible correspondante est au 4456 de la même écriture ; son sous-compte 44528 porte la TVA due au titre de l'article 283, 1, second alinéa (lignes B4 et AB) |
| 44562 TVA sur immobilisations | TVA déductible, ligne 19 de la CA3, ligne 23 de la CA12 |
| 44566 TVA sur autres biens et services | TVA déductible, ligne 20 de la CA3 et de la CA12 |
| 44563 TVA transférée par d'autres entités | Autre TVA à déduire, ligne 21 de la CA3, ligne 25 de la CA12 |
| 44567 Crédit de TVA à reporter | Son solde débiteur au début de la période (écritures validées de l'exercice datées avant la période, à-nouveaux compris) est le crédit reporté : ligne 22 de la CA3, ligne 24 de la CA12 |
| 44581 Acomptes, régime simplifié | Acomptes payés dans l'année : ligne 30 de la CA12 |
| 4455 Taxes à décaisser | Liquidation et paiement des déclarations, jamais une opération |
| 44586, 44587 | TVA sur factures non parvenues ou à établir : écritures d'inventaire, pas encore exigibles, laissées de côté |
| Tout autre compte 445 (44568, 44578 taxes assimilées, 44583, 44584, 445 seul...) | Signalé par les contrôles : Kledg ne sait pas sur quelle ligne le porter |

### Taux

Le grand livre porte des montants, pas des taux. Le taux de la TVA collectée
d'une écriture vient, dans l'ordre :

1. d'une **facture de vente** comptabilisée par Kledg : son détail de TVA par
   taux et ses lignes (biens ou services), réparties entre 44571 et 44574
   exactement comme l'écriture de la facture les a réparties
   (`lib/invoices/posting-plan.ts`) ;
2. du **virement de 44574 vers 44571** créé par un règlement : la TVA en
   attente de la facture, par taux, au prorata ;
3. sinon du **rapport entre la TVA et la base** de l'écriture (comptes 7
   pour les ventes, comptes 6 et 2 pour l'autoliquidation) : le seul taux
   français (20 %, 10 %, 5,5 % ou 2,1 %, CGI art. 278 à 281 nonies) dont la
   TVA sur cette base tombe juste à un centime près par ligne.

Quand aucun taux ne convient (plusieurs taux dans une écriture sans
facture), le montant reste « à répartir » : il est compris dans le total de
la TVA brute, listé avec les écritures concernées, et les chiffres sont
marqués à corriger.

### Signes et régularisations

Le formulaire n'accepte jamais de montant négatif (notices des deux
formulaires). Kledg lit chaque écriture séparément :

- une écriture qui **diminue** la TVA collectée (avoir client, rabais) est
  une régularisation : sa base sur la ligne B5 de la CA3, sa TVA sur la
  ligne 21 de la CA3 ou 25 de la CA12 (« taxe acquittée sur des opérations
  pour lesquelles une réduction de prix a été consentie ») ;
- une écriture qui **diminue** la TVA déductible (avoir fournisseur) est de
  la TVA antérieurement déduite à reverser : ligne 15 de la CA3, ligne 18 de
  la CA12 ;
- une TVA autoliquidée annulée (avoir d'une acquisition) va en ligne 21 de
  la CA3 ou 25 de la CA12, en face de la TVA déductible reversée.

### Biens ou services pour l'autoliquidation

Une acquisition de **biens** (contrepartie en achats 60, sauf 604, ou en
immobilisations 2) va en B2 sur la CA3, et sa TVA en ligne 17 ; des
**services** (toute autre contrepartie) vont en A3 sur la CA3 et en AC sur la
CA12. La TVA des deux est taxée sur les lignes de taux (08, 9B, 09, T6 ;
5A, 6C, 06, 09 sur la CA12, sauf AC qui porte sa propre taxe) et déduite en
ligne 20 par le 44566 de la même écriture. Un service d'un prestataire établi
hors de l'Union européenne (Notion, GitHub) va aussi en A3 et en AC : la ligne
couvre tout prestataire non établi en France (CGI art. 259, 1° et 283, 2 ;
notices 3310-CA3-SD et 3517-S-SD 2026).

Un achat auprès d'un assujetti non établi en France dont la société est
redevable au titre du second alinéa de l'article 283, 1 (par exemple un bien
situé en France vendu par un fournisseur étranger) se comptabilise avec sa TVA
due au sous-compte **44528** du 4452 : Kledg le porte en B4 sur la CA3 et en AB
sur la CA12, taxé sur les lignes de taux, jamais en B2 ni en ligne 17.

## Correspondance avec les formulaires

Formulaires et notices 2026 : 3310-CA3-SD (cerfa n° 10963*31, notice
n° 50449#29) et 3517-S-SD (cerfa n° 11417*27, notice n° 51306#18), règles
de BOI-TVA-DECLA-20-20 et BOI-TVA-DECLA-20-20-20-10. Les codes à quatre
chiffres sont ceux des cases du formulaire. « Calculé » : depuis les
comptes ; « À remplir » : Kledg ne peut pas le savoir ; « Total » : calculé
depuis d'autres lignes, comme le formulaire.

### CA3 (3310-CA3-SD)

| Ligne | Case | Libellé | Kledg |
| --- | --- | --- | --- |
| A1 | 0979 | Ventes, prestations de services | Calculé : bases des ventes dont la TVA est au 44571 dans la période |
| A2 | 0981 | Autres opérations imposables | À remplir : cessions d'immobilisations, livraisons à soi-même, autoliquidations du BTP (comptées en A1 par Kledg) |
| A3 | 0044 | Achats de prestations de services d'un assujetti non établi en France (283-2) | Calculé : autoliquidation 4452, contrepartie de services |
| B2 | 0031 | Acquisitions intracommunautaires | Calculé : autoliquidation 4452, contrepartie de biens |
| B4 | 0040 | Achats auprès d'un assujetti non établi en France (283-1) | Calculé : autoliquidation au sous-compte 44528 |
| B5 | 0036 | Régularisations | Calculé : base des avoirs clients |
| E1 | 0032 | Exportations hors UE | À remplir, depuis E2 |
| E2 | 0033 | Autres opérations non imposables | Calculé : ventes (comptes 70) sans aucune TVA, à répartir entre E1, E2 et F2 |
| F2 | 0034 | Livraisons intracommunautaires (B to B) | À remplir, depuis E2 |
| 08 | 0207 | Taux normal 20 % | Calculé : base et taxe (ventes et autoliquidation) |
| 09 | 0105 | Taux réduit 5,5 % | Calculé |
| 9B | 0151 | Taux réduit 10 % | Calculé |
| T6 | 1010 | France continentale au taux de 2,1 % | Calculé |
| 15 | 0600 | TVA antérieurement déduite à reverser | Calculé : avoirs fournisseurs |
| 5B | 0602 | Sommes à ajouter | À remplir |
| 16 | | Total de la TVA brute due (08 à 5B) | Total |
| 17 | 0035 | Dont TVA sur acquisitions intracommunautaires | Calculé : TVA des opérations de B2 |
| 19 | 0703 | Biens constituant des immobilisations | Calculé : 44562 |
| 20 | 0702 | Autres biens et services | Calculé : 44566 |
| 21 | 0059 | Autre TVA à déduire | Calculé : avoirs clients, autoliquidation annulée, 44563 |
| 22 | 8001 | Report du crédit de la ligne 27 précédente | Calculé : solde débiteur de 44567 au début de la période |
| 2C | 0603 | Sommes à imputer | À remplir |
| 23 | | Total TVA déductible (19 à 2C) | Total |
| 25 | 0705 | Crédit de TVA (23 - 16) | Total |
| TD | 8900 | TVA due (16 - 23) | Total |
| 26 | 8002 | Remboursement demandé (3519) | À remplir |
| 27 | 8003 | Crédit à reporter (25 - 26) | Total |
| 28 | 8901 | TVA nette due (TD - X5) | Total |
| 29 | 9979 | Taxes assimilées (annexe 3310 A) | À remplir |
| 32 | 9992 | Total à payer (28 + 29 + Z5 - AB) | Total |

### CA12 (3517-S-SD)

| Ligne | Case | Libellé | Kledg |
| --- | --- | --- | --- |
| 02 | 0032 | Exportations hors UE | À remplir, depuis 03 |
| 03 | 0033 | Autres opérations non imposables | Calculé : ventes sans TVA, à répartir entre 02, 03 et 04 |
| 04 | 0034 | Livraisons intracommunautaires | À remplir, depuis 03 |
| 5A | 0207 | Taux normal 20 % | Calculé : base et taxe (ventes et acquisitions intracommunautaires) |
| 06 | 0105 | Taux réduit 5,5 % | Calculé |
| 6C | 0151 | Taux réduit 10 % | Calculé |
| 09 | 0950 | Opérations imposables à un taux particulier | Calculé : 2,1 % en métropole (notice, ligne 09) |
| AB | 0040 | Achats auprès d'un assujetti non établi en France (283-1) | Calculé : autoliquidation au sous-compte 44528, base et taxe |
| AC | 0044 | Achats de prestations d'un assujetti non établi en France (283-2) | Calculé : autoliquidation de services, base et taxe |
| 11 | 0970 | Cessions d'immobilisations | À remplir (comptées avec les ventes par Kledg) |
| 12 | 0980 | Livraisons à soi-même | À remplir |
| 16 | | Total de la taxe due (5A à 13) | Total |
| 17 | 0983 | Remboursements provisionnels obtenus | À remplir |
| 18 | 0600 | TVA antérieurement déduite à reverser | Calculé : avoirs fournisseurs |
| AD | 0602 | Sommes à ajouter | À remplir |
| 19 | | Total de la TVA brute due (16 + 17 + 18 + AD) | Total |
| 20 | 0702 | Déductions sur factures | Calculé : 44566 |
| 21 | 0704 | Déductions forfaitaires | À remplir (option) |
| 22 | | Total (20 + 21) | Total |
| 23 | 0703 | TVA déductible sur immobilisations | Calculé : 44562 |
| 24 | 0058 | Crédit antérieur non imputé et non remboursé | Calculé : solde débiteur de 44567 au début de l'année |
| 25 | 0059 | Omissions ou compléments de déductions | Calculé : avoirs clients, autoliquidation annulée, 44563 |
| AE | 0603 | Sommes à imputer | À remplir |
| 26 | | Total TVA déductible (22 + 23 + 24 + 25 + AE) | Total |
| 28 | 8900 | TVA due (19 - 26) | Total |
| 29 | 0705 | Crédit (26 - 19) | Total |
| 30 | 0018 | Acomptes payés et / ou restant dus | Calculé : débit net de 44581 dans l'année (colonne 1) ; les acomptes restant dus (colonne 2) sont à ajouter |
| 33 | | Solde dû (28 - 30) | Total |
| 34 | | Excédent de versement (30 - 28) | Total |
| 35 | 0020 | Solde excédentaire (29 + 34) | Total |
| 55 | | Taxes assimilées (36 à 94) | À remplir |
| 56 | 9992 | Total à payer (54 + 55 + Z5) | Total |
| 57 | | Base des acomptes de l'année suivante : 16 - (11 + 12 + 22) | Total ; acompte de juillet 55 %, de décembre 40 %, aucun sous 1 000 € (BOI-TVA-DECLA-20-20-30-10) |

La CA12 n'a pas de ligne propre aux acquisitions intracommunautaires de
biens : Kledg les porte sur les lignes de taux avec les ventes. Les achats de
l'article 283-1 (ligne AB) sont lus sur le sous-compte 44528.

### Arrondis

Chaque base et chaque taxe est arrondie à l'euro le plus proche, 0,50 € et
plus comptant pour un (notices, « arrondis fiscaux ») ; les totaux
additionnent les lignes arrondies, comme le formulaire. La page affiche le
montant à saisir en euros et, quand il diffère, le montant exact des comptes
dessous. L'écart d'arrondi est passé par l'écriture de liquidation.

## Ce que Kledg ne peut pas savoir

Listé avec chaque déclaration (page, PDF, CSV, outil MCP) : les opérations
non comptabilisées ou comptabilisées après la préparation ; la ventilation
des ventes sans TVA (export, livraison intracommunautaire, exonération) ;
les autres opérations imposables (A2, lignes 11 et 12 de la CA12) ; les
achats de l'article 283-1 et les importations ; les régimes particuliers
(TVA sur la marge des biens d'occasion, des agences de voyage et des
terrains à bâtir, DOM, Corse, produits pétroliers, droits d'auteur, anciens
taux) ; le coefficient de déduction des assujettis partiels et les
déductions limitées (véhicules de tourisme, logement) : Kledg reprend la TVA
comptabilisée en 4456 ; les taxes assimilées, l'accise sur les énergies,
les régularisations de déclarations antérieures (5B, 2C, AD, AE) et la
demande de remboursement.

## Assujettis partiels : coefficient de déduction

Une société qui réalise des opérations taxées et des opérations exonérées
(organisme de formation, CGI art. 261, 4, 4° a) déduit sa TVA par le
coefficient de déduction ([organisme de formation](organisme-de-formation.md)) :
la page affiche le coefficient de taxation provisoire de l'année à porter
ligne 22A de la CA3 (25A de la CA12). La régularisation de l'année
précédente (référence `COEF-TVA-<année>`) est lue à part : un complément de
déduction va ligne 21 de la CA3 (25 de la CA12), une TVA à reverser ligne 15
(18 de la CA12), comme le disent les notices 2026.

## Contrôles

`lib/vat-returns/checks.ts`. Un contrôle « à corriger » rend les chiffres
incomplets : la page et le mode simple parlent alors d'estimation.

| Contrôle | Gravité | Règle |
| --- | --- | --- |
| Écritures en brouillon datées dans la période | À corriger | Seules les écritures validées sont déclarées ; le brouillon de liquidation de la période n'est pas compté. Lien vers les brouillons |
| Opérations bancaires non rapprochées dans la période (hors opérations refusées) | À corriger | Leurs écritures, et leur TVA, manquent peut-être. Lien vers le rapprochement |
| Taux non déterminé | À corriger | La TVA de l'écriture ne correspond à aucun taux unique |
| Comptes de TVA non lus | À corriger | Mouvements sur un compte 445 que la déclaration ne lit pas |
| Comptes de TVA soldés | À vérifier | À la fin de la période, hors liquidation de la période, chaque groupe (4457, 4452, 44562, 44566) doit porter exactement les montants déclarés ; un écart vient d'une déclaration précédente non passée en écriture |
| 4455 et paiement précédent | À vérifier | Une fois l'échéance précédente passée, le paiement soldant le compte 4455 doit correspondre au montant de la déclaration précédente enregistrée |
| Crédit reporté | À vérifier | Le solde de 44567 au début de la période doit reprendre le crédit de la déclaration précédente enregistrée (ligne 27 de la CA3, 51 de la CA12) |
| TVA en attente d'encaissement | Information | Montant au 44574, déclaré quand les clients paieront |

## Écriture de liquidation

« Préparer l'écriture » (droit `entries:create`) crée un **brouillon** au
journal OD daté du dernier jour de la période, référence `TVA-<formulaire>-<période>`
(`TVA-CA3-2026-09`), dans l'exercice qui contient ce jour
(`lib/vat-returns/settlement.ts`, PCG art. 944-44) :

- débit de chaque compte de TVA collectée (4457 sauf 44574) et de 4452 par
  son mouvement net de la période, crédit de 44562, 44566 et 44563 par le
  leur : les comptes de la période sont soldés ;
- crédit de 44567 par le crédit reporté utilisé, et, sur une CA12, de 44581
  par les acomptes payés ;
- crédit de 44551 « TVA à décaisser » par le montant dû du formulaire, ou
  débit de 44567 par le crédit à reporter (le crédit utilisé et le crédit
  reporté se compensent sur une seule ligne de 44567) ;
- l'arrondi à l'euro au 658 « Pénalités et autres charges » ou au 758
  « Indemnités et autres produits ».

Les comptes nommés par leur racine prennent le numéro du plan de l'exercice
(445510, 445670...), créés au besoin. L'opération est **idempotente**, sous
un verrou par société et période et le verrou de l'exercice : un brouillon
identique est gardé, un brouillon périmé (une écriture ajoutée depuis) est
supprimé et préparé de nouveau, une liquidation validée n'est jamais
modifiée (elle se corrige par contre-passation). Kledg ne valide jamais
l'écriture : vous la validez une fois la déclaration déposée. Les lignes à
remplir à la main ne sont pas dans l'écriture.

## Dépôt enregistré

Une fois la déclaration déposée sur impots.gouv.fr, « Enregistrer le
dépôt » garde la date de dépôt, le montant payé (ligne 28 de la CA3, 33 de
la CA12) et le crédit reporté (ligne 27, 35). La période suivante s'en sert
pour les contrôles du 4455 et du crédit reporté ; la liste des périodes
marque les périodes déposées.

Table `vat_return_filings` (migration
`20261103090000_vat_return_filings`) : une ligne par société et période
(`periodKey` unique avec `companyId`), contraintes de la base sur le
formulaire et la forme de la période, l'ordre des dates, des montants
jamais négatifs et jamais les deux à la fois. Table d'une société : les
quatre politiques `kledg_rls_*` sur `companyId` ([rls.md](rls.md)).

## Export

PDF (document de travail, jamais le formulaire officiel) et CSV
(séparateur « ; », virgule décimale, BOM UTF-8, cellules protégées contre
les formules), droit `reports:export`, limite `export`. Mêmes lignes, cases,
montants, contrôles, ce qu'il reste à remplir et sources que la page.

## Mode simple

L'accueil du mode simple affiche « TVA à payer le ... » avec le montant de
la déclaration de l'échéance suivante calculé ici, et la mention « D'après
votre déclaration de septembre 2026 », quand ses contrôles passent ; sinon
l'estimation d'après les comptes 445 et la mention « Estimation, à
confirmer » ([mode simple](mode-simple.md)). Pour un acompte du régime
simplifié, le montant est 55 % (juillet) ou 40 % (décembre) de la ligne 57
de la CA12 précédente.

## API et MCP

| Route | Droit | Effet |
| --- | --- | --- |
| `GET /api/companies/[id]/vat-returns?period=` | `reports:read` | La déclaration préparée d'une période (la prochaine due par défaut) |
| `GET /api/companies/[id]/vat-returns/export?period=&format=pdf\|csv` | `reports:export` | Le document de travail |
| `POST /api/companies/[id]/vat-returns/settlement { period }` | `entries:create` | L'écriture de liquidation en brouillon (201 créée ou remplacée, 200 inchangée ou déjà validée) |
| `PUT /api/companies/[id]/vat-returns/filing { period, filedOn, amountDueCents, creditCents }` | `entries:create` | Enregistre le dépôt |
| `DELETE /api/companies/[id]/vat-returns/filing?period=` | `entries:create` | Retire l'enregistrement |

Outils MCP ([mcp.md](mcp.md)) : `get_vat_return` (lecture) et
`prepare_vat_settlement` (brouillons). Aucun ne dépose ni ne paie.

## Tests

- `lib/vat-returns/__tests__/compute.test.ts` : exemples chiffrés, CA3
  mensuelle à plusieurs taux, autoliquidation intracommunautaire de biens et
  de services, TVA sur immobilisation, crédit reporté, avoirs, TVA sur les
  encaissements, taux non déterminé, CA12 avec acomptes, solde dû,
  excédent et base des acomptes suivants, arrondis, écritures de
  liquidation.
- `lib/vat-returns/__tests__/periods-and-checks.test.ts` : périodes par
  régime et par l'historique, passage de 2026 à 2027, franchise, liens avec
  le calendrier, contrôles.
- `lib/vat-returns/__tests__/vat-returns.db.test.ts` (PostgreSQL, aussi avec
  `KLEDG_RLS=enforce`) : deux mois de comptes, liquidation idempotente,
  dépôts, contrôles, exports, franchise, accueil du mode simple, routes
  pour chaque rôle, contraintes de la base.
- `lib/mcp/__tests__/vat-return-tools.test.ts`,
  `components/features/vat-returns/__tests__/vat-return-page.test.tsx`,
  la matrice des autorisations et l'isolation des sociétés
  (`lib/rls/__tests__`).

## Sources

- [Formulaire 3310-CA3-SD, cerfa n° 10963*31](https://www.impots.gouv.fr/sites/default/files/formulaires/3310-ca3-sd/2026/3310-ca3-sd_5377.pdf) et [notice n° 50449#29](https://www.impots.gouv.fr/sites/default/files/formulaires/3310-ca3-sd/2026/3310-ca3-sd_5426.pdf)
- [Formulaire 3517-S-SD CA12, cerfa n° 11417*27](https://www.impots.gouv.fr/sites/default/files/formulaires/3517-s-sd/2026/3517-s-sd_5291.pdf) et [notice n° 51306#18](https://www.impots.gouv.fr/sites/default/files/formulaires/3517-s-sd/2026/3517-s-sd_5424.pdf)
- [BOI-TVA-DECLA-20-20](https://bofip.impots.gouv.fr/bofip/911-PGP.html/identifiant=BOI-TVA-DECLA-20-20-20220216) (déclaration des opérations et paiement), [BOI-TVA-DECLA-20-20-20-10](https://bofip.impots.gouv.fr/bofip/2883-PGP.html/identifiant=BOI-TVA-DECLA-20-20-20-10-20150603) (contenu des déclarations), [BOI-TVA-DECLA-20-20-10-10](https://bofip.impots.gouv.fr/bofip/1001-PGP.html/identifiant=BOI-TVA-DECLA-20-20-10-10-20230118) (dates), [BOI-TVA-DECLA-20-20-30-10](https://bofip.impots.gouv.fr/bofip/2418-PGP.html/identifiant=BOI-TVA-DECLA-20-20-30-10-20230118) (régime simplifié), [BOI-TVA-DECLA-40](https://bofip.impots.gouv.fr/bofip/218-PGP.html/identifiant=BOI-TVA-DECLA-40-20170705) (franchise)
- [CGI, art. 287](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048826856) (déclarations), [art. 293 B](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000045035275) (franchise en base), art. 269, 2, c (exigibilité des services), art. 256 bis et 283 (autoliquidation), art. 278 à 281 nonies (taux)
- [Suppression du régime simplifié de TVA au 1er janvier 2027](https://www.impots.gouv.fr/actualite/le-regime-simplifie-dimposition-la-tva-est-supprime-compter-du-1er-janvier-2027)
- PCG, art. 944-44 (comptes de taxes sur le chiffre d'affaires) et art. 1031-3 (validation des écritures)
