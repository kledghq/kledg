/**
 * Default PCG 2026 complete income statement configuration
 * Based on official PCG 2026 structure with groups, sums, and lines
 * 
 * Structure conforms to official tax forms:
 * - DGFIP N° 2052-SD 2026 (Compte de résultat principal)
 * - DGFIP N° 2053-SD 2026 (Compte de résultat suite)
 * 
 * Structure:
 * - 'group': Visual organization header (no calculation)
 * - 'sum': Sums its children (balanceType: 'auto')
 * - 'line': Line with account codes
 * 
 * Uses nested structure with children arrays instead of linePath
 *
 * Account mapping (PCG art. 821-3 and the notices of forms 2052 and 2053):
 * every account of classes 6 and 7 belongs to exactly one line. Account
 * codes are prefixes and the most specific prefix wins
 * (lib/reports/statements/allocation.ts). The notice lets 608, 609, 708 and
 * 709 subdivisions follow the line they relate to; by default 6087 / 6097
 * and 7097 go with goods (FS, FA), 6081 / 6082 / 6091 / 6092 with raw
 * materials (FU), 708, 7096 and 7098 with services (FG) and the other 608 /
 * 609 subdivisions with other external charges (FW). 644 (rémunération du
 * travail de l'exploitant) is a salary (FY), 646 (cotisations sociales
 * personnelles de l'exploitant) a social contribution (FZ). The coverage is
 * checked by lib/reports/statements/__tests__/default-mapping.test.ts.
 */

/**
 * Section for first-level entries (like actif/passif for balance sheet)
 */
export type IncomeStatementSection = 'produits' | 'charges'

/**
 * Default config entry with nested children structure
 */
export interface DefaultIncomeStatementConfigEntry {
  reportVariant: 'complete' | 'simplified'
  section?: IncomeStatementSection | null
  lineLabel: string
  lineType?: 'group' | 'sum' | 'line'
  formCode?: string | null
  accountCodes?: string[]
  excludedAccountCodes?: string[]
  filterType?: string | null
  balanceType?: 'debit' | 'credit' | 'auto'
  order: number
  notes?: string | null
  children?: DefaultIncomeStatementConfigEntry[]
}

/**
 * First-level entry for Produits section (root level, section required)
 */
export type ProduitsRootEntry = DefaultIncomeStatementConfigEntry & {
  section: 'produits'
}

/**
 * First-level entry for Charges section (root level, section required)
 */
export type ChargesRootEntry = DefaultIncomeStatementConfigEntry & {
  section: 'charges'
}

/**
 * First-level config entry (root level - must have explicit section like balance sheet)
 */
export type IncomeStatementRootEntry = ProduitsRootEntry | ChargesRootEntry

/**
 * Helper to create a config entry
 */
export function createConfig(
  reportVariant: 'complete' | 'simplified',
  lineLabel: string,
  options: {
    section?: IncomeStatementSection | null
    lineType?: 'group' | 'sum' | 'line'
    formCode?: string | null
    accountCodes?: string[]
    excludedAccountCodes?: string[]
    filterType?: string | null
    balanceType?: 'debit' | 'credit' | 'auto'
    order: number
    notes?: string | null
    children?: DefaultIncomeStatementConfigEntry[]
  }
): DefaultIncomeStatementConfigEntry {
  const {
    lineType = options.accountCodes && options.accountCodes.length > 0 ? 'line' : 'group',
    formCode = null,
    accountCodes = [],
    excludedAccountCodes = [],
    filterType = 'starts_with',
    balanceType = 'credit',
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
    accountCodes,
    excludedAccountCodes,
    filterType,
    balanceType,
    order,
    notes,
    children,
  }
}

/**
 * Complete income statement configuration based on PCG 2026
 * Structure from official forms DGFIP N° 2052-SD 2026 and 2053-SD 2026
 * Form codes from official tax forms
 * First-level entries have explicit section (produits | charges) like actif/passif for balance sheet
 */
