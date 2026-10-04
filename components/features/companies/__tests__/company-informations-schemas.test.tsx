import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { companySchema, companySlugError, optionalNumberInput, shareholderSchema } from '../company-informations-schemas'
import { CompanyNameWithForm, LegalFormTag } from '../legal-form-tag'

const valid = { name: 'Alpha', slug: 'alpha', siren: '123456789' }

function messages(input: unknown) {
  const result = companySchema.safeParse(input)
  return result.success ? [] : result.error.issues.map((issue) => issue.message)
}

describe('companySchema', () => {
  it('accepts a minimal company', () => {
    expect(companySchema.safeParse(valid).success).toBe(true)
  })

  it.each([
    ['12345678', 'Le SIREN doit contenir 9 chiffres'],
    ['1234567890', 'Le SIREN doit contenir 9 chiffres'],
    ['12345678A', 'Le SIREN doit contenir exactement 9 chiffres'],
    ['123 45678', 'Le SIREN doit contenir exactement 9 chiffres'],
  ])('refuses the SIREN %s', (siren, message) => {
    expect(messages({ ...valid, siren })).toContain(message)
  })

  it('requires a name and checks email and colour formats', () => {
    expect(messages({ ...valid, name: '' })).toContain('Le nom est requis')
    expect(messages({ ...valid, email: 'pas-un-email' })).toContain('Email invalide')
    expect(companySchema.safeParse({ ...valid, email: '' }).success).toBe(true)
    expect(messages({ ...valid, color: 'red' })).toContain('Couleur invalide (format hex: #RRGGBB)')
    expect(companySchema.safeParse({ ...valid, color: '#1a2B3c' }).success).toBe(true)
  })

  it('bounds the closing day and month, and wants whole positive shares', () => {
    expect(companySchema.safeParse({ ...valid, closingDay: 31, closingMonth: 12 }).success).toBe(true)
    expect(companySchema.safeParse({ ...valid, closingDay: 32 }).success).toBe(false)
    expect(companySchema.safeParse({ ...valid, closingMonth: 0 }).success).toBe(false)
    expect(companySchema.safeParse({ ...valid, totalShares: 10.5 }).success).toBe(false)
    expect(companySchema.safeParse({ ...valid, totalShares: 0 }).success).toBe(false)
    expect(companySchema.safeParse({ ...valid, legalType: 'GIE' }).success).toBe(false)
    expect(companySchema.safeParse({ ...valid, legalType: 'SASU', sector: 'tech' }).success).toBe(true)
  })

  it('applies the slug rules of the API', () => {
    expect(messages({ ...valid, slug: 'reserved' })).toEqual([])
    expect(messages({ ...valid, slug: 'settings' })).toEqual(['Cet identifiant est réservé.'])
  })
})

describe('companySlugError', () => {
  it.each([
    ['a', "L'identifiant doit contenir au moins 2 caractères."],
    ['a'.repeat(61), "L'identifiant doit contenir au plus 60 caractères."],
    ['Alpha', "L'identifiant ne peut contenir que des lettres minuscules sans accents, des chiffres et des tirets (pas en début ni en fin)."],
    ['société', "L'identifiant ne peut contenir que des lettres minuscules sans accents, des chiffres et des tirets (pas en début ni en fin)."],
    ['-alpha', "L'identifiant ne peut contenir que des lettres minuscules sans accents, des chiffres et des tirets (pas en début ni en fin)."],
    ['alpha--beta', "L'identifiant ne peut contenir que des lettres minuscules sans accents, des chiffres et des tirets (pas en début ni en fin)."],
    ['api', 'Cet identifiant est réservé.'],
    ['new', 'Cet identifiant est réservé.'],
    ['cjld2cjxh0000qzrmn831i7rn', 'Cet identifiant ressemble à un identifiant technique, choisissez-en un autre.'],
  ])('refuses %s', (slug, message) => {
    expect(companySlugError(slug)).toBe(message)
  })

  it.each(['ab', 'alpha-beta', 'societe-2026', 'a'.repeat(60)])('accepts %s', (slug) => {
    expect(companySlugError(slug)).toBeNull()
  })
})

describe('shareholderSchema', () => {
  it('needs a person for a natural person and a name for an external legal entity', () => {
    const physical = shareholderSchema.safeParse({ type: 'PHYSICAL', sharePercentage: 10 })
    expect(physical.error?.issues).toEqual([
      expect.objectContaining({ path: ['personId'], message: 'Sélectionnez une personne, ou créez-en une avec le bouton +.' }),
    ])
    const legal = shareholderSchema.safeParse({ type: 'LEGAL', name: '  ', sharePercentage: 10 })
    expect(legal.error?.issues).toEqual([expect.objectContaining({ path: ['name'], message: 'La raison sociale est requise.' })])
    expect(shareholderSchema.safeParse({ type: 'LEGAL', companyShareholderId: 'c2', sharePercentage: 10 }).success).toBe(true)
    expect(shareholderSchema.safeParse({ type: 'PHYSICAL', personId: 'p1', sharePercentage: 10 }).success).toBe(true)
  })

  it('keeps the share between 0 and 100 % and the number of shares whole', () => {
    const issues = (input: Record<string, unknown>) =>
      shareholderSchema.safeParse({ type: 'PHYSICAL', personId: 'p1', ...input }).error?.issues.map((i) => i.message) ?? []
    expect(issues({ sharePercentage: 100 })).toEqual([])
    expect(issues({ sharePercentage: 100.01 })).toEqual(['Le pourcentage doit être entre 0 et 100'])
    expect(issues({ sharePercentage: -1 })).toEqual(['Le pourcentage doit être entre 0 et 100'])
    expect(issues({ sharePercentage: Number.NaN })).toEqual(['Saisissez le pourcentage de participation'])
    expect(issues({ sharePercentage: 10, numberOfShares: 1.5 })).toEqual(['Le nombre de parts doit être un entier'])
    expect(issues({ sharePercentage: 10, numberOfShares: 0 })).toEqual(['Le nombre de parts doit être positif'])
  })

  it('reads a blank optional number input as undefined', () => {
    expect(optionalNumberInput('')).toBeUndefined()
    expect(optionalNumberInput(undefined)).toBeUndefined()
    expect(optionalNumberInput('abc')).toBeUndefined()
    expect(optionalNumberInput('12.5')).toBe(12.5)
    expect(optionalNumberInput(3)).toBe(3)
  })
})

describe('LegalFormTag', () => {
  it('shows the short tag with the full name for screen readers and on hover', () => {
    render(<LegalFormTag legalType="SASU" />)
    const tag = screen.getByTitle('Société par actions simplifiée unipersonnelle')
    expect(tag).toHaveTextContent('SASU')
    expect(screen.getByText('Société par actions simplifiée unipersonnelle')).toHaveClass('sr-only')
  })

  it('renders nothing for an unknown or missing form', () => {
    const { container } = render(
      <>
        <LegalFormTag legalType="GIE" />
        <LegalFormTag legalType={null} />
      </>,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('drops the legal form from the name and shows it as a tag', () => {
    render(<CompanyNameWithForm name="Alpha S.A.S." legalType="SAS" />)
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByTitle('Société par actions simplifiée')).toHaveTextContent('SAS')
  })

  it('keeps the whole name when the form is unknown', () => {
    render(<CompanyNameWithForm name="Alpha SAS" legalType={null} />)
    expect(screen.getByText('Alpha SAS')).toBeInTheDocument()
  })
})
