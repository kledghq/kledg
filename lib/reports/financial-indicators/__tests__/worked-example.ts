/**
 * Worked example of the financial indicators: the year-end account totals
 * of a small company that resells goods and sells services, with every
 * figure computed by hand below (euros; the code works in cents).
 *
 * Income statement accounts (PCG 2026, règlement ANC 2022-06):
 *
 *   707000 Ventes de marchandises           C 200 000
 *   709700 RRR accordés sur marchandises     D   2 000
 *   706000 Prestations de services          C 100 000
 *   708500 Ports et frais facturés          C   1 000
 *   713500 Variation des stocks de produits C   3 000
 *   721000 Production immobilisée           C   5 000
 *   741000 Subventions d'exploitation       C   4 000
 *   747000 Quote-part subv. investissement  C   1 500
 *   755500 Quote-part de bénéfice (commun)  C     700
 *   757000 Produits de cession immo.        C   8 000
 *   758000 Indemnités et autres produits    C     500
 *   764000 Revenus des VMP                  C     600
 *   767100 Cession immo. financières        C   1 000
 *   778000 Autres produits exceptionnels    C     900
 *   781500 Reprises provisions exploitation C   1 200
 *   786500 Reprises provisions financières  C     300
 *   787500 Reprises provisions exceptionn.  C     400
 *   791000 Transferts de charges            C     800
 *
 *   607000 Achats de marchandises           D 120 000
 *   609700 RRR obtenus sur marchandises     C   1 000
 *   603700 Variation stock marchandises     D   5 000
 *   601000 Achats de matières premières     D  20 000
 *   603100 Variation stock matières         C   2 000
 *   606100 Fournitures non stockables       D   3 000
 *   613200 Locations immobilières           D  12 000
 *   622600 Honoraires                       D   4 000
 *   626000 Frais postaux et télécom         D   1 000
 *   635110 Contribution économique territ.  D   2 500
 *   641100 Salaires                         D  60 000
 *   645100 Cotisations Urssaf               D  25 000
 *   651100 Redevances                       D   1 500
 *   655500 Quote-part de perte (commun)     D     200
 *   657000 VNC des immobilisations cédées   D   6 000
 *   661160 Intérêts des emprunts            D   2 200
 *   667100 VNC des immo. financières cédées D   1 200
 *   678000 Autres charges exceptionnelles   D   1 100
 *   681120 Dotations amort. immo. corp.     D   9 000
 *   681500 Dotations provisions exploit.    D   1 000
 *   686500 Dotations provisions financières D     500
 *   687250 Amortissements dérogatoires      D     700
 *   691000 Participation des salariés       D   1 000
 *   695100 Impôt sur les sociétés           D   9 000
 *
 * Soldes intermédiaires de gestion:
 *   Ventes de marchandises        200 000 - 2 000                  = 198 000
 *   Coût des marchandises vendues 120 000 - 1 000 + 5 000          = 124 000
 *   Marge commerciale             198 000 - 124 000                =  74 000
 *   Production vendue             100 000 + 1 000                  = 101 000
 *   Production de l'exercice      101 000 + 3 000 + 5 000          = 109 000
 *   Consommations de tiers        20 000 - 2 000 + 3 000 + 12 000 + 4 000 + 1 000 = 38 000
 *   Valeur ajoutée                74 000 + 109 000 - 38 000        = 145 000
 *   EBE                           145 000 + 4 000 - 2 500 - 85 000 =  61 500
 *     (747 is not a subvention d'exploitation: it is a calculated product)
 *   Reprises et transferts        1 200 + 800                      =   2 000
 *   Autres produits               500 + 8 000 (757) + 1 500 (747)  =  10 000
 *   Dotations d'exploitation      9 000 + 1 000                    =  10 000
 *   Autres charges                1 500 + 6 000 (657)              =   7 500
 *   Résultat d'exploitation       61 500 + 2 000 + 10 000 - 10 000 - 7 500 = 56 000
 *   Quotes-parts en commun        700 - 200                        =     500
 *   Produits financiers           600 + 1 000 + 300                =   1 900
 *   Charges financières           2 200 + 1 200 + 500              =   3 900
 *   Résultat courant avant impôts 56 000 + 500 + 1 900 - 3 900     =  54 500
 *   Résultat exceptionnel         (900 + 400) - (1 100 + 700)      =    -500
 *   Résultat de l'exercice        54 500 - 500 - 1 000 - 9 000     =  44 000
 *   Check: produits 326 900 - charges 282 900                      =  44 000
 *   Plus-values de cession        (8 000 + 1 000) - (6 000 + 1 200) = 1 800
 *   Chiffre d'affaires (70)       198 000 + 101 000                = 299 000
 *
 * CAF, additive method:
 *   44 000 + dotations (10 000 + 500 + 700) - reprises (1 200 + 300 + 400)
 *   + VNC cédées (6 000 + 1 200) - produits de cession (8 000 + 1 000)
 *   - quote-part de subventions (1 500)                            =  50 000
 * Subtractive method, from the EBE:
 *   61 500 + 800 (791) + 500 (758) - 1 500 (651) + 700 - 200 + 600 - 2 200
 *   + 900 - 1 100 - 1 000 - 9 000                                  =  50 000
 *
 * Balance sheet accounts (balanced: actif = passif = 191 100):
 *
 *   101300 Capital C 50 000      106800 Réserves C 20 000     164000 Emprunts C 30 000
 *   455000 Associés C 5 000      218300 Matériel D 80 000     281830 Amortissements C 25 000
 *   310000 Matières D 12 000     370000 Marchandises D 30 000 397000 Dépréciation C 3 000
 *   411000 Clients D 59 800      491000 Dépréciation C 1 800  409100 Avances versées D 2 000
 *   401000 Fournisseurs C 21 600 401100 Fournisseur débiteur D 400
 *   421000 Personnel C 4 000     431000 Urssaf C 6 000        444000 État, IS C 3 000
 *   445660 TVA déductible D 1 000                             445710 TVA collectée C 5 000
 *   467000 Débiteurs divers D 700                             503000 VMP D 4 000
 *   512000 Banque D 31 000       512100 Banque en découvert C 2 500
 *
 *   Stocks                 12 000 + 30 000 - 3 000           =  39 000 (2050 BL + BT)
 *   Créances clients       59 800 - 1 800                    =  58 000 (2050 BX)
 *   Autres créances d'exploitation 2 000 (4091, BV) + 400 (401 débiteur) + 1 000 (44566) = 3 400
 *     (467 débiteurs divers is in BZ but outside the operating cycle)
 *   Dettes fournisseurs                                       =  21 600 (2051 DX)
 *   Dettes fiscales et sociales 4 000 + 6 000 + 3 000 + 5 000 =  18 000 (2051 DY)
 *   BFR  39 000 + 58 000 + 3 400 - 21 600 - 18 000            =  60 800
 *   Trésorerie nette 4 000 + 31 000 - 2 500                   =  32 500
 *   Dettes financières 30 000 + 2 500 - 2 500                 =  30 000 (455 stays in EA)
 *   Capitaux propres 50 000 + 20 000 + 44 000                 = 114 000
 *   Ratio d'endettement 30 000 / 114 000 = 0.263157...        ->  0.2632
 *
 * Delays over a year of 365 days, with the VAT recorded on the flows:
 *   TVA collectée (4457 credits) 59 800, TVA déductible (44566 debits) 30 000
 *   CA TTC 299 000 + 59 800 = 358 800; DSO = 59 800 / 358 800 x 365 = 60.8 -> 61 days
 *   Achats HT (60 without 603, 61, 62) 120 000 - 1 000 + 20 000 + 3 000 + 12 000 + 4 000 + 1 000 = 159 000
 *   Achats TTC 159 000 + 30 000 = 189 000; DPO = 21 600 / 189 000 x 365 = 41.7 -> 42 days
 *
 * Ratios: taux de marge 74 000 / 124 000 = 0.5968, taux de marque
 * 74 000 / 198 000 = 0.3737, EBE / CA 61 500 / 299 000 = 0.2057, résultat /
 * CA 44 000 / 299 000 = 0.1472.
 */

