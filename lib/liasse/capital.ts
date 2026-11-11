/**
 * Composition du capital social and filiales et participations: forms
 * 2033-F-SD and 2033-G-SD (régime simplifié), 2059-F-SD and 2059-G-SD
 * (régime normal), 2026, on plain values (pure). Same frames, different box
 * codes. Both forms are due from legal persons only: "les entreprises
 * individuelles n'ont pas à servir les tableaux nos 2033-F-SD et
 * 2033-G-SD" (notice 2033-NOT-SD).
 *
 * Composition du capital (annexe III au CGI, art. 38; notice 2033-NOT-SD):
 * the number of shareholders and of shares held by legal persons and by
 * natural persons, then the identity of each shareholder holding at least
 * 10 % of the capital. Read from the capital composition of the company
 * (lib/reports/capital-composition): its counts, percentages and checks.
 * The birth data and the address of a natural person are on the
 * shareholder's record; the liasse says whether they are filled but never
 * copies them (they stay on the record, read with the settings right).
 *
 * Filiales et participations: every company of which the company holds
 * directly at least 10 % of the capital, with its legal form, name,
 * address, SIREN and percentage held. Read from the group data (the
 * subsidiaries recorded in Kledg whose shareholders name the company,
 * lib/group) and from the participations outside Kledg answered on the
 * annexe; a subsidiary the user cannot read is counted, not read, and makes
 * the count a figure to check by hand.
 */

import { formatCentsFr } from '@/lib/utils/money'
import { cell, check, count, field, manual, percent, text, type LiasseCell, type LiasseCheck, type LiasseForm, type LiasseRow, type LiasseSection } from './cells'

/** Threshold of both forms, hundredths of a percent. */
export const DECLARATION_THRESHOLD_HUNDREDTHS = 1_000

export interface AddressText {
  street: string
  postalCode: string
  city: string
  country: string
}

export interface CompanyIdentity {
  name: string
  siren: string
  /** SIRET of the head office establishment (2059-F and 2059-G print "N° SIRET"). */
  siret: string | null
  legalType: string | null
  address: AddressText | null
  endDate: string
}

export interface CapitalCodes {
  legalHolders: string
  legalShares: string
  naturalHolders: string
  naturalShares: string
  totalHolders: string
  totalShares: string
}

/** 2033-F-SD prints 901 to 906 (its notice names them P1 to P4, the codes of 2059-F-SD). */
/** 2059-F-SD prints P1 to P6. */
export const CAPITAL_CODES_2059F: CapitalCodes = { legalHolders: 'P1', legalShares: 'P3', naturalHolders: 'P2', naturalShares: 'P4', totalHolders: 'P5', totalShares: 'P6' }

export const CAPITAL_CODES_2033F: CapitalCodes = { legalHolders: '901', legalShares: '902', naturalHolders: '903', naturalShares: '904', totalHolders: '905', totalShares: '906' }

export interface HolderIdentity {
  id: string
  kind: 'PHYSICAL' | 'LEGAL'
  /** Dénomination of a legal person, full name of a natural person. */
  name: string
  shares: number | null
  /** Share of the capital: from the number of shares when known, else the stored percentage. */
  percentHundredths: number
  // Legal person
  siren: string | null
  legalForm: string | null
  address: AddressText | null
  // Natural person
  lastName: string | null
  firstNames: string | null
  usualName: string | null
  /** Birth date, place (department and commune) and country are on the record. */
  birthRecorded: boolean
  addressRecorded: boolean
}

export interface CapitalInput {
  form: { id: string; number: string; title: string }
  codes: CapitalCodes
  /** "SIREN" on 2033-F-SD, "N° SIRET" on 2059-F-SD. */
  identifier: 'siren' | 'siret'
  company: CompanyIdentity
  holders: readonly HolderIdentity[]
  /** Inconsistencies of the capital composition (French). */
  compositionChecks: readonly string[]
}

const frDay = (iso: string) => iso.split('-').reverse().join('/')
export const addressLine = (a: AddressText) => `${a.street}, ${a.postalCode} ${a.city}${a.country && a.country !== 'FR' ? `, ${a.country}` : ''}`

const INDIVIDUAL = 'EI'