export const COMPLETE_INCOME_STATEMENT_CONFIG_2026: IncomeStatementRootEntry[] = ([
  // ========== PRODUITS ==========
  
  // Group: Produits d'exploitation
  createConfig('complete', 'Produits d\'exploitation', {
    section: 'produits',
    lineType: 'sum',
    formCode: 'FR',
    balanceType: 'auto',
    order: 1,
    children: [
      // Ventes de marchandises
      // Comptes: 707, 708 (subdivisions), 7097, 7098 (subdivisions)
      createConfig('complete', 'Ventes de marchandises', {
        formCode: 'FA',
        accountCodes: ['707', '7097'],
        balanceType: 'credit',
        order: 1,
        notes: 'Comptes 708 et 7098 subdivisions à rattacher aux postes auxquels elles se rapportent',
      }),
      
      // Group: Production vendue
      createConfig('complete', 'Production vendue', {
        lineType: 'sum',
        formCode: 'FJ',
        balanceType: 'auto',
        order: 2,
        children: [
          // Production vendue - Biens
          // 701 to 703 and their rebates (notice 2032-NOT-SD 2026, FF: biens produits
          // ou transformés). Études (705) are services (FI: "travaux, études et
          // prestations"); travaux (704) depend on the activity (works-as-goods.ts).
          createConfig('complete', 'Production vendue - Biens', {
            formCode: 'FD',
            accountCodes: ['701', '702', '703', '7091', '7092'],
            balanceType: 'credit',
            order: 1,
            notes: 'Comptes 708 et 7098 subdivisions à rattacher aux postes auxquels elles se rapportent',
          }),
          
          // Production vendue - Services
          createConfig('complete', 'Production vendue - Services', {
            formCode: 'FG',
            // 704 travaux and 7094 with the services by default (notice: "travaux,
        // études et prestations"); with the goods for a construction company
        // (works-as-goods.ts: works supplying the materials)
        accountCodes: ['704', '705', '706', '708', '7094', '7095', '7096', '7098', '70'],
            balanceType: 'credit',
            order: 2,
            notes: 'Comptes 708 et 7098 subdivisions à rattacher aux postes auxquels elles se rapportent',
          }),
        ],
      }),
      
      // Production stockée
      // Compte 71 - peut être créditeur ou débiteur (variation globale)
      createConfig('complete', 'Production stockée', {
        formCode: 'FM',
        accountCodes: ['71'],
        balanceType: 'credit',
        order: 3,
        notes: 'Solde du compte 71 représente la variation globale de la valeur de la production stockée. Peut être créditeur ou débiteur.',
      }),
      
      // Production immobilisée
      createConfig('complete', 'Production immobilisée', {
        formCode: 'FN',
        accountCodes: ['72'],
        balanceType: 'credit',
        order: 4,
      }),
      
      // Subventions d'exploitation
      createConfig('complete', 'Subventions d\'exploitation', {
        formCode: 'FO',
        accountCodes: ['74'],
        balanceType: 'credit',
        order: 5,
      }),
      
      // Reprises sur amortissements et provisions
      createConfig('complete', 'Reprises sur amortissements et provisions', {
        formCode: 'FP',
        accountCodes: ['781', '78', '79'],
        balanceType: 'credit',
        order: 6,
      }),
      
      // Produits des cessions d'immobilisations incorporelles et corporelles
      createConfig('complete', 'Produits des cessions d\'immobilisations incorporelles et corporelles', {
        formCode: 'F1',
        accountCodes: ['757'],
        balanceType: 'credit',
        order: 7,
      }),
      
      // Autres produits
      // Compte 75 sauf 755 et 757
      createConfig('complete', 'Autres produits', {
        formCode: 'FQ',
        accountCodes: ['75'],
        excludedAccountCodes: ['755', '757'],
        balanceType: 'credit',
        order: 8,
      }),
    ],
  }),
  
  // Group: Résultat d'exploitation
  createConfig('complete', 'RÉSULTAT D\'EXPLOITATION (I, II)', {
    section: 'produits',
    lineType: 'sum',
    formCode: 'GG',
    balanceType: 'auto',
    order: 2,
  }),
  
  // Bénéfice attribué ou perte transférée
  createConfig('complete', 'Bénéfice attribué ou perte transférée', {
    section: 'produits',
    formCode: 'GH',
    accountCodes: ['755'],
    balanceType: 'credit',
    order: 3,
  }),
  
  // Group: Produits financiers
  createConfig('complete', 'Produits financiers', {
    section: 'produits',
    lineType: 'sum',
    formCode: 'GP',
    balanceType: 'auto',
    order: 5,
    children: [
      // Produits financiers de participations
      createConfig('complete', 'Produits financiers de participations', {
        formCode: 'GJ',
        accountCodes: ['761'],
        balanceType: 'credit',
        order: 1,
      }),
      
      // Produits des autres valeurs mobilières et créances de l'actif immobilisé
      createConfig('complete', 'Produits des autres valeurs mobilières et créances de l\'actif immobilisé', {
        formCode: 'GK',
        accountCodes: ['762', '764'],
        balanceType: 'credit',
        order: 2,
      }),
      
      // Autres intérêts et produits assimilés
      createConfig('complete', 'Autres intérêts et produits assimilés', {
        formCode: 'GL',
        accountCodes: ['763', '765', '768', '76'],
        balanceType: 'credit',
        order: 3,
      }),
      
      // Reprises sur dépréciations et provisions
      createConfig('complete', 'Reprises sur dépréciations et provisions', {
        formCode: 'GM',
        accountCodes: ['786'],
        balanceType: 'credit',
        order: 4,
      }),
      
      // Différences positives de change
      createConfig('complete', 'Différences positives de change', {
        formCode: 'GN',
        accountCodes: ['766'],
        balanceType: 'credit',
        order: 5,
      }),
      
      // Produits des cessions d'immobilisations financières
      createConfig('complete', 'Produits des cessions d\'immobilisations financières', {
        formCode: 'G2',
        accountCodes: ['7671', '7672'],
        balanceType: 'credit',
        order: 6,
      }),
      
      // Produits nets sur cessions de valeurs mobilières de placement et d'instruments de trésorerie
      createConfig('complete', 'Produits nets sur cessions de valeurs mobilières de placement et d\'instruments de trésorerie', {
        formCode: 'GO',
        accountCodes: ['7673', '7674', '767'],
        balanceType: 'credit',
        order: 7,
      }),
    ],
  }),
  
  // Group: Résultat financier
  createConfig('complete', 'RÉSULTAT FINANCIER (V, VI)', {
    section: 'produits',
    lineType: 'sum',
    formCode: 'GV',
    balanceType: 'auto',
    order: 7,
  }),
  
  // Group: Résultat courant avant impôts
  createConfig('complete', 'RÉSULTAT COURANT AVANT IMPÔTS (I, II + III, IV + V, VI)', {
    section: 'produits',
    lineType: 'sum',
    formCode: 'GW',
    balanceType: 'auto',
    order: 8,
  }),
  
  // Group: Produits exceptionnels
  createConfig('complete', 'Produits exceptionnels', {
    section: 'produits',
    lineType: 'sum',
    formCode: 'HD',
    balanceType: 'auto',
    order: 9,
    children: [
      // Produits exceptionnels (77, 787)
      createConfig('complete', 'Produits exceptionnels', {
        formCode: 'HD',
        accountCodes: ['77', '787'],
        balanceType: 'credit',
        order: 1,
      }),
    ],
  }),
  
  // Group: Résultat exceptionnel
  createConfig('complete', 'RÉSULTAT EXCEPTIONNEL (VII, VIII)', {
    section: 'produits',
    lineType: 'sum',
    formCode: 'HI',
    balanceType: 'auto',
    order: 11,
  }),
  
  // Total des produits
  createConfig('complete', 'TOTAL DES PRODUITS (I + III + V + VII)', {
    section: 'produits',
    lineType: 'sum',
    formCode: 'HL',
    balanceType: 'auto',
    order: 14,
  }),
  
  // ========== CHARGES ==========
  
  // Group: Charges d'exploitation
  createConfig('complete', 'Charges d\'exploitation', {
    section: 'charges',
    lineType: 'sum',
    formCode: 'GF',
    balanceType: 'auto',
    // First of the charges, as on form 2052 (it used to come after the total).
    order: 2,
    children: [
      // Achats de marchandises (y compris droits de douane)
      // Comptes: 607, 608 (subdivisions), 609 (subdivisions)
      createConfig('complete', 'Achats de marchandises (y compris droits de douane)', {
        formCode: 'FS',
        accountCodes: ['607', '6087', '6097'],
        balanceType: 'debit',
        order: 1,
        notes: 'Comptes 608 et 609 subdivisions à rattacher aux postes auxquels elles se rapportent',
      }),
      
      // Variation de stocks (marchandises)
      // Compte 6037 - peut être créditeur ou débiteur
      createConfig('complete', 'Variation de stocks (marchandises)', {
        formCode: 'FT',
        accountCodes: ['6037'],
        balanceType: 'debit',
        order: 2,
        notes: 'Le solde du compte 6037 peut être créditeur ou débiteur',
      }),
      
      // Achats de matières premières et autres approvisionnements (y compris droits de douane)
      // Comptes: 601, 602, 608 (subdivisions), 609 (subdivisions)
      createConfig('complete', 'Achats de matières premières et autres approvisionnements (y compris droits de douane)', {
        formCode: 'FU',
        accountCodes: ['601', '602', '6081', '6082', '6091', '6092'],
        balanceType: 'debit',
        order: 3,
        notes: 'Comptes 608 et 609 subdivisions à rattacher aux postes auxquels elles se rapportent',
      }),
      
      // Variation de stocks (matières premières et approvisionnements)
      // Comptes 6031, 6032 - peuvent être créditeurs ou débiteurs
      createConfig('complete', 'Variation de stocks (matières premières et approvisionnements)', {
        formCode: 'FV',
        accountCodes: ['6031', '6032', '603'],
        balanceType: 'debit',
        order: 4,
        notes: 'Les soldes des comptes 6031 et 6032 peuvent être créditeurs ou débiteurs',
      }),
      
      // Autres achats et charges externes
      // Comptes: 604, 605, 606, 608 (subdivisions), 609 (subdivisions), 61 sauf 619, 619, 62 sauf 629, 629
      // Y compris: 6122 (Redevances de crédit-bail mobilier), 6125 (Redevances de crédit-bail immobilier)
      createConfig('complete', 'Autres achats et charges externes', {
        formCode: 'FW',
        accountCodes: ['604', '605', '606', '608', '609', '60', '61', '62'],
        excludedAccountCodes: [],
        balanceType: 'debit',
        order: 5,
        notes: 'Y compris redevances de crédit-bail mobilier (6122) et immobilier (6125). Comptes 608, 609, 619, 629 subdivisions à rattacher aux postes auxquels elles se rapportent',
      }),
      
      // Impôts, taxes et versements assimilés
      createConfig('complete', 'Impôts, taxes et versements assimilés', {
        formCode: 'FX',
        accountCodes: ['63'],
        balanceType: 'debit',
        order: 6,
      }),
      
      // Salaires et traitements
      // Comptes: 641 + subdivisions de 648/649 rattachées aux salaires.
      // 648/649 sont laissés sur cette ligne par défaut: la PCG prévoit que
      // leurs subdivisions soient rattachées soit ici soit en Cotisations
      // sociales selon leur nature. Pour éviter un double comptage (le compte
      // 648 sans subdivision matcherait les deux lignes simultanément via
      // filterType=starts_with), la ligne Cotisations sociales n'inclut PAS
      // 648/649 par défaut. Les utilisateurs peuvent créer des sous-comptes
      // (6481, 6488, …) et les rattacher explicitement via exclusions/inclusions.
      createConfig('complete', 'Salaires et traitements', {
        formCode: 'FY',
        accountCodes: ['641', '644', '648', '649', '64'],
        balanceType: 'debit',
        order: 7,
        notes: '648 et 649: rattacher les subdivisions aux postes appropriés',
      }),

      // Cotisations sociales
      // Comptes: 645, 647. 648/649 volontairement exclus du défaut pour éviter
      // le double comptage avec "Salaires et traitements" (voir note ci-dessus).
      createConfig('complete', 'Cotisations sociales', {
        formCode: 'FZ',
        accountCodes: ['645', '646', '647'],
        balanceType: 'debit',
        order: 8,
        notes: '646 : cotisations sociales personnelles de l\'exploitant',
      }),
      
      // Group: Dotations d'exploitation
      createConfig('complete', 'DOTATIONS D\'EXPLOITATION', {
        lineType: 'sum',
        formCode: 'GD',
        balanceType: 'auto',
        order: 9,
        children: [
          // Sur immobilisations : dotations aux amortissements
          createConfig('complete', 'Sur immobilisations : dotations aux amortissements', {
            formCode: 'GA',
            accountCodes: ['6811', '681', '68'],
            balanceType: 'debit',
            order: 1,
          }),
          
          // Sur immobilisations : dotations aux dépréciations
          createConfig('complete', 'Sur immobilisations : dotations aux dépréciations', {
            formCode: 'GB',
            accountCodes: ['6816'],
            balanceType: 'debit',
            order: 2,
          }),
          
          // Sur actif circulant : dotations aux dépréciations
          createConfig('complete', 'Sur actif circulant : dotations aux dépréciations', {
            formCode: 'GC',
            accountCodes: ['6817'],
            balanceType: 'debit',
            order: 3,
          }),
          
          // Pour risques et charges : dotations aux provisions
          createConfig('complete', 'Pour risques et charges : dotations aux provisions', {
            formCode: 'GD',
            accountCodes: ['6815'],
            balanceType: 'debit',
            order: 4,
          }),
        ],
      }),
      
      // Valeurs comptables des immobilisations incorporelles et corporelles cédées
      createConfig('complete', 'Valeurs comptables des immobilisations incorporelles et corporelles cédées', {
        formCode: 'G1',
        accountCodes: ['657'],
        balanceType: 'debit',
        order: 10,
      }),
      
      // Autres charges
      // Compte 65 sauf 655 et 657
      createConfig('complete', 'Autres charges', {
        formCode: 'GE',
        accountCodes: ['65'],
        excludedAccountCodes: ['655', '657'],
        balanceType: 'debit',
        order: 11,
      }),
    ],
  }),
  
  // Perte supportée ou bénéfice transféré
  createConfig('complete', 'Perte supportée ou bénéfice transféré', {
    section: 'charges',
    formCode: 'GI',
    accountCodes: ['655'],
    balanceType: 'debit',
    order: 4,
  }),
  
  // Group: Charges financières
  createConfig('complete', 'Charges financières', {
    section: 'charges',
    lineType: 'sum',
    formCode: 'GU',
    balanceType: 'auto',
    order: 6,
    children: [
      createConfig('complete', 'Dotations financières aux amortissements et provisions', {
        formCode: 'GQ',
        accountCodes: ['686'],
        balanceType: 'debit',
        order: 1,
      }),
      createConfig('complete', 'Intérêts et charges assimilées', {
        formCode: 'GR',
        accountCodes: ['661', '664', '665', '668', '66'],
        balanceType: 'debit',
        order: 2,
      }),
      createConfig('complete', 'Différences négatives de change', {
        formCode: 'GS',
        accountCodes: ['666'],
        balanceType: 'debit',
        order: 3,
      }),
      createConfig('complete', 'Valeurs comptables des immobilisations financières cédées', {
        formCode: 'G3',
        accountCodes: ['6671', '6672'],
        balanceType: 'debit',
        order: 4,
      }),
      createConfig('complete', 'Charges nettes sur cessions de valeurs mobilières de placement et d\'instruments de trésorerie', {
        formCode: 'GT',
        accountCodes: ['6673', '6674', '667'],
        balanceType: 'debit',
        order: 5,
      }),
    ],
  }),
  
  // Group: Charges exceptionnelles
  createConfig('complete', 'Charges exceptionnelles', {
    section: 'charges',
    lineType: 'sum',
    formCode: 'HH',
    balanceType: 'auto',
    order: 10,
    children: [
      createConfig('complete', 'Charges exceptionnelles', {
        formCode: 'HH',
        accountCodes: ['67', '687'],
        balanceType: 'debit',
        order: 1,
      }),
    ],
  }),
  
  // Participation des salariés aux résultats
  createConfig('complete', 'Participation des salariés aux résultats de l\'entreprise', {
    section: 'charges',
    formCode: 'HJ',
    accountCodes: ['691'],
    balanceType: 'debit',
    order: 12,
  }),
  
  // Impôts sur les bénéfices
  createConfig('complete', 'Impôts sur les bénéfices', {
    section: 'charges',
    formCode: 'HK',
    accountCodes: ['695', '696', '698', '699', '69'],
    balanceType: 'debit',
    order: 13,
    notes: 'Les comptes 6989 et 699 indiqués entre parenthèses ont des soldes créditeurs',
  }),
  
  // Total des charges
  createConfig('complete', 'TOTAL DES CHARGES (II + IV + VI + VIII + IX + X)', {
    section: 'charges',
    lineType: 'sum',
    formCode: 'HM',
    balanceType: 'auto',
    order: 15,
  }),
  
  // Bénéfice ou perte
  createConfig('complete', 'BÉNÉFICE OU PERTE (Total des produits, Total des charges)', {
    section: 'produits',
    lineType: 'sum',
    formCode: 'HN',
    balanceType: 'auto',
    order: 17,
  }),
] as IncomeStatementRootEntry[])
