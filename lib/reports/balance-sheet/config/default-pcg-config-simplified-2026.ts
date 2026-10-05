/**
 * Default PCG 2026 simplified balance sheet configuration
 * Based on complete balance sheet config pattern and official Bilan Simplifié structure
 *
 * Structure (same as complete):
 * - 'group': Visual organization header (no calculation)
 * - 'sum': Sums its children (balanceType: 'auto')
 * - 'line': Line with account codes
 *
 * displayType:
 * - 'brut_amort_net': ACTIF lines with Brut / Amortissements, Provisions / Net columns
 * - 'net': PASSIF and lines without amortissement
 *
 * Form codes from official Bilan Simplifié (e.g. 010, 014, 028, 044/048, 050, 060, etc.)
 *
 * Account mapping (PCG art. 821-1 and the notice of form 2033-A): every
 * account of classes 1 to 5 belongs to exactly one line for a balance of a
 * given sign. Account codes are prefixes and the most specific prefix wins
 * (lib/reports/statements/allocation.ts), so a short prefix ("40") is a
 * catch-all for the accounts that no longer prefix takes. Accounts marked
 * (D) / (C) by the notice appear on both sides: a debit balance goes to the
 * actif line, a credit balance to the passif line (51 in credit is a bank
 * overdraft, 40 in debit an "Autres créances", 41 in credit an "Autres
 * dettes"). The coverage is checked by
 * lib/reports/statements/__tests__/default-mapping.test.ts.
 */

import type { DefaultBalanceSheetConfigEntry } from './default-pcg-config-complete-2026'
import { createConfig } from './default-pcg-config-complete-2026'

/**
 * Simplified balance sheet configuration based on PCG 2026 Bilan Simplifié
 * Grouped lines per official form; account codes aligned with complete config
 */
