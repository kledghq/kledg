/**
 * Default PCG 2026 simplified income statement configuration
 * Based on official form "A - RÉSULTAT COMPTABLE" (IR 018)
 * and simplified Compte de Résultat table mapping (PCG)
 *
 * Structure: same nested pattern as complete config (section, children, order).
 * Form codes from official tax form (232, 264, 270, 280, 294, 290, 300, 306, 310).
 * Account codes from simplified table: Produits (701-709, 71, 72, 74, 75 sauf 755, 781),
 * Charges (601-629, 61, 62, 63, 641, 648, 649, 645, 647, 6811, 6816, 6817, 6815, 65 sauf 655).
 *
 * Account mapping (PCG art. 821-3 and the notice of form 2033-B): every
 * account of classes 6 and 7 belongs to exactly one line. Account codes are
 * prefixes and the most specific prefix wins
 * (lib/reports/statements/allocation.ts): "68" catches the dotations that
 * "6815", "686" or "687" do not take, "76" the financial products without a
 * line of their own. 644 (rémunération du travail de l'exploitant) is a
 * salary, 646 (cotisations sociales personnelles de l'exploitant) a social
 * contribution (2033-B lines 250 and 252). The coverage is checked by
 * lib/reports/statements/__tests__/default-mapping.test.ts.
 */

import type { IncomeStatementRootEntry } from './default-pcg-config-complete-2026'
import { createConfig } from './default-pcg-config-complete-2026'

/**
 * Simplified income statement configuration based on PCG 2026
 * Two root blocks: PRODUITS then CHARGES (like complete config)
 */
