/**
 * The approval pack per legal form (lib/approval/pack.ts) and its
 * documents (documents/build.ts, markdown.ts): officer titles, decision
 * type, quorum and majority wording, deadlines, required documents and
 * missing data, management report exemption, confidentiality options and
 * the filing checklist.
 *
 * Sources: C. com. L223-26, L223-27, L223-29, L223-31, L225-98, L225-100,
 * L227-9, L232-1 IV, L232-10, L232-22, L232-23, L232-25, R223-20, R225-69;
 * C. civ. 1852, 1856; CGI art. 223 quater and 243 bis.
 */

import { describe, expect, it } from 'vitest'
import { buildApprovalPack, type DocumentId } from '../pack'
import { buildDocument } from '../documents/build'
import { renderMarkdown } from '../documents/markdown'
import { eur } from '../documents/model'
import { complete, contextFor, details } from './fixtures'

const markdownOf = (legalType: string, id: DocumentId, patch = {}, contextPatch = {}) => {
  const context = contextFor(legalType, contextPatch)
  const d = complete(patch)
  const pack = buildApprovalPack(context, d)
  const doc = pack.documents.find((x) => x.id === id)
  expect(doc, `${id} is part of the ${legalType} pack`).toBeDefined()
  expect(doc?.missing).toEqual([])
  return renderMarkdown(buildDocument(id, { context, details: d, pack }))
}

const ids = (legalType: string, patch = {}) => buildApprovalPack(contextFor(legalType), complete(patch)).documents.map((d) => d.id)

describe('documents of the pack per legal form', () => {
  it('SARL: convocation, minutes of the assembly, attendance sheet, filing; no convocation for a sole partner', () => {
    expect(ids('SARL')).toEqual(['convocation', 'management-report', 'decision', 'attendance', 'confidentiality', 'filing-checklist'])
    expect(ids('EURL')).toEqual(['management-report', 'decision', 'confidentiality', 'filing-checklist'])
    expect(ids('SASU')).toEqual(['management-report', 'decision', 'confidentiality', 'filing-checklist'])
    expect(ids('SAS')).toEqual(['convocation', 'management-report', 'decision', 'attendance', 'confidentiality', 'filing-checklist'])
    expect(ids('SA')).toEqual(['convocation', 'management-report', 'decision', 'attendance', 'confidentiality', 'filing-checklist'])
  })

  it('SCI: written report of the gérance always, no greffe filing nor confidentiality declaration', () => {
    const pack = buildApprovalPack(contextFor('SCI'), complete({ managementReport: { produce: false, activity: 'Location.', outlook: 'Stable.' } }))
    expect(pack.documents.map((d) => d.id)).toEqual(['convocation', 'management-report', 'decision', 'attendance'])
    expect(pack.managementReport).toMatchObject({ required: true, produced: true })
    expect(pack.documents.find((d) => d.id === 'management-report')?.title).toBe('Rapport écrit de la gérance')
    expect(pack.publication.required).toBe(false)
    expect(pack.publication.notes[0]).toMatch(/ne dépose pas ses comptes au greffe/)
    expect(pack.deadlines).toMatchObject({ approval: null, filing: null })
  })

  it('a written consultation has a consultation letter and no attendance sheet', () => {
    expect(ids('SARL', { decisionMode: 'written' })).toEqual(['convocation', 'management-report', 'decision', 'confidentiality', 'filing-checklist'])
    const pack = buildApprovalPack(contextFor('SARL'), complete({ decisionMode: 'written' }))
    expect(pack.documents[0].title).toBe('Lettre de consultation écrite des associés')
    expect(pack.decisionTitle).toBe('Procès-verbal des décisions des associés prises par consultation écrite')
    // An SA decides in a meeting only (L225-100): the written mode is ignored.
    expect(buildApprovalPack(contextFor('SA'), complete({ decisionMode: 'written' })).decisionMode).toBe('meeting')
  })
})

