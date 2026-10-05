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
      // 2033-B lines 210 to 230 (notice 2033-NOT-SD 2026: 210 reventes en l'état;
      // 214 biens produits ou transformés; 218 travaux, études, prestations et
      // produits des activités annexes). 704 (travaux) stays with the goods
      // like 2052 FD: the notice puts works with materials there.
      createConfig('simplified', 'Ventes de marchandises', {
        formCode: '210',
        accountCodes: ['707', '7097'],
        balanceType: 'credit',
        order: 1,
      }),
      createConfig('simplified', 'Production vendue - Biens', {
        formCode: '214',
        accountCodes: ['701', '702', '703', '7091', '7092'],
        balanceType: 'credit',
        order: 2,
      }),
      createConfig('simplified', 'Production vendue - Services', {
        formCode: '218',
        // 704 travaux and 7094 with the services by default (notice: "travaux,
        // études et prestations"); with the goods for a construction company
        // (works-as-goods.ts: works supplying the materials)
        accountCodes: ['704', '705', '706', '708', '7094', '7095', '7096', '7098', '70'],
        balanceType: 'credit',
        order: 3,
      }),
      createConfig('simplified', 'Production stockée', {
        formCode: '222',
        accountCodes: ['71'],
        balanceType: 'credit',
        order: 4,
      }),
      createConfig('simplified', 'Production immobilisée', {
        formCode: '224',
        accountCodes: ['72'],
        balanceType: 'credit',
        order: 5,
      }),
      // 747 (quote-part des subventions d'investissement virée au résultat,
      // ANC 2022-06) is a subsidy of class 74
      createConfig('simplified', "Subventions d'exploitation reçues", {
        formCode: '226',
        accountCodes: ['74'],
        balanceType: 'credit',
        order: 6,
      }),
      // 75 (757 cessions, among the "autres produits de gestion courante" of
      // comptes 752 to 758 in the 2033-NOT-SD 2026, cadre 2033-E line 115;
      // 755 quotes-parts too: the 2033-B has no line for opérations faites
      // en commun, practice puts them in autres produits and autres
      // charges), reprises 78 except 786 and 787, 79 of the years before 2025
      createConfig('simplified', 'Autres produits', {
        formCode: '230',
        accountCodes: ['75', '781', '78', '79'],
        balanceType: 'credit',
        order: 7,
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

  // Subtotals the 2033-B does not print, kept for reading (2052 GV, GW, HI)
  createConfig('simplified', 'Résultat financier (III - V), hors formulaire', {
    section: 'produits',
    lineType: 'sum',
    formCode: 'GV',
    balanceType: 'auto',
    order: 5,
  }),

  // 3 - Résultat courant avant impôts
  createConfig('simplified', 'Résultat courant avant impôts, hors formulaire', {
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
  createConfig('simplified', 'Résultat exceptionnel (IV - VI), hors formulaire', {
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
      // 2033-B lines 234 to 262 (notice 2033-NOT-SD 2026)
      createConfig('simplified', 'Achats de marchandises (y compris droits de douane)', {
        formCode: '234',
        accountCodes: ['607', '6087', '6097'],
        balanceType: 'debit',
        order: 1,
      }),
      createConfig('simplified', 'Variation de stock (marchandises)', {
        formCode: '236',
        accountCodes: ['6037'],
        balanceType: 'debit',
        order: 2,
      }),
      createConfig('simplified', 'Achats de matières premières et autres approvisionnements', {
        formCode: '238',
        accountCodes: ['601', '602', '6081', '6082', '6091', '6092'],
        balanceType: 'debit',
        order: 3,
      }),
      createConfig('simplified', 'Variation de stock (matières premières et approvisionnements)', {
        formCode: '240',
        accountCodes: ['6031', '6032', '603'],
        balanceType: 'debit',
        order: 4,
      }),
      createConfig('simplified', 'Autres charges externes', {
        formCode: '242',
        accountCodes: ['604', '605', '606', '608', '609', '60', '61', '62'],
        balanceType: 'debit',
        order: 5,
      }),
      createConfig('simplified', 'Impôts, taxes et versements assimilés', {
        formCode: '244',
        accountCodes: ['63'],
        balanceType: 'debit',
        order: 6,
      }),
      // Rémunérations du personnel: 641, 644, 648, 649 (64 catches the other personnel accounts)
      createConfig('simplified', 'Rémunérations du personnel', {
        formCode: '250',
        accountCodes: ['641', '644', '648', '649', '64'],
        balanceType: 'debit',
        order: 7,
      }),
      createConfig('simplified', 'Cotisations sociales', {
        formCode: '252',
        // 645, 646 (cotisations personnelles de l'exploitant), 647
        accountCodes: ['645', '646', '647'],
        balanceType: 'debit',
        order: 8,
      }),
      // 254 holds the depreciation only (dérogatoire excluded: line 300);
      // 256 was renamed "Dotations aux dépréciations" in 2026 and keeps the
      // operating provisions it held as "Dotations aux provisions".
      createConfig('simplified', 'Dotations aux amortissements', {
        formCode: '254',
        accountCodes: ['6811', '681', '68'],
        balanceType: 'debit',
        order: 9,
      }),
      createConfig('simplified', 'Dotations aux dépréciations et aux provisions', {
        formCode: '256',
        accountCodes: ['6815', '6816', '6817'],
        balanceType: 'debit',
        order: 10,
      }),
      // 65: comptes 651 to 658 (2033-NOT-SD 2026, 2033-E line 148), 657
      // cessions and 655 quotes-parts included (no line of their own)
      createConfig('simplified', 'Autres charges', {
        formCode: '262',
        accountCodes: ['65'],
        balanceType: 'debit',
        order: 11,
      }),
    ],
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

  // VII - Impôt sur les bénéfices (form 306)
  createConfig('simplified', 'Impôt sur les bénéfices (VII)', {
    section: 'charges',
    formCode: '306',
    // Class 69 "Participation des salariés, impôts sur les bénéfices": the
    // 2033-B has no participation line (no equivalent of 2053 HJ), 691 goes
    // with the other class 69 accounts (practice; the result stays exact)
    accountCodes: ['691', '695', '696', '698', '699', '69'],
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