/** Identification frame shared by the F and G forms. */
function identification(company: CompanyIdentity, identifier: 'siren' | 'siret'): LiasseCell[] {
  const where = "Renseignez l'adresse du siège dans Société, Informations."
  return [
    cell(null, 'Exercice clos le', text(frDay(company.endDate)), 'record'),
    identifier === 'siren'
      ? cell(null, 'SIREN', text(company.siren), 'record')
      : company.siret
        ? cell(null, 'N° SIRET', text(company.siret), 'record', { note: 'Établissement du siège.' })
        : manual(null, 'N° SIRET', "Aucun établissement du siège avec son SIRET : ajoutez-le dans Société, Informations."),
    cell(null, "Dénomination de l'entreprise", text(company.name), 'record'),
    company.address ? cell(null, 'Adresse (voie)', text(company.address.street), 'record') : manual(null, 'Adresse (voie)', where),
    company.address ? cell(null, 'Code postal', text(company.address.postalCode), 'record') : manual(null, 'Code postal', where),
    company.address ? cell(null, 'Ville', text(company.address.city), 'record') : manual(null, 'Ville', where),
  ]
}

const notRequiredForIndividual = (legalType: string | null) =>
  legalType === INDIVIDUAL ? { value: false, reason: "Les entreprises individuelles n'ont pas à servir ce tableau (notices 2033-NOT-SD et 2032-NOT-SD, annexe III au CGI, art. 38)." } : null