describe('officer titles and decision type in the documents', () => {
  it('SARL minutes: assembly of the associés, gérance, majority of L223-29, signed by the chair', () => {
    const md = markdownOf('SARL', 'decision')
    expect(md).toContain("# Procès-verbal de l'assemblée générale ordinaire annuelle")
    expect(md).toContain('les associés de la société se sont réunis en assemblée générale ordinaire annuelle, au siège social, sur convocation de la gérance adressée le 29 mai 2026')
    expect(md).toContain('plus de la moitié des parts sociales (C. com. art. L. 223-29)')
    expect(md).toContain('Société à responsabilité limitée au capital de 10 000,00 €')
    expect(md).toContain('123 456 789 RCS Lyon')
    expect(md).toContain('Cette résolution, mise aux voix, est adoptée par 600 voix pour, 400 voix contre et 0 abstention.')
    expect(md).toContain('Jeanne Martin, président de séance')
  })

  it("EURL decision: the associé unique, the gérance prepared the accounts, recorded in the register", () => {
    const md = markdownOf('EURL', 'decision')
    expect(md).toContain("# Décision de l'associé unique du 15 juin 2026")
    expect(md).toContain('Jeanne Martin, associé unique de la société, détenant la totalité des 1 000 parts sociales')
    expect(md).toContain('arrêtés par la gérance')
    expect(md).toContain("consignée au registre des décisions de l'associé unique")
    expect(md).toContain("à l'associé unique, à titre de dividendes : 20 000,00 €")
    expect(md).not.toMatch(/mise aux voix|assemblée/)
  })

  it('SASU decision: the président prepared the accounts, never a gérant', () => {
    const md = markdownOf('SASU', 'decision')
    expect(md).toContain("# Décision de l'associé unique")
    expect(md).toContain('arrêtés par le président')
    expect(md).toContain('1 000 actions')
    expect(md).not.toMatch(/gérant|gérance/)
    const report = markdownOf('SASU', 'management-report', { officers: [{ name: 'Jeanne Martin' }] })
    expect(report).toContain('# Rapport de gestion du président')
    expect(report).toContain('Jeanne Martin, président')
    expect(report).not.toMatch(/gérant/)
  })

  it('SAS minutes: collective decision of the associés under the statuts', () => {
    const md = markdownOf('SAS', 'decision')
    expect(md).toContain('# Procès-verbal des décisions collectives des associés')
    expect(md).toContain('sur convocation du président')
    expect(md).toContain("Les décisions sont prises à la majorité des voix exprimées, conformément à l'article 18 des statuts.")
    expect(md).toContain('La collectivité des associés, après avoir pris connaissance')
  })

  it("SA minutes: actionnaires, conseil d'administration, quorum of one fifth reached", () => {
    const md = markdownOf('SA', 'decision')
    expect(md).toContain("sur convocation du conseil d'administration")
    expect(md).toContain('les actionnaires de la société se sont réunis')
    expect(md).toContain("Les actionnaires présents ou représentés possèdent 1 000 actions sur les 1 000 actions ayant le droit de vote : le quorum est atteint")
    expect(md).toContain('aux actionnaires, à titre de dividendes')
    expect(md).toContain("arrêtés par le conseil d'administration")
  })

  it('SCI minutes: gérance, no legal reserve, unanimity by default when the statuts are silent', () => {
    const md = markdownOf('SCI', 'decision', { statutoryRule: null, votes: { approval: { unanimous: true }, allocation: { unanimous: true }, powers: { unanimous: true } } })
    expect(md).toContain("à l'unanimité des associés à défaut (C. civ. art. 1852)")
    expect(md).toContain('rapport écrit de la gérance')
    expect(md).not.toContain('réserve légale')
    expect(md).not.toContain('243 bis')
  })

  it('never offers a quitus resolution (L223-22, L225-253) and uses no em or en dash', () => {
    for (const form of ['SARL', 'EURL', 'SAS', 'SASU', 'SA']) {
      for (const id of ['convocation', 'decision', 'management-report', 'confidentiality', 'filing-checklist'] as const) {
        if (!ids(form).includes(id)) continue
        const md = markdownOf(form, id)
        expect(md).not.toMatch(/quitus/i)
        expect(md).not.toMatch(/[\u2013\u2014]/)
      }
    }
  })
})

