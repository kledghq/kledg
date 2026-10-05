/**
 * Default PCG 2026 complete balance sheet configuration
 * Based on official PCG 2026 structure with groups, sums, and lines
 * 
 * Structure:
 * - 'group': Visual organization header (no calculation)
 * - 'sum': Sums its children (balanceType: 'auto')
 * - 'line': Line with account codes
 * 
 * displayType:
 * - 'brut_amort_net': When both brut and amortissements account codes exist
 * - 'net': When only brut account codes exist
 * 
 * Uses nested structure with children arrays instead of linePath
 */

/**
 * Default config entry with nested children structure
 */
export interface DefaultBalanceSheetConfigEntry {
  reportVariant: 'complete' | 'simplified'
  section?: 'actif' | 'passif' // Explicit section for easy sorting
  lineLabel: string
  lineType?: 'group' | 'sum' | 'line'
  formCode?: string | null
  amortissementFormCode?: string | null
  accountCodes?: string[]
  excludedAccountCodes?: string[]
  amortissementAccountCodes?: string[]
  filterType?: string | null
  balanceType?: 'debit' | 'credit' | 'auto'
  displayType?: 'net' | 'brut_amort_net'
  order: number
  notes?: string | null
  children?: DefaultBalanceSheetConfigEntry[] // Nested children
}

/**
 * Helper to create a config entry
 */
export function createConfig(
  reportVariant: 'complete' | 'simplified',
  lineLabel: string,
  options: {
    section?: 'actif' | 'passif' // Explicit section for easy sorting
    lineType?: 'group' | 'sum' | 'line'
    formCode?: string | null // Form code for Brut column
    amortissementFormCode?: string | null // Form code for Amortissements column
    accountCodes?: string[]
    excludedAccountCodes?: string[]
    amortissementAccountCodes?: string[] // Comptes pour la colonne Amortissement
    filterType?: string | null
    balanceType?: 'debit' | 'credit' | 'auto'
    displayType?: 'net' | 'brut_amort_net'
    order: number
    notes?: string | null
    children?: DefaultBalanceSheetConfigEntry[] // Nested children
  }
): DefaultBalanceSheetConfigEntry {
  const {
    lineType = options.accountCodes && options.accountCodes.length > 0 ? 'line' : 'group',
    formCode = null,
    accountCodes = [],
    excludedAccountCodes = [],
    filterType = 'starts_with',
    balanceType = 'debit',
    displayType = 'net',
    order,
    notes = null,
    children = [],
  } = options

  return {
    reportVariant,
    section: options.section,
    lineLabel,
    lineType,
    formCode,
    amortissementFormCode: options.amortissementFormCode || null,
    accountCodes,
    excludedAccountCodes,
    amortissementAccountCodes: options.amortissementAccountCodes || [],
    filterType,
    balanceType,
    displayType,
    order,
    notes,
    children,
  }
}

/**
 * Complete balance sheet configuration based on PCG 2026
 * Structure from official forms with proper grouping
 * Form codes from official tax form 2033-SD
 * Uses nested structure with children arrays instead of linePath
 *
 * Account mapping (PCG art. 821-1 and the notices of forms 2050 and 2051):
 * every account of classes 1 to 5 belongs to exactly one line for a balance
 * of a given sign. Account codes are prefixes and the most specific prefix
 * wins (lib/reports/statements/allocation.ts), so a short prefix ("40") is a
 * catch-all for the accounts that no longer prefix takes. Accounts marked
 * (D) / (C) appear on both sides: a debit balance goes to the actif line, a
 * credit balance to the passif line (51 in credit is a bank overdraft, 40 in
 * debit an "Autres créances", 41 in credit an "Autres dettes"). The coverage
 * is checked by lib/reports/statements/__tests__/default-mapping.test.ts.
 */