import type { AccountTotals } from '@/lib/reports/statements/allocation'

const euros = (value: number) => Math.round(value * 100)
const debit = (code: string, amount: number): AccountTotals => ({ code, debitCents: euros(amount), creditCents: 0 })
const credit = (code: string, amount: number): AccountTotals => ({ code, debitCents: 0, creditCents: euros(amount) })

export const WORKED_EXAMPLE_ACCOUNTS: AccountTotals[] = [
  credit('707000', 200_000),
  debit('709700', 2_000),
  credit('706000', 100_000),
  credit('708500', 1_000),
  credit('713500', 3_000),
  credit('721000', 5_000),
  credit('741000', 4_000),
  credit('747000', 1_500),
  credit('755500', 700),
  credit('757000', 8_000),
  credit('758000', 500),
  credit('764000', 600),
  credit('767100', 1_000),
  credit('778000', 900),
  credit('781500', 1_200),
  credit('786500', 300),
  credit('787500', 400),
  credit('791000', 800),
  debit('607000', 120_000),
  credit('609700', 1_000),
  debit('603700', 5_000),
  debit('601000', 20_000),
  credit('603100', 2_000),
  debit('606100', 3_000),
  debit('613200', 12_000),
  debit('622600', 4_000),
  debit('626000', 1_000),
  debit('635110', 2_500),
  debit('641100', 60_000),
  debit('645100', 25_000),
  debit('651100', 1_500),
  debit('655500', 200),
  debit('657000', 6_000),
  debit('661160', 2_200),
  debit('667100', 1_200),
  debit('678000', 1_100),
  debit('681120', 9_000),
  debit('681500', 1_000),
  debit('686500', 500),
  debit('687250', 700),
  debit('691000', 1_000),
  debit('695100', 9_000),
  credit('101300', 50_000),
  credit('106800', 20_000),
  credit('164000', 30_000),
  credit('455000', 5_000),
  debit('218300', 80_000),
  credit('281830', 25_000),
  debit('310000', 12_000),
  debit('370000', 30_000),
  credit('397000', 3_000),
  debit('411000', 59_800),
  credit('491000', 1_800),
  debit('409100', 2_000),
  credit('401000', 21_600),
  debit('401100', 400),
  credit('421000', 4_000),
  credit('431000', 6_000),
  credit('444000', 3_000),
  debit('445660', 1_000),
  credit('445710', 5_000),
  debit('467000', 700),
  debit('503000', 4_000),
  debit('512000', 31_000),
  credit('512100', 2_500),
]

export const WORKED_EXAMPLE_VAT = { collecteeCents: euros(59_800), deductibleCents: euros(30_000) }