describe('result and allocation (L232-10, CGI 243 bis and 223 quater)', () => {
  it('sets aside the legal reserve computed by Kledg and recalls the dividends of the three previous years', () => {
    const md = markdownOf('SARL', 'decision')
    expect(md).toContain('à la réserve légale : 1 000,00 €')
    expect(md).toContain('au compte report à nouveau : 29 000,00 €')
    expect(md).toContain("Conformément à l'article 243 bis du Code général des impôts, l'assemblée générale prend acte que les dividendes distribués")
    expect(md).toContain('exercice 2023 : 1 500,00 €')
    expect(md).toContain("aucune dépense ni charge visée à l'article 39, 4 du Code général des impôts")
  })

  it('says when the legal reserve has reached a tenth of the capital', () => {
    const md = markdownOf('SARL', 'decision', {}, { balances: { resultCents: 5_000_000, legalReserveCents: 100_000, capitalCents: 1_000_000, retainedEarningsCents: 0, priorLossesCents: 0 } })
    expect(md).toContain('La réserve légale ayant atteint le dixième du capital social')
    expect(md).not.toContain('à la réserve légale :')
  })

  it('allocates a loss to the report à nouveau', () => {
    const md = markdownOf('SARL', 'decision', { allocation: { dividendsCents: 0 } }, { balances: { resultCents: -1_234_500, legalReserveCents: 0, capitalCents: 1_000_000, retainedEarningsCents: 200_000, priorLossesCents: 0 } })
    expect(md).toContain("décide d'affecter la perte de l'exercice, qui s'élève à 12 345,00 €, au compte report à nouveau, dont le solde débiteur est ainsi porté à 10 345,00 €.")
  })

  it('refuses dividends above the distributable profit (L232-11) until fixed', () => {
    const pack = buildApprovalPack(contextFor('SARL'), complete({ allocation: { dividendsCents: 6_000_000 } }))
    expect(pack.documents.find((d) => d.id === 'decision')?.missing.join(' ')).toMatch(/bénéfice distribuable/)
  })
})