export const SIMPLIFIED_BALANCE_SHEET_CONFIG_2026: DefaultBalanceSheetConfigEntry[] = [
  // ========== ACTIF ==========
  // Pas de wrapper : racines = Capital souscrit, Actif immobilisé, Actif circulant, Comptes de régularisation

  createConfig('simplified', 'Actif immobilisé', {
    section: 'actif',
    lineType: 'sum',
    formCode: '044',
    amortissementFormCode: '048',
    accountCodes: [],
    balanceType: 'auto',
    displayType: 'brut_amort_net',
    order: 2,
    notes: '(5) Coût de revient / Prix de vente hors TVA (renvois 182, 184)',
    children: [
      createConfig('simplified', 'Immobilisations incorporelles', {
        lineType: 'sum',
        accountCodes: [],
        balanceType: 'auto',
        displayType: 'brut_amort_net',
        order: 3,
        children: [
          // Fonds commercial: 206, 207 | 2806, 2807, 2906, 2907. Notice 2033-NOT-SD
          // 2026, line 010: "Il comprend notamment le droit au bail."
          createConfig('simplified', 'Fonds commercial', {
            formCode: '010',
            amortissementFormCode: '012',
            accountCodes: ['206', '207'],
            amortissementAccountCodes: ['2806', '2807', '2906', '2907'],
            balanceType: 'debit',
            displayType: 'brut_amort_net',
            order: 4,
          }),
          // Autres: 20 [sauf 206, 207], 232, 237 | 280, 290, 2932. The 2033-A has no
          // line for frais d'établissement (201): they are other intangible
          // assets here (notice, line 014: développement, concessions, avances)
          createConfig('simplified', 'Autres', {
            formCode: '014',
            amortissementFormCode: '016',
            accountCodes: ['20', '232', '237'],
            amortissementAccountCodes: ['280', '290', '2932'],
            balanceType: 'debit',
            displayType: 'brut_amort_net',
            order: 5,
          }),
        ],
      }),

      // Immobilisations corporelles: 21, 22, 23 [sauf 232, 237] | 281, 282, 291, 292, 293 [sauf 2932]
      // (28 and 29 catch the depreciation accounts no other line takes)
      createConfig('simplified', 'Immobilisations corporelles', {
        formCode: '028',
        amortissementFormCode: '030',
        accountCodes: ['21', '22', '23'],
        amortissementAccountCodes: ['281', '282', '291', '292', '293', '28', '29'],
        balanceType: 'debit',
        displayType: 'brut_amort_net',
        order: 6,
      }),
      // Immobilisations financières: 26, 27 [sauf 269, 279 au passif] | 296, 297
      createConfig('simplified', 'Immobilisations financières', {
        formCode: '040',
        amortissementFormCode: '042',
        accountCodes: ['26', '27'],
        amortissementAccountCodes: ['296', '297'],
        balanceType: 'debit',
        displayType: 'brut_amort_net',
        order: 7,
        notes: '(1) Dont immobilisations financières à moins d\'un an',
      }),
    ],
  }),

  createConfig('simplified', 'Actif circulant', {
    section: 'actif',
    lineType: 'sum',
    formCode: '096',
    amortissementFormCode: '098',
    accountCodes: [],
    balanceType: 'auto',
    displayType: 'brut_amort_net',
    order: 3,
    children: [
      createConfig('simplified', 'Stocks', {
        lineType: 'sum',
        accountCodes: [],
        balanceType: 'auto',
        displayType: 'brut_amort_net',
        order: 9,
        children: [
          // 31 to 36, 38 | 39 [sauf 397]
          createConfig('simplified', 'Matières premières, approvisionnements, en cours de production', {
            formCode: '050',
            amortissementFormCode: '052',
            accountCodes: ['31', '32', '33', '34', '35', '36', '38'],
            amortissementAccountCodes: ['39'],
            balanceType: 'debit',
            displayType: 'brut_amort_net',
            order: 10,
          }),
          // 37 | 397
          createConfig('simplified', 'Marchandises', {
            formCode: '060',
            amortissementFormCode: '062',
            accountCodes: ['37'],
            amortissementAccountCodes: ['397'],
            balanceType: 'debit',
            displayType: 'brut_amort_net',
            order: 11,
          }),
        ],
      }),
      createConfig('simplified', 'Avances et acomptes versés sur commandes', {
        formCode: '064',
        amortissementFormCode: '066',
        accountCodes: ['4091'],
        balanceType: 'debit',
        displayType: 'net',
        order: 12,
      }),
      createConfig('simplified', 'Créances', {
        lineType: 'sum',
        accountCodes: [],
        balanceType: 'auto',
        displayType: 'brut_amort_net',
        order: 13,
        children: [
          // Clients: 41 (D) [sauf 4191 avances reçues] | 491
          createConfig('simplified', 'Clients et comptes rattachés', {
            formCode: '068',
            amortissementFormCode: '070',
            accountCodes: ['41'],
            amortissementAccountCodes: ['491'],
            balanceType: 'debit',
            displayType: 'brut_amort_net',
            order: 14,
          }),
          // Autres créances: 40 (D) [sauf 4091], 42 to 47 (D) [sauf 474, 476],
          // 18 (D), 48 (D) [sauf 481, 486, 4886], 52 (D), 58 (D) | 49 [sauf 491]
          createConfig('simplified', 'Autres', {
            formCode: '072',
            amortissementFormCode: '074',
            // Notice, line 072: "personnel, organismes sociaux, État, associés,
            // débiteurs divers". The 2033-A has no line for the capital souscrit
            // non appelé (109) nor for the écarts de conversion actif (474, 476).
            accountCodes: ['18', '40', '42', '43', '44', '45', '46', '47', '48', '52', '58', '109'],
            amortissementAccountCodes: ['49'],
            balanceType: 'debit',
            displayType: 'brut_amort_net',
            order: 15,
            notes: '(3) Dont compte courant d\'associés débiteurs',
          }),
        ],
      }),
      // Valeurs mobilières de placement: 50 [sauf 509] | 59
      createConfig('simplified', 'Valeurs mobilières de placement', {
        formCode: '080',
        amortissementFormCode: '082',
        accountCodes: ['50'],
        excludedAccountCodes: ['509'],
        amortissementAccountCodes: ['59'],
        balanceType: 'debit',
        displayType: 'brut_amort_net',
        order: 16,
      }),
      // Disponibilités: 51 (D), 53, 54
      createConfig('simplified', 'Disponibilités', {
        formCode: '084',
        amortissementFormCode: '086',
        accountCodes: ['51', '53', '54'],
        balanceType: 'debit',
        displayType: 'net',
        order: 17,
      }),
      // Charges constatées d'avance: 486, 4886
      createConfig('simplified', 'Charges constatées d\'avance *', {
        formCode: '092',
        amortissementFormCode: '094',
        // With the deferred borrowing costs (481, 169): no line of their own on the 2033-A
        accountCodes: ['486', '4886', '481', '169'],
        balanceType: 'debit',
        displayType: 'net',
        order: 18,
      }),
    ],
  }),

  // ========== PASSIF ==========
  // Pas de wrapper : racines = Capitaux propres, Provisions, Dettes, Comptes de régularisation

  createConfig('simplified', 'Capitaux propres', {
    section: 'passif',
    lineType: 'sum',
    formCode: '142',
    accountCodes: [],
    balanceType: 'auto',
    displayType: 'net',
    order: 5,
    children: [
      // Capital: 101, 108 (10 catches 102 and the other 10 accounts)
      createConfig('simplified', 'Capital social ou individuel', {
        formCode: '120',
        // 104 (primes): the 2033-A has no line for them
        accountCodes: ['101', '104', '108', '10'],
        balanceType: 'credit',
        displayType: 'net',
        order: 21,
      }),
      createConfig('simplified', 'Écarts de réévaluation et d\'équivalence', {
        formCode: '124',
        accountCodes: ['105', '107'],
        balanceType: 'credit',
        displayType: 'net',
        order: 22,
      }),
      createConfig('simplified', 'Réserve légale', {
        formCode: '126',
        accountCodes: ['1061'],
        balanceType: 'credit',
        displayType: 'net',
        order: 23,
      }),
      createConfig('simplified', 'Réserves réglementées', {
        formCode: '130',
        accountCodes: ['1064'],
        balanceType: 'credit',
        displayType: 'net',
        order: 24,
      }),
      createConfig('simplified', 'Autres réserves', {
        formCode: '132',
        accountCodes: ['1062', '1063', '1068', '106'],
        balanceType: 'credit',
        displayType: 'net',
        order: 25,
      }),
      // 110 (C), 119 (D): a debit balance is shown as a negative amount
      createConfig('simplified', 'Report à nouveau', {
        formCode: '134',
        accountCodes: ['11'],
        balanceType: 'credit',
        displayType: 'net',
        order: 26,
      }),
      // 120 (C), 129 (D), 1209 (D) plus the result of the year (classes 6 and 7)
      createConfig('simplified', 'Résultat de l\'exercice', {
        formCode: '136',
        accountCodes: ['12'],
        balanceType: 'credit',
        displayType: 'net',
        order: 27,
      }),
      createConfig('simplified', 'Subventions d\'investissement', {
        formCode: '137',
        accountCodes: ['13'],
        balanceType: 'credit',
        displayType: 'net',
        order: 28,
      }),
      createConfig('simplified', 'Provisions réglementées', {
        formCode: '140',
        accountCodes: ['14'],
        balanceType: 'credit',
        displayType: 'net',
        order: 29,
      }),
    ],
  }),

  createConfig('simplified', 'Provisions', {
    section: 'passif',
    lineType: 'sum',
    formCode: '154',
    accountCodes: [],
    balanceType: 'auto',
    displayType: 'net',
    order: 6,
    children: [
      createConfig('simplified', 'Provisions pour risques', {
        accountCodes: ['151'],
        balanceType: 'credit',
        displayType: 'net',
        order: 31,
      }),
      createConfig('simplified', 'Provisions pour charges', {
        accountCodes: ['152', '15'],
        balanceType: 'credit',
        displayType: 'net',
        order: 32,
      }),
    ],
  }),

  createConfig('simplified', 'Dettes', {
    section: 'passif',
    lineType: 'sum',
    formCode: '176',
    accountCodes: [],
    balanceType: 'auto',
    displayType: 'net',
    order: 7,
    notes: '(4) Dont dettes à plus d\'un an',
    children: [
      // Emprunts et dettes assimilées: 16 [sauf 167 et 169], 17, 51 (C)
      createConfig('simplified', 'Emprunts et dettes assimilées', {
        formCode: '156',
        // 167 (fonds non remboursables, avances conditionnées): no "autres fonds
        // propres" on the 2033-A
        accountCodes: ['16', '17', '51'],
        excludedAccountCodes: ['169'],
        balanceType: 'credit',
        displayType: 'net',
        order: 34,
      }),
      createConfig('simplified', 'Avances et acomptes reçus sur commandes en cours', {
        formCode: '164',
        accountCodes: ['4191'],
        balanceType: 'credit',
        displayType: 'net',
        order: 35,
      }),
      // Fournisseurs: 40 (C) [sauf 404, 405, 4084 dettes sur immobilisations]
      createConfig('simplified', 'Fournisseurs et comptes rattachés', {
        formCode: '166',
        accountCodes: ['401', '403', '4081', '4088', '40'],
        balanceType: 'credit',
        displayType: 'net',
        order: 36,
      }),
      // Dettes fiscales et sociales: 42, 43, 44 (C)
      createConfig('simplified', 'Dettes fiscales et sociales', {
        formCode: '172',
        accountCodes: ['42', '43', '44'],
        balanceType: 'credit',
        displayType: 'net',
        order: 37,
      }),
      createConfig('simplified', 'Comptes courants d\'associés', {
        formCode: '173',
        accountCodes: ['455'],
        balanceType: 'credit',
        displayType: 'net',
        order: 38,
      }),
      // Autres dettes: 269, 279, 404, 405, 4084, 41 (C) [sauf 4191], 45 (C)
      // [sauf 455], 46 (C), 47 (C) [sauf 475, 477], 18 (C), 48 (C), 509,
      // 52 (C), 58 (C)
      createConfig('simplified', 'Autres dettes', {
        formCode: '175',
        // 229 (droits du concédant) and the écarts de conversion passif (475,
        // 477): no line of their own on the 2033-A
        accountCodes: ['269', '279', '404', '405', '4084', '41', '45', '46', '47', '18', '48', '509', '52', '58', '229'],
        balanceType: 'credit',
        displayType: 'net',
        order: 39,
      }),
      createConfig('simplified', 'Produits constatés d\'avance', {
        formCode: '174',
        accountCodes: ['487', '4887'],
        balanceType: 'credit',
        displayType: 'net',
        order: 40,
      }),
    ],
  }),
]
