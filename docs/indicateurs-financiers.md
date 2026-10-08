# Indicateurs financiers : SIG, CAF, BFR et ratios

Le guide d'utilisation (à quoi servent les indicateurs, comment les lire) est sur le site : [Les indicateurs financiers](https://www.kledg.com/fr/docs/les-indicateurs-financiers). Cette page décrit le fonctionnement technique : code, API, règles de calcul, droits et limites d'implémentation.

La page **États, SIG et ratios** (`/<société>/reports/sig`) présente, pour un
exercice et l'exercice précédent : les soldes intermédiaires de gestion, la
capacité d'autofinancement, le besoin en fonds de roulement, la trésorerie
nette, les délais de paiement des clients et des fournisseurs et les
principaux ratios. Chaque ligne indique ses comptes et les lignes des
formulaires officiels dont elle provient. Les mêmes chiffres alimentent
l'export CSV et Excel, quatre widgets du [tableau de bord](tableau-de-bord.md)
et les outils MCP `get_sig` et `get_financial_ratios` ([serveur MCP](mcp.md)).

Le code est dans `lib/reports/financial-indicators` : `sig.ts` (SIG et CAF),
`balance-indicators.ts` (BFR, trésorerie, dettes), `indicators.ts` (délais
et ratios), `rows.ts` (libellés et sources affichés), tous purs et en
centimes ; `get-financial-indicators.service.ts` charge les données.

## Données lues

Les montants sont les soldes des comptes de l'exercice tirés des écritures
validées, **écriture de clôture exclue** (journal CL) : exactement les totaux
du compte de résultat et du bilan (`loadStatementAccounts`). L'exercice
précédent est celui qui commence juste avant, sur toute sa durée. Le compte de
chaque ligne est reconnu par son début de numéro (PCG, art. 932-1), le plus
long gagnant : `6097` va au coût des marchandises, `609` aux consommations.

Les numéros sont ceux du PCG en vigueur (règlement ANC 2014-03 modifié par le
règlement ANC 2022-06). Depuis ce règlement, les cessions d'immobilisations
incorporelles et corporelles passent par 657 et 757 (charges et produits
d'exploitation), la quote-part des subventions d'investissement virée au
résultat par 747, et les comptes 67 et 77 ne gardent que l'exceptionnel. Les
anciens comptes (675, 775, 777) restent reconnus pour les plans plus anciens.

## Soldes intermédiaires de gestion

Tableau des soldes intermédiaires de gestion du PCG (système développé),
lignes du compte de résultat des formulaires 2052-SD et 2053-SD (régime réel
normal) et 2033-B-SD (régime simplifié).

| Solde | Calcul | Comptes | Formulaires |
|---|---|---|---|
| Marge commerciale | Ventes de marchandises - coût d'achat des marchandises vendues | 707, 7097 ; 607, 6087, 6097, 6037 | 2052 FC - (FS + FT) ; 2033-B 210 - (234 + 236) |
| Production de l'exercice | Production vendue + stockée + immobilisée | 70 sauf 707 et 7097 (et 73) ; 71 ; 72 | 2052 FD à FI, FM, FN ; 2033-B 214, 218, 222, 224 |
| Valeur ajoutée | Marge commerciale + production - consommations en provenance de tiers | 60 sauf marchandises, 61, 62 | 2052 FU + FV + FW ; 2033-B 238 + 240 + 242 |
| Excédent brut d'exploitation (EBE) | Valeur ajoutée + subventions d'exploitation - impôts et taxes - charges de personnel | 74 sauf 747 ; 63 ; 64 | 2052 FO, FX, FY + FZ ; 2033-B 226, 244, 250 + 252 |
| Résultat d'exploitation | EBE + reprises et transferts de charges + autres produits - dotations - autres charges | 78 sauf 786 et 787, 79 sauf 796 et 797 ; 75 sauf 755, 747 ; 68 sauf 686 et 687 ; 65 sauf 655 | 2052 GG ; 2033-B 270 |
| Résultat courant avant impôts | Résultat d'exploitation + quotes-parts en commun + produits financiers - charges financières | 755 - 655 ; 76, 786, 796 ; 66, 686 | 2052 GW |
| Résultat exceptionnel | Produits exceptionnels - charges exceptionnelles | 77, 787, 797 ; 67, 687 | 2053 HI |
| Résultat de l'exercice | Résultat courant + résultat exceptionnel - participation - impôts sur les bénéfices | 691 ; 69 sauf 691 | 2053 HN ; 2033-B 310 |
| Plus ou moins-values de cession | Produits des cessions - valeur comptable des éléments cédés (déjà compris dans les soldes) | 757, 7671, 775 ; 657, 6671, 675 | |

Points précis :

- **Subventions d'exploitation (74)** : dans l'EBE, sauf 747, quote-part des
  subventions d'investissement virée au résultat, un produit calculé sans
  encaissement, placé avec les autres produits.
- **Impôts et taxes (63)** et **charges de personnel (64)**, remboursements
  (649) déduits, sont retranchés de la valeur ajoutée pour former l'EBE ; le
  personnel extérieur (621) reste une consommation de tiers.
- **Transferts de charges (79)** : 791 avec les reprises d'exploitation (ligne
  FP de la 2052), 796 en financier, 797 en exceptionnel.