/** Composition du capital social (2033-F-SD, 2059-F-SD). */
export function buildCapitalForm(input: CapitalInput): LiasseForm {
  const { codes, holders } = input
  const legal = holders.filter((h) => h.kind === 'LEGAL')
  const natural = holders.filter((h) => h.kind === 'PHYSICAL')
  const sharesOf = (list: readonly HolderIdentity[], box: string, label: string): LiasseCell =>
    list.every((h) => h.shares !== null)
      ? cell(box, label, count(list.reduce((s, h) => s + (h.shares ?? 0), 0)), 'record')
      : manual(box, label, "Le nombre de parts ou d'actions manque pour au moins un associé : complétez-le dans Société, Informations.")
  const legalShares = sharesOf(legal, codes.legalShares, "Nombre total de parts ou d'actions correspondantes (personnes morales)")
  const naturalShares = sharesOf(natural, codes.naturalShares, "Nombre total de parts ou d'actions correspondantes (personnes physiques)")
  const totals: LiasseCell[] = [
    cell(codes.legalHolders, "Nombre total d'associés ou actionnaires personnes morales de l'entreprise", count(legal.length), 'record'),
    legalShares,
    cell(codes.naturalHolders, "Nombre total d'associés ou actionnaires personnes physiques de l'entreprise", count(natural.length), 'record'),
    naturalShares,
    cell(codes.totalHolders, `Total des lignes ${codes.legalHolders} + ${codes.naturalHolders}`, count(holders.length), 'record'),
    legalShares.value?.kind === 'count' && naturalShares.value?.kind === 'count'
      ? cell(codes.totalShares, `Total des lignes ${codes.legalShares} + ${codes.naturalShares}`, count(legalShares.value.value + naturalShares.value.value), 'record')
      : manual(codes.totalShares, `Total des lignes ${codes.legalShares} + ${codes.naturalShares}`, "Le nombre de parts ou d'actions manque pour au moins un associé."),
  ]

  const declared = (h: HolderIdentity) => h.percentHundredths >= DECLARATION_THRESHOLD_HUNDREDTHS
  const sharesCell = (h: HolderIdentity) =>
    h.shares !== null ? cell(null, "Nb de parts ou actions", count(h.shares), 'record') : manual(null, 'Nb de parts ou actions', "Complétez le nombre de parts de l'associé dans Société, Informations.")
  const legalRows: LiasseRow[] = legal.filter(declared).map((h) => ({
    id: `legal-${h.id}`,
    label: h.name,
    cells: [
      h.legalForm ? cell(null, 'Forme juridique', text(h.legalForm), 'record') : manual(null, 'Forme juridique', "La forme juridique de l'associé n'est pas connue de Kledg."),
      cell(null, 'Dénomination', text(h.name), 'record'),
      h.siren ? cell(null, 'N° SIREN (si société établie en France)', text(h.siren), 'record') : manual(null, 'N° SIREN (si société établie en France)', "Aucun SIREN ou SIRET sur la fiche de l'associé : à indiquer s'il est établi en France."),
      cell(null, '% de détention', percent(h.percentHundredths), 'record'),
      sharesCell(h),
      h.address ? cell(null, 'Adresse', text(addressLine(h.address)), 'record') : manual(null, 'Adresse', "L'adresse de l'associé n'est pas connue de Kledg."),
    ],
  }))
  const naturalRows: LiasseRow[] = natural.filter(declared).map((h) => ({
    id: `natural-${h.id}`,
    label: h.name,
    cells: [
      manual(null, 'Titre', 'M pour Monsieur, MME pour Madame : Kledg n\'enregistre pas la civilité.'),
      h.lastName ? cell(null, 'Nom de famille', text(h.lastName), 'record') : manual(null, 'Nom de famille', "Complétez la fiche de l'associé."),
      h.firstNames ? cell(null, 'Prénom(s)', text(h.firstNames), 'record') : manual(null, 'Prénom(s)', "Complétez la fiche de l'associé."),
      h.usualName ? cell(null, "Nom d'usage", text(h.usualName), 'record') : manual(null, "Nom d'usage", "Aucun nom d'usage sur la fiche : seulement s'il diffère du nom de famille."),
      cell(null, '% de détention', percent(h.percentHundredths), 'record'),
      sharesCell(h),
      manual(
        null,
        'Naissance : date, n° département, commune, pays',
        h.birthRecorded ? "Enregistrée sur la fiche de l'associé (Société, Informations) : à recopier." : "Manque sur la fiche de l'associé : complétez-la dans Société, Informations.",
      ),
      manual(null, 'Adresse', h.addressRecorded ? "Enregistrée sur la fiche de l'associé (Société, Informations) : à recopier." : "Manque sur la fiche de l'associé : complétez-la dans Société, Informations."),
    ],
  }))

  const checks: LiasseCheck[] = input.compositionChecks.map((message, i) => check(`composition-${i}`, 'Composition du capital', false, message))
  if (checks.length === 0) checks.push(check('composition', 'Composition du capital : associés, parts, pourcentages et capital comptabilisé (compte 101)', true, null))
  for (const h of natural.filter(declared)) {
    if (!h.birthRecorded || !h.addressRecorded) {
      checks.push(check(`identity-${h.id}`, `${h.name} : identité pour le tableau`, false, `La date et le lieu de naissance ou l'adresse de ${h.name} manquent sur sa fiche : complétez-la dans Société, Informations.`))
    }
  }
  const sections: LiasseSection[] = [
    { id: 'identification', title: 'Identification', columns: null, rows: identification(input.company, input.identifier).map((c, i) => field(`id-${i}`, c)) },
    { id: 'totals', title: 'Associés et actionnaires', columns: null, rows: totals.map((c, i) => ({ ...field(`totals-${i}`, c), total: i >= 4 })) },
    {
      id: 'legal',
      title: 'I. Capital détenu par les personnes morales',
      columns: ['Forme juridique', 'Dénomination', 'N° SIREN', '% de détention', 'Nb de parts ou actions', 'Adresse'],
      rows: legalRows,
      note: legalRows.length === 0 ? "Aucune personne morale ne détient 10 % ou plus du capital." : undefined,
    },
    {
      id: 'natural',
      title: 'II. Capital détenu par les personnes physiques',
      columns: ['Titre', 'Nom de famille', 'Prénom(s)', "Nom d'usage", '% de détention', 'Nb de parts ou actions', 'Naissance', 'Adresse'],
      rows: naturalRows,
      note: naturalRows.length === 0 ? 'Aucune personne physique ne détient 10 % ou plus du capital.' : undefined,
    },
  ]
  const required =
    notRequiredForIndividual(input.company.legalType) ??
    (holders.length === 0 ? { value: true, reason: "Aucun associé n'est enregistré : complétez la composition du capital avant de remplir ce tableau." } : { value: true, reason: null })
  return {
    id: input.form.id,
    number: input.form.number,
    title: input.form.title,
    sections,
    checks,
    warnings: legalRows.length + naturalRows.length > 4 ? ['Plus de quatre associés à déclarer dans un cadre : utilisez des tableaux supplémentaires numérotés (notice).'] : [],
    required,
  }
}

export interface SubsidiaryIdentity {
  name: string
  siren: string | null
  ownershipHundredths: number
  legalForm: string | null
  address: AddressText | null
  /** group: a company of Kledg whose shareholders name the company; annexe: answered on the annexe. */
  from: 'group' | 'annexe'
}

export interface SubsidiariesInput {
  form: { id: string; number: string; title: string }
  /** Box of the number of subsidiaries: 905 on 2033-G-SD, P5 on 2059-G-SD. */
  countBox: string
  identifier: 'siren' | 'siret'
  company: CompanyIdentity
  subsidiaries: readonly SubsidiaryIdentity[]
  /** Subsidiaries recorded in Kledg the user cannot read. */
  unreachable: number
  /** Balance of the titres de participation (261) at the end of the year. */
  titresCents: number
  /** 261 sub-accounts whose label names no readable subsidiary. */
  unattributed: ReadonlyArray<{ accountCode: string; label: string; cents: number }>
}