export const COMPLETE_BALANCE_SHEET_CONFIG_2026: DefaultBalanceSheetConfigEntry[] = [
  // ========== ACTIF ==========

  // Capital souscrit non appelé
  createConfig('complete', 'Capital souscrit non appelé', {
    section: 'actif',
    formCode: 'AA',
    lineType: 'line',
    accountCodes: ['109'],
    balanceType: 'debit',
    displayType: 'net',
    order: 2,
  }),

  // Group: Actif immobilisé
  createConfig('complete', 'Actif immobilisé', {
    section: 'actif',
    lineType: 'sum',
    formCode: 'BJ',
    amortissementFormCode: 'BK',
    balanceType: 'auto',
    displayType: 'brut_amort_net',
    order: 3,
    children: [
      // Frais d'établissement
      createConfig('complete', 'Frais d\'établissement', {
        formCode: 'AB',
        amortissementFormCode: 'AC',
        accountCodes: ['201'],
        amortissementAccountCodes: ['2801', '2901'],
        balanceType: 'debit',
        displayType: 'brut_amort_net',
        order: 4,
      }),

      // Group: Immobilisations incorporelles
      createConfig('complete', 'Immobilisations incorporelles', {
        lineType: 'group',
        accountCodes: [],
        balanceType: 'auto',
        displayType: 'brut_amort_net',
        order: 5,
        children: [


          // Frais de développement
          createConfig('complete', 'Frais de développement', {
            formCode: 'CX',
            amortissementFormCode: 'CQ',
            accountCodes: ['203'],
            amortissementAccountCodes: ['2803', '2903'],
            balanceType: 'debit',
            displayType: 'brut_amort_net',
            order: 6,
          }),

          // Concessions, brevets et droits similaires
          createConfig('complete', 'Concessions, brevets et droits similaires', {
            formCode: 'AF',
            amortissementFormCode: 'AG',
            accountCodes: ['205'],
            amortissementAccountCodes: ['2805', '2905'],
            balanceType: 'debit',
            displayType: 'brut_amort_net',
            order: 7,
          }),

          // Fonds commercial
          // With the droit au bail (206): the PCG list groups 206 with 207, the 2025
          // form had "(1) dont droit au bail" on this line and the 2033 notice says
          // line 010 "comprend notamment le droit au bail" (renvoi dropped in 2026).
          createConfig('complete', 'Fonds commercial', {
            formCode: 'AH',
            amortissementFormCode: 'AI',
            accountCodes: ['206', '207'],
            amortissementAccountCodes: ['2806', '2807', '2906', '2907'],
            balanceType: 'debit',
            displayType: 'brut_amort_net',
            order: 8,
          }),

          // Autres immobilisations incorporelles
          createConfig('complete', 'Autres immobilisations incorporelles', {
            formCode: 'AJ',
            amortissementFormCode: 'AK',
            accountCodes: ['208', '20'],
            amortissementAccountCodes: ['2808', '2908', '280', '290'],
            balanceType: 'debit',
            displayType: 'brut_amort_net',
            order: 9,
          }),

          // Immobilisations incorporelles en cours, avances et acomptes
          createConfig('complete', 'Immobilisations incorporelles en cours, avances et acomptes', {
            formCode: 'AL',
            amortissementFormCode: 'AM',
            accountCodes: ['232', '237'],
            amortissementAccountCodes: ['2932'],
            balanceType: 'debit',
            displayType: 'brut_amort_net',
            order: 10,
          }),
        ],
      }),

      // Group: Immobilisations corporelles
      createConfig('complete', 'Immobilisations corporelles', {
        lineType: 'group',
        accountCodes: [],
        balanceType: 'auto',
        order: 11,
        children: [
          // Terrains
          createConfig('complete', 'Terrains', {
            formCode: 'AN',
            amortissementFormCode: 'AO',
            accountCodes: ['211', '212'],
            amortissementAccountCodes: ['2811', '2911', '2812', '2912'],
            balanceType: 'debit',
            displayType: 'brut_amort_net',
            order: 12,
          }),

          // Constructions
          createConfig('complete', 'Constructions', {
            formCode: 'AP',
            amortissementFormCode: 'AQ',
            accountCodes: ['213', '214'],
            amortissementAccountCodes: ['2813', '2814', '2913', '2914'],
            balanceType: 'debit',
            displayType: 'brut_amort_net',
            order: 13,
          }),

          // Installations techniques, matériel et outillage industriels
          createConfig('complete', 'Installations techniques, matériel et outillage industriels', {
            formCode: 'AR',
            amortissementFormCode: 'AS',
            accountCodes: ['215'],
            amortissementAccountCodes: ['2815', '2915'],
            balanceType: 'debit',
            displayType: 'brut_amort_net',
            order: 14,
          }),

          // Autres immobilisations corporelles
          createConfig('complete', 'Autres immobilisations corporelles', {
            formCode: 'AT',
            amortissementFormCode: 'AU',
            accountCodes: ['218', '21', '22'],
            amortissementAccountCodes: ['2818', '2918', '281', '282', '291', '292', '28', '29'],
            balanceType: 'debit',
            displayType: 'brut_amort_net',
            order: 15,
          }),

          // Immobilisations corporelles en cours, avances et acomptes
          createConfig('complete', 'Immobilisations corporelles en cours, avances et acomptes', {
            formCode: 'AV',
            amortissementFormCode: 'AW',
            accountCodes: ['231', '238', '23'],
            amortissementAccountCodes: ['2931', '293'],
            balanceType: 'debit',
            displayType: 'brut_amort_net',
            order: 16,
          }),
        ],
      }),

      // Group: Immobilisations financières (2)
      createConfig('complete', 'Immobilisations financières', {
        lineType: 'group',
        accountCodes: [],
        balanceType: 'auto',
        order: 17,
        children: [
          // Participations
          createConfig('complete', 'Participations', {
            formCode: 'CS',
            amortissementFormCode: 'CT',
            accountCodes: ['261', '262', '266', '26'],
            amortissementAccountCodes: ['2961', '2962', '2966', '296'],
            balanceType: 'debit',
            displayType: 'brut_amort_net',
            order: 18,
          }),

          // Titres immobilisés de l'activité de portefeuille
          createConfig('complete', 'Titres immobilisés de l\'activité de portefeuille', {
            formCode: 'CU',
            amortissementFormCode: 'CV',
            accountCodes: ['273'],
            amortissementAccountCodes: ['2973'],
            balanceType: 'debit',
            displayType: 'brut_amort_net',
            order: 19,
          }),

          // Créances rattachées à des participations
          createConfig('complete', 'Créances rattachées à des participations', {
            formCode: 'BB',
            amortissementFormCode: 'BC',
            accountCodes: ['267', '268'],
            amortissementAccountCodes: ['2967', '2968'],
            balanceType: 'debit',
            displayType: 'brut_amort_net',
            order: 20,
          }),

          // Autres titres immobilisés
          createConfig('complete', 'Autres titres immobilisés', {
            formCode: 'BD',
            amortissementFormCode: 'BE',
            accountCodes: ['271', '272', '27682', '277'],
            amortissementAccountCodes: ['2971', '2972'],
            balanceType: 'debit',
            displayType: 'brut_amort_net',
            order: 21,
          }),

          // Prêts
          createConfig('complete', 'Prêts', {
            formCode: 'BF',
            amortissementFormCode: 'BG',
            accountCodes: ['274', '27684'],
            amortissementAccountCodes: ['2974'],
            balanceType: 'debit',
            displayType: 'brut_amort_net',
            order: 22,
          }),

          // Autres immobilisations financières
          createConfig('complete', 'Autres immobilisations financières', {
            formCode: 'BH',
            amortissementFormCode: 'BI',
            accountCodes: ['275', '2761', '27685', '27688', '27'],
            amortissementAccountCodes: ['297'],
            balanceType: 'debit',
            displayType: 'brut_amort_net',
            order: 23,
          }),
        ],
      }),
    ],
  }),

  // Group: Actif circulant
  createConfig('complete', 'Actif circulant', {
    section: 'actif',
    lineType: 'group',
    accountCodes: [],
    balanceType: 'auto',
    order: 25,
    children: [
      // Group: Stocks
      createConfig('complete', 'Stocks', {
        lineType: 'group',
        accountCodes: [],
        balanceType: 'auto',
        order: 26,
        children: [
          // Matières premières, approvisionnements
          createConfig('complete', 'Matières premières, approvisionnements', {
            formCode: 'BL',
            amortissementFormCode: 'BM',
            accountCodes: ['31', '32', '36', '38'],
            amortissementAccountCodes: ['391', '392', '39'],
            balanceType: 'debit',
            displayType: 'brut_amort_net',
            order: 27,
          }),

          // En cours de production de biens
          createConfig('complete', 'En cours de production de biens', {
            formCode: 'BN',
            amortissementFormCode: 'BO',
            accountCodes: ['33'],
            amortissementAccountCodes: ['393'],
            balanceType: 'debit',
            displayType: 'brut_amort_net',
            order: 28,
          }),

          // En cours de production de services
          createConfig('complete', 'En cours de production de services', {
            formCode: 'BP',
            amortissementFormCode: 'BQ',
            accountCodes: ['34'],
            amortissementAccountCodes: ['394'],
            balanceType: 'debit',
            displayType: 'brut_amort_net',
            order: 29,
          }),

          // Produits intermédiaires et finis
          createConfig('complete', 'Produits intermédiaires et finis', {
            formCode: 'BR',
            amortissementFormCode: 'BS',
            accountCodes: ['35'],
            amortissementAccountCodes: ['395'],
            balanceType: 'debit',
            displayType: 'brut_amort_net',
            order: 30,
          }),

          // Marchandises
          createConfig('complete', 'Marchandises', {
            formCode: 'BT',
            amortissementFormCode: 'BU',
            accountCodes: ['37'],
            amortissementAccountCodes: ['397'],
            balanceType: 'debit',
            displayType: 'brut_amort_net',
            order: 31,
          }),


        ],
      }),

      // Avances et acomptes versés sur commandes
      createConfig('complete', 'Avances et acomptes versés sur commandes', {
        formCode: 'BV',
        amortissementFormCode: 'BW',
        accountCodes: ['4091'],
        balanceType: 'debit',
        displayType: 'brut_amort_net',
        order: 32,
      }),

      // Group: Créances
      createConfig('complete', 'Créances', {
        lineType: 'group',
        accountCodes: [],
        balanceType: 'auto',
        order: 34,
        children: [
          // Clients et comptes rattachés (3)
          createConfig('complete', 'Clients et comptes rattachés', {
            formCode: 'BX',
            amortissementFormCode: 'BY',
            accountCodes: ['411', '413', '414', '416', '418', '41'],
            amortissementAccountCodes: ['491'],
            balanceType: 'debit',
            displayType: 'brut_amort_net',
            order: 35,
          }),

          // Autres créances (3)
          createConfig('complete', 'Autres créances', {
            formCode: 'BZ',
            amortissementFormCode: 'CA',
            accountCodes: ['4096', '4097', '4098', '425', '439', '44', '45', '462', '465', '467', '18', '40', '42', '43', '46', '47', '48', '52', '58'],
            excludedAccountCodes: ['4562'],
            amortissementAccountCodes: ['495', '496', '49'],
            balanceType: 'debit',
            displayType: 'brut_amort_net',
            order: 36,
          }),

          // Capital souscrit et appelé, non versé
          createConfig('complete', 'Capital souscrit et appelé, non versé', {
            formCode: 'CB',
            amortissementFormCode: 'CC',
            accountCodes: ['4562'],
            balanceType: 'debit',
            displayType: 'brut_amort_net',
            order: 38,
          }),
        ],
      }),

      // Group: Divers
      createConfig('complete', 'Divers', {
        lineType: 'group',
        accountCodes: [],
        balanceType: 'auto',
        order: 37,
        children: [


          // Valeurs mobilières de placement
          createConfig('complete', 'Valeurs mobilières de placement', {
            formCode: 'CD',
            amortissementFormCode: 'CE',
            accountCodes: ['50'],
            excludedAccountCodes: ['509'],
            amortissementAccountCodes: ['590', '59'],
            balanceType: 'debit',
            displayType: 'brut_amort_net',
            order: 39,
          }),

          // Disponibilités
          createConfig('complete', 'Disponibilités', {
            formCode: 'CF',
            amortissementFormCode: 'CG',
            accountCodes: ['51', '53', '54'],
            balanceType: 'debit',
            displayType: 'brut_amort_net',
            order: 40,
          }),

        ],
      }),

    ],
  }),

  // Group: Comptes de régularisation
  createConfig('complete', 'Comptes de régularisation', {
    section: 'actif',
    lineType: 'group',
    accountCodes: [],
    balanceType: 'auto',
    order: 42,
    children: [

      // Charges constatées d'avances (3)
      createConfig('complete', 'Charges constatées d\'avances', {
        formCode: 'CH',
        amortissementFormCode: 'CI',
        accountCodes: ['486', '4886'],
        balanceType: 'debit',
        displayType: 'brut_amort_net',
        order: 41,
      }),

      // Frais d'émission d'emprunt (IV)
      createConfig('complete', 'Frais d\'émission d\'emprunt', {
        formCode: 'CW',
        accountCodes: ['481'],
        balanceType: 'debit',
        displayType: 'net',
        order: 43,
      }),

      // Primes de remboursement des emprunts (V)
      createConfig('complete', 'Primes de remboursement des emprunts', {
        formCode: 'CM',
        accountCodes: ['169'],
        balanceType: 'debit',
        displayType: 'net',
        order: 44,
      }),

      // Écarts de conversion actif et différences d'évaluation (VI)
      createConfig('complete', 'Écarts de conversion actif et différences d\'évaluation (VI)', {
        formCode: 'CN',
        accountCodes: ['474', '476'],
        balanceType: 'debit',
        displayType: 'net',
        order: 45,
      }),
    ],
  }),

  // ========== PASSIF ==========

  // Group: Capitaux propres
  createConfig('complete', 'Capitaux propres', {
    section: 'passif',
    lineType: 'group',
    formCode: 'DL',
    balanceType: 'auto',
    order: 47,
    children: [
      // Capital social ou individuel
      createConfig('complete', 'Capital social ou individuel', {
        formCode: 'DA',
        accountCodes: ['101', '108', '10'],
        balanceType: 'credit',
        displayType: 'net',
        order: 48,
      }),

      // Primes d'émission, de fusion, d'apport...
      createConfig('complete', 'Primes d\'émission, de fusion, d\'apport', {
        formCode: 'DB',
        accountCodes: ['104'],
        balanceType: 'credit',
        displayType: 'net',
        order: 49,
      }),

      // Écarts de réévaluation (DC), "dont écart d'équivalence" (EK) on the
      // 2051: the écart d'équivalence (107) is part of DC, EK details it
      createConfig('complete', 'Écarts de réévaluation', {
        formCode: 'DC',
        lineType: 'sum',
        balanceType: 'auto',
        order: 50,
        children: [
          createConfig('complete', 'Écarts de réévaluation (hors écart d’équivalence)', {
            accountCodes: ['105'],
            balanceType: 'credit',
            displayType: 'net',
            order: 1,
          }),
          createConfig('complete', 'dont écart d’équivalence', {
            formCode: 'EK',
            accountCodes: ['107'],
            balanceType: 'credit',
            displayType: 'net',
            order: 2,
          }),
        ],
      }),

      // Réserve légale (3)
      createConfig('complete', 'Réserve légale', {
        formCode: 'DD',
        accountCodes: ['1061'],
        balanceType: 'credit',
        displayType: 'net',
        order: 51,
      }),

      // Réserves statutaires ou contractuelles
      createConfig('complete', 'Réserves statutaires ou contractuelles', {
        formCode: 'DE',
        accountCodes: ['1063'],
        balanceType: 'credit',
        displayType: 'net',
        order: 52,
      }),

      // Réserves réglementées
      createConfig('complete', 'Réserves réglementées', {
        formCode: 'DF',
        // 1062 réserves indisponibles with the réserves réglementées (practice
        // of the liasse tables, compta-online "quel compte pour quelle case")
        accountCodes: ['1062', '1064'],
        balanceType: 'credit',
        displayType: 'net',
        order: 53,
      }),

      // Autres réserves
      createConfig('complete', 'Autres réserves', {
        formCode: 'DG',
        accountCodes: ['1068', '106'],
        balanceType: 'credit',
        displayType: 'net',
        order: 54,
      }),

      // Report à nouveau
      createConfig('complete', 'Report à nouveau', {
        formCode: 'DH',
        accountCodes: ['11'],
        balanceType: 'credit',
        displayType: 'net',
        order: 55,
      }),

      // Résultat de l'exercice
      createConfig('complete', 'Résultat de l\'exercice', {
        formCode: 'DI',
        accountCodes: ['12'],
        balanceType: 'credit',
        displayType: 'net',
        order: 56,
      }),

      // Subventions d'investissement
      createConfig('complete', 'Subventions d\'investissement', {
        formCode: 'DJ',
        accountCodes: ['13'],
        balanceType: 'credit',
        displayType: 'net',
        order: 57,
      }),

      // Provisions réglementées
      createConfig('complete', 'Provisions réglementées', {
        formCode: 'DK',
        accountCodes: ['14'],
        balanceType: 'credit',
        displayType: 'net',
        order: 58,
      }),

    ],
  }),

  // Group: Autres fonds propres
  createConfig('complete', 'Autres fonds propres', {
    section: 'passif',
    lineType: 'group',
    formCode: 'DO',
    accountCodes: [],
    balanceType: 'auto',
    order: 60,
    children: [
      // Produit des émissions de titres participatifs
      createConfig('complete', 'Produit des émissions de titres participatifs', {
        formCode: 'DM',
        accountCodes: ['16711'],
        balanceType: 'credit',
        displayType: 'net',
        order: 61,
      }),

      // Avances conditionnées
      createConfig('complete', 'Avances conditionnées', {
        formCode: 'DN',
        accountCodes: ['1673', '1674', '167'],
        balanceType: 'credit',
        displayType: 'net',
        order: 62,
      }),

      // Droits du concédant (229): "autres fonds propres" in the PCG model
      // (art. 821-1); the 2051 has no box of their own, they add up into DO
      createConfig('complete', 'Droits du concédant', {
        accountCodes: ['229'],
        balanceType: 'credit',
        displayType: 'net',
        order: 63,
      }),
    ],
  }),

  // Group: Provisions pour risques et charges
  createConfig('complete', 'Provisions pour risques et charges', {
    section: 'passif',
    lineType: 'sum',
    formCode: 'DR',
    balanceType: 'auto',
    order: 64,
    children: [
      // Provisions pour risques
      createConfig('complete', 'Provisions pour risques', {
        formCode: 'DP',
        accountCodes: ['151'],
        balanceType: 'credit',
        displayType: 'net',
        order: 65,
      }),

      // Provisions pour charges
      createConfig('complete', 'Provisions pour charges', {
        formCode: 'DQ',
        accountCodes: ['152', '15'],
        balanceType: 'credit',
        displayType: 'net',
        order: 66,
      }),

    ],
  }),

  // Group: Dettes (4)
  createConfig('complete', 'Dettes', {
    section: 'passif',
    lineType: 'group',
    formCode: 'EC',
    accountCodes: [],
    balanceType: 'auto',
    order: 68,
    children: [
      // Emprunts obligataires convertibles
      createConfig('complete', 'Emprunts obligataires convertibles', {
        formCode: 'DS',
        accountCodes: ['161'],
        balanceType: 'credit',
        displayType: 'net',
        order: 69,
      }),

      // Autres emprunts obligataires
      createConfig('complete', 'Autres emprunts obligataires', {
        formCode: 'DT',
        accountCodes: ['163'],
        balanceType: 'credit',
        displayType: 'net',
        order: 70,
      }),

      // Emprunts et dettes auprès des établissements de crédit (5)
      createConfig('complete', 'Emprunts et dettes auprès des établissements de crédit', {
        formCode: 'DU',
        accountCodes: ['164', '51'],
        balanceType: 'credit',
        displayType: 'net',
        order: 71,
      }),

      // Emprunts et dettes financières divers
      createConfig('complete', 'Emprunts et dettes financières divers', {
        formCode: 'DV',
        // 45 (C) and 426: comptes courants d'associés and personnel deposits are
        // financial debts in the PCG list of the model (2051 practice: DV)
        accountCodes: ['165', '166', '168', '17', '16', '426', '45'],
        excludedAccountCodes: ['167', '169'],
        balanceType: 'credit',
        displayType: 'net',
        order: 72,
      }),

      // Instruments financiers à terme
      createConfig('complete', 'Instruments financiers à terme', {
        formCode: 'D1',
        accountCodes: ['52'],
        balanceType: 'credit',
        displayType: 'net',
        order: 73,
      }),

      // Avances et acomptes reçus sur commandes en cours
      createConfig('complete', 'Avances et acomptes reçus sur commandes en cours', {
        formCode: 'DW',
        accountCodes: ['4191'],
        balanceType: 'credit',
        displayType: 'net',
        order: 74,
      }),

      // Dettes fournisseurs et comptes rattachés
      createConfig('complete', 'Dettes fournisseurs et comptes rattachés', {
        formCode: 'DX',
        accountCodes: ['401', '403', '4081', '4088', '40'],
        balanceType: 'credit',
        displayType: 'net',
        order: 75,
      }),

      // Dettes fiscales et sociales
      createConfig('complete', 'Dettes fiscales et sociales', {
        formCode: 'DY',
        accountCodes: ['421', '422', '424', '427', '428', '431', '437', '438', '42', '43', '44'],
        balanceType: 'credit',
        displayType: 'net',
        order: 76,
      }),

      // Dettes sur immobilisations et comptes rattachés
      createConfig('complete', 'Dettes sur immobilisations et comptes rattachés', {
        formCode: 'DZ',
        accountCodes: ['269', '279', '404', '405', '4084'],
        balanceType: 'credit',
        displayType: 'net',
        order: 77,
      }),

      // Autres dettes
      createConfig('complete', 'Autres dettes', {
        formCode: 'EA',
        accountCodes: ['4196', '4197', '4198', '41', '46', '47', '48', '18', '58', '509'],
        balanceType: 'credit',
        displayType: 'net',
        order: 78,
      }),

      // Compte de régul. Produits constatés d'avance
      createConfig('complete', 'Produits constatés d\'avance', {
        formCode: 'EB',
        accountCodes: ['487', '4887'],
        balanceType: 'credit',
        displayType: 'net',
        order: 79,
      }),

    ],
  }),

  // Group: Écart de conversion passif et différences d'évaluation
  createConfig('complete', 'Écart de conversion passif et différences d\'évaluation', {
    section: 'passif',
    lineType: 'line',
    formCode: 'ED',
    accountCodes: ['475', '477'],
    balanceType: 'credit',
    order: 81,
    children: [
    ],
  }),

]