export const SIMPLIFIED_INCOME_STATEMENT_CONFIG_2026: IncomeStatementRootEntry[] = ([
  // ========== PRODUITS ==========

  // I - Produits d'exploitation (form 232)
  createConfig('simplified', 'Total des produits d\'exploitation hors TVA (I)', {
    section: 'produits',
    lineType: 'sum',
    formCode: '232',
    balanceType: 'auto',
    order: 1,
    children: [
      // Montant net du chiffre d'affaires : 701, 702, 703, 704, 705, 706, 707, 708, (709)
      createConfig('simplified', 'Montant net du chiffre d\'affaires', {
        formCode: '209',
        accountCodes: ['70'],
        balanceType: 'credit',
        order: 1,
      }),
      // Autres produits : 71(c), 72, 74, 75 [sauf 755], 78 [sauf 786, 787], 79
      createConfig('simplified', 'Autres produits', {
        formCode: '230',
        accountCodes: ['71', '72', '74', '75', '781', '78', '79'],
        excludedAccountCodes: ['755'],
        balanceType: 'credit',
        order: 2,
      }),
    ],
  }),

  // 1 - Résultat d'exploitation (I - II) (form 270)
  createConfig('simplified', '1 - RÉSULTAT D\'EXPLOITATION (I - II)', {
    section: 'produits',
    lineType: 'sum',
    formCode: '270',
    balanceType: 'auto',
    order: 2,
  }),

  // Quote-part résultat opérations en commun (755 produits)
  createConfig('simplified', 'Bénéfice attribué ou perte transférée', {
    section: 'produits',
    formCode: 'GH',
    accountCodes: ['755'],
    balanceType: 'credit',
    order: 3,
  }),

  // III - Produits financiers (form 280)
  createConfig('simplified', 'Produits financiers (III)', {
    section: 'produits',
    lineType: 'sum',
    formCode: '280',
    balanceType: 'auto',
    order: 4,
    children: [
      createConfig('simplified', 'De participation', {
        accountCodes: ['761'],
        balanceType: 'credit',
        order: 1,
      }),
      createConfig('simplified', 'D\'autres valeurs mobilières et créances de l\'actif immobilisé', {
        accountCodes: ['762', '764'],
        balanceType: 'credit',
        order: 2,
      }),
      createConfig('simplified', 'Autres intérêts et produits assimilés', {
        accountCodes: ['763', '765', '768', '76'],
        balanceType: 'credit',
        order: 3,
      }),
      createConfig('simplified', 'Reprises sur dépréciations et provisions', {
        accountCodes: ['786'],
        balanceType: 'credit',
        order: 4,
      }),
      createConfig('simplified', 'Différences positives de change', {
        accountCodes: ['766'],
        balanceType: 'credit',
        order: 5,
      }),
      createConfig('simplified', 'Produits des cessions d\'immobilisations financières', {
        accountCodes: ['7671', '7672'],
        balanceType: 'credit',
        order: 6,
      }),
      createConfig('simplified', 'Produits nets sur cessions de VMP et d\'instruments de trésorerie', {
        accountCodes: ['7673', '7674', '767'],
        balanceType: 'credit',
        order: 7,
      }),
    ],
  }),

  // 2 - Résultat financier
  createConfig('simplified', '2 - RÉSULTAT FINANCIER', {
    section: 'produits',
    lineType: 'sum',
    formCode: 'GV',
    balanceType: 'auto',
    order: 5,
  }),

  // 3 - Résultat courant avant impôts
  createConfig('simplified', '3 - RÉSULTAT COURANT avant impôts', {
    section: 'produits',
    lineType: 'sum',
    formCode: 'GW',
    balanceType: 'auto',
    order: 6,
  }),

  // IV - Produits exceptionnels (form 290)
  createConfig('simplified', 'Produits exceptionnels (IV)', {
    section: 'produits',
    formCode: '290',
    accountCodes: ['77', '787'],
    balanceType: 'credit',
    order: 7,
  }),

  // 4 - Résultat exceptionnel
  createConfig('simplified', '4 - RÉSULTAT EXCEPTIONNEL', {
    section: 'produits',
    lineType: 'sum',
    formCode: 'HI',
    balanceType: 'auto',
    order: 8,
  }),

  // ========== CHARGES ==========

  // II - Charges d'exploitation (form 264)
  createConfig('simplified', 'Total des charges d\'exploitation (II)', {
    section: 'charges',
    lineType: 'sum',
    formCode: '264',
    balanceType: 'auto',
    order: 9,
    children: [
      // Achats et autres charges externes : 601, 602, 603, 604, 605, 606, 607, 608, (609), 61 [sauf 619], (619), 62 [sauf 629], (629)
      createConfig('simplified', 'Achats et autres charges externes', {
        formCode: '234',
        accountCodes: ['60', '61', '62'],
        balanceType: 'debit',
        order: 1,
      }),
      createConfig('simplified', 'Impôts, taxes et versements assimilés', {
        formCode: '244',
        accountCodes: ['63'],
        balanceType: 'debit',
        order: 2,
      }),
      // Salaires : 641, 644, 648, 649 (64 catches the other personnel accounts)
      createConfig('simplified', 'Salaires', {
        formCode: '250',
        accountCodes: ['641', '644', '648', '649', '64'],
        balanceType: 'debit',
        order: 3,
      }),
      createConfig('simplified', 'Cotisations sociales', {
        formCode: '252',
        // 645, 646 (cotisations personnelles de l'exploitant), 647
        accountCodes: ['645', '646', '647'],
        balanceType: 'debit',
        order: 4,
      }),
      createConfig('simplified', 'Dotations aux amortissements et aux dépréciations', {
        formCode: '254',
        accountCodes: ['6811', '6816', '6817', '681', '68'],
        balanceType: 'debit',
        order: 5,
      }),
      createConfig('simplified', 'Dotations aux provisions', {
        formCode: '256',
        accountCodes: ['6815'],
        balanceType: 'debit',
        order: 6,
      }),
      createConfig('simplified', 'Autres charges', {
        formCode: '262',
        accountCodes: ['65'],
        excludedAccountCodes: ['655'],
        balanceType: 'debit',
        order: 7,
      }),
    ],
  }),

  // Quote-part résultat opérations en commun (655 charges)
  createConfig('simplified', 'Perte supportée ou bénéfice transféré', {
    section: 'charges',
    formCode: 'GI',
    accountCodes: ['655'],
    balanceType: 'debit',
    order: 10,
  }),

  // V - Charges financières (form 294)
  createConfig('simplified', 'Charges financières (V)', {
    section: 'charges',
    lineType: 'sum',
    formCode: '294',
    balanceType: 'auto',
    order: 11,
    children: [
      createConfig('simplified', 'Dotations aux amortissements, aux dépréciations et aux provisions', {
        accountCodes: ['686'],
        balanceType: 'debit',
        order: 1,
      }),
      createConfig('simplified', 'Intérêts et charges assimilées', {
        accountCodes: ['661', '664', '665', '668', '66'],
        balanceType: 'debit',
        order: 2,
      }),
      createConfig('simplified', 'Différences négatives de change', {
        accountCodes: ['666'],
        balanceType: 'debit',
        order: 3,
      }),
      createConfig('simplified', 'Valeurs comptables des immobilisations financières cédées', {
        accountCodes: ['6671', '6672'],
        balanceType: 'debit',
        order: 4,
      }),
      createConfig('simplified', 'Charges nettes sur cessions de VMP et d\'instruments de trésorerie', {
        accountCodes: ['6673', '6674', '667'],
        balanceType: 'debit',
        order: 5,
      }),
    ],
  }),

  // VI - Charges exceptionnelles (form 300)
  createConfig('simplified', 'Charges exceptionnelles (VI)', {
    section: 'charges',
    formCode: '300',
    accountCodes: ['67', '687'],
    balanceType: 'debit',
    order: 12,
  }),

  // Participation des salariés aux résultats
  createConfig('simplified', 'Participations des salariés aux résultats', {
    section: 'charges',
    formCode: 'HJ',
    accountCodes: ['691'],
    balanceType: 'debit',
    order: 13,
  }),

  // VII - Impôt sur les bénéfices (form 306)
  createConfig('simplified', 'Impôt sur les bénéfices (VII)', {
    section: 'charges',
    formCode: '306',
    accountCodes: ['695', '696', '698', '699', '69'],
    balanceType: 'debit',
    order: 14,
    notes: 'Comptes 6989 et 699 peuvent avoir des soldes créditeurs',
  }),

  // 2 - Bénéfice ou perte (form 310)
  createConfig('simplified', '2 - BÉNÉFICES OU PERTES : Produits (I + III + IV) - Charges (II + V + VI + VII)', {
    section: 'produits',
    lineType: 'sum',
    formCode: '310',
    balanceType: 'auto',
    order: 15,
  }),
] as IncomeStatementRootEntry[])