- **Production stockée (71, compte 713)** et **production immobilisée (72)**
  entrent dans la production de l'exercice, avec leur signe : un déstockage
  est négatif.
- Les rabais obtenus (609, 619, 629) et accordés (709) réduisent leur ligne :
  les charges se lisent débit moins crédit, les produits crédit moins débit.
- Les cessions (657, 757) sont exclues de l'EBE et comptées dans le résultat
  d'exploitation, comme sur la 2052 (lignes G1 et F1).

Tout compte de classe 6 ou 7 tombe dans exactement une ligne ; un numéro hors
de la liste du PCG va aux autres charges ou aux autres produits. Le résultat
de l'exercice des SIG est donc **toujours égal au résultat du compte de
résultat** (produits moins charges, PCG art. 821-1) ; les tests le vérifient
aussi pour le résultat d'exploitation (GG), le résultat courant (GW) et le
résultat exceptionnel (HI) du compte de résultat par défaut de Kledg.

## Capacité d'autofinancement

Méthode additive, à partir du résultat de l'exercice (tableau de financement
du PCG, système développé ; même définition que la Banque de France et
l'Ordre des experts-comptables) :

```
CAF = résultat de l'exercice
    + dotations aux amortissements, dépréciations et provisions (681, 686, 687)
    - reprises (781, 786, 787)
    + valeur comptable des éléments d'actif cédés (657, 6671, 675)
    - produits des cessions d'éléments d'actif (757, 7671, 775)
    - quote-part des subventions d'investissement virée au résultat (747, 777)
```

Kledg calcule aussi la CAF par la méthode soustractive (EBE plus les autres
produits encaissables, moins les autres charges décaissables) : les deux sont
égales, ce que les tests vérifient sur cinquante grands livres tirés au sort.

## Besoin en fonds de roulement, trésorerie et endettement

Lus au bilan, sur les lignes du modèle par défaut des formulaires 2050-SD et
2051-SD. Chaque compte va à la ligne de son solde, comme sur le bilan : un
fournisseur débiteur est une autre créance, une banque créditrice un
découvert.

| Indicateur | Calcul | Lignes du bilan |
|---|---|---|
| Stocks et en-cours | Comptes 31 à 38, nets des dépréciations 39 | 2050 BL à BT |
| Créances clients | Comptes 41 débiteurs, nets de 491 | 2050 BX |
| Autres créances d'exploitation | Avances et acomptes versés (4091) et comptes 40, 42, 43, 44 débiteurs (TVA déductible comprise) | 2050 BV et la part d'exploitation de BZ |
| Dettes fournisseurs | Comptes 401, 403, 4081, 4088 créditeurs | 2051 DX |
| Dettes fiscales et sociales | Comptes 42, 43, 44 créditeurs | 2051 DY (et 426 en DV) |
| **BFR** | Stocks + créances clients + autres créances d'exploitation - dettes fournisseurs - dettes fiscales et sociales | |
| **Trésorerie nette** | Valeurs mobilières de placement (50 net de 59) + disponibilités (51, 53, 54 débiteurs) - concours bancaires courants (51 créditeurs) | 2050 CD + CF - part de 2051 DU |
| Dettes financières | Emprunts obligataires, emprunts bancaires hors découverts, emprunts et dettes financières divers hors comptes d'associés et dépôts du personnel | 2051 DS, DT, DU, DV |
| Capitaux propres | Comptes 10 à 14 et résultat de l'exercice | 2051 DL |