describe('deadlines', () => {
  it('six months after the closing, then one month after approval or two online (L223-26, L232-22)', () => {
    const pack = buildApprovalPack(contextFor('SARL'), complete())
    expect(pack.deadlines).toMatchObject({ approval: '2026-06-30', filing: '2026-07-31', filingBasis: 'deadline', convocation: '2026-05-31' })
    const approved = buildApprovalPack(contextFor('SARL'), complete({ approvedOn: '2026-06-15', filedOnline: true }))
    expect(approved.deadlines).toMatchObject({ filing: '2026-08-15', filingBasis: 'approval' })
  })

  it('no legal six-month deadline for a multi-partner SAS, six months for a SASU and an SA', () => {
    expect(buildApprovalPack(contextFor('SAS'), complete()).deadlines.approval).toBeNull()
    expect(buildApprovalPack(contextFor('SAS'), complete()).deadlines.approvalNote).toMatch(/statuts/)
    expect(buildApprovalPack(contextFor('SASU'), complete()).deadlines.approval).toBe('2026-06-30')
    expect(buildApprovalPack(contextFor('SA'), complete()).deadlines.approval).toBe('2026-06-30')
    // SAS: filing counted from the usual six months until the approval day is recorded.
    expect(buildApprovalPack(contextFor('SAS'), complete()).deadlines.filing).toBe('2026-07-31')
  })

  it('warns about a late decision, a late convocation and missed deadlines', () => {
    const late = buildApprovalPack(contextFor('SARL', { today: '2026-09-15' }), complete({ meeting: { date: '2026-07-10', convocationDate: '2026-07-01', place: 'au siège', time: '10 h' } }))
    expect(late.warnings.join(' ')).toMatch(/dépasse le délai de six mois \(30 juin 2026\)/)
    expect(late.warnings.join(' ')).toMatch(/moins de 15 jours avant l'assemblée\u00a0: envoyez-la au plus tard le 25 juin 2026/)
    expect(late.warnings.join(' ')).toMatch(/délai de dépôt au greffe est dépassé depuis le 31 juillet 2026/)
  })

  it('warns about draft entries in correct French, singular and plural', () => {
    const one = buildApprovalPack(contextFor('SARL', { draftEntries: 1 }), complete())
    expect(one.warnings).toContain("1 écriture en brouillon sur l'exercice n'est pas comptée dans le résultat.")
    const three = buildApprovalPack(contextFor('SARL', { draftEntries: 3 }), complete())
    expect(three.warnings).toContain("3 écritures en brouillon sur l'exercice ne sont pas comptées dans le résultat.")
    expect([...one.warnings, ...three.warnings].join(' ')).not.toMatch(/\bne est\b/)
  })
})

describe('missing data is listed, never invented', () => {
  it('lists what each document needs from an empty form', () => {
    const pack = buildApprovalPack(contextFor('SARL', { company: { ...contextFor('SARL').company, address: null } }), details())
    const decision = pack.documents.find((d) => d.id === 'decision')?.missing ?? []
    expect(decision).toEqual(
      expect.arrayContaining([
        'Adresse du siège (informations de la société)',
        'Ville du greffe (RCS) où la société est immatriculée',
        'Nom du gérant',
        "Date de l'assemblée",
        "Lieu de l'assemblée",
        'Président de séance',
        'Présence de chaque associé',
        'Dividendes des trois exercices précédents (CGI art. 243 bis)',
        'Conventions réglementées conclues ou non au cours de l’exercice',
      ]),
    )
    expect(pack.documents.find((d) => d.id === 'convocation')?.missing).toEqual(expect.arrayContaining(["Heure de l'assemblée", 'Date d’envoi de la convocation']))
    // The management report depends on the size category, which is asked.
    expect(pack.managementReport).toMatchObject({ required: null, produced: false })
  })

  it('asks the officer title of the form: président for a SAS', () => {
    const pack = buildApprovalPack(contextFor('SAS'), details())
    expect(pack.documents.find((d) => d.id === 'decision')?.missing).toEqual(expect.arrayContaining(['Nom du président', 'Règle de majorité des statuts']))
  })

  it('asks the representative of a legal person sole partner', () => {
    const context = contextFor('SASU', { holders: [{ id: 'h1', name: 'Holding Beta', kind: 'LEGAL', shares: 1000 }] })
    const pack = buildApprovalPack(context, complete({ attendance: [] }))
    expect(pack.documents.find((d) => d.id === 'decision')?.missing).toContain('Représentant de l’associé unique (personne morale)')
  })

  it('needs the shares of every associé to count the votes', () => {
    const context = contextFor('SARL', { holders: [{ id: 'h1', name: 'Jeanne Martin', kind: 'PHYSICAL', shares: null }, { id: 'h2', name: 'Holding Beta', kind: 'LEGAL', shares: 400 }] })
    expect(buildApprovalPack(context, complete()).documents.find((d) => d.id === 'decision')?.missing).toContain('Nombre de titres de chaque associé (informations de la société)')
  })
})

describe('management report and confidentiality (L232-1 IV, L232-25)', () => {
  it('exempts micro and small commercial companies, not holdings nor medium ones', () => {
    expect(buildApprovalPack(contextFor('SARL'), complete({ size: { category: 'small', employees: 20 } })).managementReport.required).toBe(false)
    expect(buildApprovalPack(contextFor('SARL'), complete({ size: { category: 'medium', employees: 60 } })).managementReport.required).toBe(true)
    const holding = contextFor('SAS', { company: { ...contextFor('SAS').company, isHolding: true } })
    expect(buildApprovalPack(holding, complete()).managementReport.required).toBe(true)
    expect(buildApprovalPack(contextFor('SARL'), complete({ excludedEntity: true })).managementReport.required).toBe(true)
  })

  it('offers each confidentiality option to its category only', () => {
    const available = (patch: object, contextPatch = {}) =>
      buildApprovalPack(contextFor('SARL', contextPatch), complete(patch))
        .confidentiality.choices.filter((c) => c.available)
        .map((c) => c.value)
    expect(available({ size: { category: 'micro', employees: 2 } })).toEqual(['none', 'full'])
    expect(available({ size: { category: 'small', employees: 20 }, groupMember: false })).toEqual(['none', 'income_statement'])
    expect(available({ size: { category: 'small', employees: 20 }, groupMember: true })).toEqual(['none'])
    expect(available({ size: { category: 'medium', employees: 100 }, groupMember: false })).toEqual(['none', 'simplified'])
    expect(available({ size: { category: 'large', employees: 400 } })).toEqual(['none'])
    expect(available({ size: { category: 'micro', employees: 2 } }, { company: { ...contextFor('SARL').company, isHolding: true } })).toEqual(['none'])
  })

  it('blocks a declaration whose option the company cannot take', () => {
    const pack = buildApprovalPack(contextFor('SARL'), complete({ size: { category: 'small', employees: 20 }, confidentiality: 'full' }))
    expect(pack.documents.find((d) => d.id === 'confidentiality')?.missing.join(' ')).toMatch(/micro-entreprise/)
  })

  it('writes the declaration of a small company: income statement not public', () => {
    const md = markdownOf('SARL', 'confidentiality', { size: { category: 'small', employees: 20 }, confidentiality: 'income_statement', filedOn: '2026-07-20', approvedOn: '2026-06-15' })
    expect(md).toContain("définition de petite entreprise au sens de l'article L. 123-16 du Code de commerce")
    expect(md).toContain("qu'elle n'appartient pas à un groupe au sens de l'article L. 233-16")
    expect(md).toContain('je demande que le compte de résultat déposé ne soit pas rendu public')
    expect(md).toContain('Fait à Lyon, le 20 juillet 2026')
  })
})

describe('filing checklist (L232-22, L232-23)', () => {
  it('lists the accounts, the allocation, the refusal case, the online channel and the sanction', () => {
    const md = markdownOf('SARL', 'filing-checklist', { approvedOn: '2026-06-15', filedOnline: true, hasAuditor: true })
    expect(md).toContain('Date limite de dépôt : 15 août 2026.')
    expect(md).toContain('- [ ] Rapport du commissaire aux comptes sur les comptes annuels.')
    expect(md).toContain("- [ ] Proposition d'affectation du résultat et décision d'affectation votée")
    expect(md).toContain("- [ ] En cas de refus d'approbation : une copie de la délibération, dans le même délai.")
    expect(md).toContain('formalites.entreprises.gouv.fr')
    expect(md).toContain('R. 247-3')
    expect(md).toContain('C. com., art. L232-22')
  })

  it('says when filing the signed accounts is worth approval (EURL, SASU)', () => {
    expect(buildApprovalPack(contextFor('EURL'), complete()).publication.notes.join(' ')).toMatch(/seul gérant, le dépôt au greffe .* vaut approbation/)
    expect(buildApprovalPack(contextFor('SASU'), complete()).publication.notes.join(' ')).toMatch(/personne physique, est le président, le dépôt au greffe .* vaut approbation/)
  })
})

describe('Markdown rendering', () => {
  it('escapes Markdown characters typed by the user and formats amounts in French', () => {
    const md = markdownOf('SARL', 'management-report', { managementReport: { produce: true, activity: '# Titre *gras* | pipe', outlook: '- tiret', postClosingEvents: 'Aucun.', research: 'Aucune.' } })
    expect(md).toContain('\\# Titre \\*gras\\* \\| pipe')
    expect(md).toContain('\\- tiret')
    expect(eur(123_456_789)).toBe('1 234 567,89 €')
    expect(eur(-5)).toBe('-0,05 €')
  })
})