/** Filiales et participations (2033-G-SD, 2059-G-SD). */
export function buildSubsidiariesForm(input: SubsidiariesInput): LiasseForm {
  const listed = input.subsidiaries.filter((s) => s.ownershipHundredths >= DECLARATION_THRESHOLD_HUNDREDTHS)
  const countCell: LiasseCell =
    input.unreachable > 0
      ? manual(input.countBox, "Nombre total de filiales détenues par l'entreprise", `${input.unreachable} filiale${input.unreachable > 1 ? 's' : ''} enregistrée${input.unreachable > 1 ? 's' : ''} dans Kledg ne vous ${input.unreachable > 1 ? 'sont' : 'est'} pas accessible${input.unreachable > 1 ? 's' : ''} : ajoutez-la${input.unreachable > 1 ? 's' : ''} au décompte.`, count(listed.length))
      : cell(input.countBox, "Nombre total de filiales détenues par l'entreprise", count(listed.length), 'record')
  const rows: LiasseRow[] = listed.map((s, i) => ({
    id: `subsidiary-${i}`,
    label: s.name,
    cells: [
      s.legalForm ? cell(null, 'Forme juridique', text(s.legalForm), 'record') : manual(null, 'Forme juridique', s.from === 'annexe' ? "Participation hors Kledg : forme juridique à indiquer." : 'Forme juridique non renseignée sur la société.'),
      cell(null, 'Dénomination', text(s.name), s.from === 'annexe' ? 'answer' : 'record'),
      s.siren ? cell(null, 'N° SIREN (si société établie en France)', text(s.siren), s.from === 'annexe' ? 'answer' : 'record') : manual(null, 'N° SIREN (si société établie en France)', "SIREN non renseigné : à indiquer si la société est établie en France."),
      cell(null, '% de détention', percent(s.ownershipHundredths), s.from === 'annexe' ? 'answer' : 'record'),
      s.address ? cell(null, 'Adresse', text(addressLine(s.address)), 'record') : manual(null, 'Adresse', s.from === 'annexe' ? 'Participation hors Kledg : adresse à indiquer.' : "Adresse du siège non renseignée sur la société."),
    ],
  }))
  const checks: LiasseCheck[] = [
    check(
      'titres',
      'Titres de participation (261) et filiales déclarées',
      !(input.titresCents > 0 && input.subsidiaries.length === 0 && input.unreachable === 0),
      `Le compte 261 a un solde de ${formatCentsFr(input.titresCents)} à la fin de l'exercice, mais aucune filiale ni participation n'est enregistrée : enregistrez la société comme actionnaire de sa filiale (Société, Informations de la filiale), ou indiquez la participation dans l'annexe.`,
    ),
  ]
  const warnings = [
    ...input.unattributed.map((u) => `Le compte ${u.accountCode} (${u.label || 'sans libellé'}, ${formatCentsFr(u.cents)}) ne nomme aucune filiale accessible dans Kledg : vérifiez qu'elle figure au tableau.`),
    ...(listed.length > 8 ? ['Plus de huit filiales : utilisez des tableaux supplémentaires numérotés (notice).'] : []),
  ]
  const required = notRequiredForIndividual(input.company.legalType) ?? (listed.length === 0 && input.unreachable === 0 ? { value: true, reason: 'Aucune filiale ni participation de 10 % ou plus : cochez « Néant ».' } : { value: true, reason: null })
  return {
    id: input.form.id,
    number: input.form.number,
    title: input.form.title,
    sections: [
      { id: 'identification', title: 'Identification', columns: null, rows: identification(input.company, input.identifier).map((c, i) => field(`id-${i}`, c)) },
      { id: 'count', title: "I. Nombre total de filiales détenues par l'entreprise", columns: null, rows: [{ ...field('count', countCell), total: true }] },
      {
        id: 'subsidiaries',
        title: 'Filiales et participations (10 % du capital ou plus)',
        columns: ['Forme juridique', 'Dénomination', 'N° SIREN', '% de détention', 'Adresse'],
        rows,
        note: rows.length === 0 ? "Aucune société dont l'entreprise détient directement 10 % ou plus du capital." : undefined,
      },
    ],
    checks,
    warnings,
    required,
  }
}