Les débiteurs divers (46), comptes d'associés (45) et autres créances hors
exploitation restent hors du BFR. Les comptes courants d'associés (45
créditeurs) figurent sur le bilan en emprunts et dettes financières divers
(2051 DV, comme la liste des comptes du modèle du PCG) mais ne comptent pas
dans les dettes financières de l'indicateur : ce sont des quasi-fonds
propres. Les dépôts du personnel (426), aussi en DV, restent avec les dettes
fiscales et sociales du BFR. Les avances reçues des clients (4191) et les comptes
de régularisation (486, 487) ne font pas partie de la définition retenue.

## Délais de paiement

Les créances et les dettes contiennent la TVA, les ventes et les achats des
classes 6 et 7 non. Kledg ramène donc les flux en TTC avec la TVA que les
écritures de l'exercice ont enregistrée sur eux, **à-nouveaux exclus** (ils
portent des soldes, pas des flux) :

```
DSO (clients)      = créances clients brutes (BX, avant 491)
                     / (chiffre d'affaires HT (70) + TVA collectée (crédits du 4457))
                     x jours
DPO (fournisseurs) = dettes fournisseurs (DX)
                     / (achats et charges externes HT (60 sauf 603, 61, 62)
                        + TVA déductible (débits du 44566) - TVA autoliquidée (crédits du 4452))
                     x jours
```

- Une société en franchise en base (CGI art. 293 B) n'a pas de TVA : TTC et
  HT se confondent.
- La TVA autoliquidée sur les acquisitions intracommunautaires est retirée,
  car aucun fournisseur ne la facture.
- Les avoirs, passés au débit du 4457 comme la liquidation de la TVA, ne
  peuvent pas en être distingués : ils ne sont pas retranchés, le délai
  clients est un peu sous-estimé quand ils sont importants.
- **Jours** : ceux de l'exercice jusqu'au jour de référence (aujourd'hui dans
  un exercice en cours, son dernier jour une fois terminé), pour qu'un
  exercice à moitié écoulé ne double pas les délais.
- Sans chiffre d'affaires ou sans achats, le délai est vide plutôt qu'infini.

## Ratios

| Ratio | Calcul |
|---|---|
| Taux de marge | Marge commerciale / coût d'achat des marchandises vendues |
| Taux de marque | Marge commerciale / ventes de marchandises HT |
| EBE / chiffre d'affaires | EBE / comptes 70 |
| Résultat / chiffre d'affaires | Résultat de l'exercice / comptes 70 |
| Ratio d'endettement | Dettes financières / capitaux propres |

Un ratio dont le dénominateur est nul ou négatif (pas de marchandises,
capitaux propres négatifs) est vide. Les ratios sont exprimés en fractions
dans l'API et les outils MCP (0,25 pour 25 %).

## API et exports

| Route | Droit | Réponse |
|---|---|---|
| `GET /api/reports/financial-indicators?companyId=&fiscalYearId=` | `reports:read` | Exercice (avec le jour de référence `asOf`), indicateurs de l'exercice et de l'exercice précédent, en centimes |
| `GET /api/reports/financial-indicators/export?companyId=&fiscalYearId=&format=csv\|xlsx` | `reports:export`, limite `export` | Fichier `SIG_<société>_<année>.csv` ou `.xlsx` : rubrique, libellé, opération, unité, N, N-1, variation, comptes et lignes |

Sans `fiscalYearId`, l'exercice en cours (ou le dernier). Un exercice d'une
autre société répond 404, une société sans exercice 400. Le CSV passe par
`lib/reports/csv-safe` (formules neutralisées, séparateur `;`, virgule
décimale, marque d'ordre des octets UTF-8).

## Vérification

Chaque indicateur suit le PCG et les formulaires cités ci-dessus, avec un
exemple entièrement calculé à la main dans les tests
(`lib/reports/financial-indicators/__tests__/worked-example.ts`). Points
vérifiés en particulier : l'EBE n'est pas réduit aux dotations (68), les
délais clients et fournisseurs comparent des montants TTC à des flux TTC, et
les dettes financières de l'indicateur excluent les découverts et les comptes
d'associés.
