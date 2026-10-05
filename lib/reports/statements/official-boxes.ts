/**
 * Box codes of the official models of the annual statements, millésime 2026
 * (règlement ANC n° 2022-06 applied): forms 2050-SD to 2053-SD (cerfa
 * 15949*08, liasse du régime réel normal) and 2033-A-SD, 2033-B-SD (cerfa
 * 15948*08, régime simplifié), as printed on the forms published on
 * impots.gouv.fr, with their notices 2032-NOT-SD and 2033-NOT-SD 2026.
 * Pure data: used by the tests of the default layouts to check that every
 * account lands in a box that exists.
 */

/** 2050-SD, column 1 (brut) and column 2 (amortissements, dépréciations). */
export const FORM_2050_BRUT = ['AA', 'AB', 'CX', 'AF', 'AH', 'AJ', 'AL', 'AN', 'AP', 'AR', 'AT', 'AV', 'CS', 'CU', 'BB', 'BD', 'BF', 'BH', 'BJ', 'BL', 'BN', 'BP', 'BR', 'BT', 'BV', 'BX', 'BZ', 'CB', 'CD', 'CF', 'CH', 'CJ', 'CW', 'CM', 'CN', 'CO'] as const
export const FORM_2050_AMORT = ['AC', 'CQ', 'AG', 'AI', 'AK', 'AM', 'AO', 'AQ', 'AS', 'AU', 'AW', 'CT', 'CV', 'BC', 'BE', 'BG', 'BI', 'BK', 'BM', 'BO', 'BQ', 'BS', 'BU', 'BW', 'BY', 'CA', 'CC', 'CE', 'CG', 'CI', 'CK', '1A'] as const
/** 2051-SD (passif avant répartition). EK is the "dont écart d'équivalence" of DC. */
export const FORM_2051 = ['DA', 'DB', 'DC', 'EK', 'DD', 'DE', 'DF', 'DG', 'DH', 'DI', 'DJ', 'DK', 'DL', 'DM', 'DN', 'DO', 'DP', 'DQ', 'DR', 'DS', 'DT', 'DU', 'DV', 'D1', 'DW', 'DX', 'DY', 'DZ', 'EA', 'EB', 'EC', 'ED', 'EE'] as const
/** 2052-SD and 2053-SD (HA to HC and HE to HG merged into HD and HH in 2026). */
export const FORM_2052_2053 = ['FA', 'FD', 'FG', 'FJ', 'FM', 'FN', 'FO', 'FP', 'F1', 'FQ', 'FR', 'FS', 'FT', 'FU', 'FV', 'FW', 'FX', 'FY', 'FZ', 'GA', 'GB', 'GC', 'GD', 'G1', 'GE', 'GF', 'GG', 'GH', 'GI', 'GJ', 'GK', 'GL', 'GM', 'GN', 'GO', 'G2', 'GP', 'GQ', 'GR', 'GS', 'G3', 'GT', 'GU', 'GV', 'GW', 'HD', 'HH', 'HI', 'HJ', 'HK', 'HL', 'HM', 'HN'] as const
/** 2033-A-SD, actif (brut, amortissements) and passif. */
export const FORM_2033A_BRUT = ['010', '014', '028', '040', '044', '050', '060', '064', '068', '072', '092', '080', '084', '096', '110'] as const
export const FORM_2033A_AMORT = ['012', '016', '030', '042', '048', '052', '062', '066', '070', '074', '094', '082', '086', '098', '112'] as const
export const FORM_2033A_PASSIF = ['120', '124', '126', '130', '131', '132', '134', '136', '137', '140', '142', '154', '156', '164', '166', '169', '172', '173', '175', '174', '176', '180'] as const
/** 2033-B-SD, A. Résultat comptable. */
export const FORM_2033B = ['210', '214', '218', '222', '224', '226', '230', '232', '234', '236', '238', '240', '242', '244', '250', '252', '254', '256', '262', '264', '270', '280', '290', '294', '300', '306', '310'] as const

/**
 * Lines of the simplified income statement that have no box on the 2033-B:
 * the 2052 and 2053 lines for opérations faites en commun (GH, GI) and the
 * participation des salariés (HJ). Kept apart so the résultat
 * d'exploitation (270) stays the PCG's; where to report them on the 2033-B
 * is for the company's accountant to decide.
 */
export const SIMPLIFIED_LINES_WITHOUT_2033B_BOX = ['GH', 'GI', 'HJ'] as const
