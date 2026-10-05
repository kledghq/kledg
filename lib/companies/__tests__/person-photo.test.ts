/**
 * A person's photo (Person.photo) is shown in the group space, the
 * shareholders list and the capital composition: it is validated like a
 * company logo (lib/companies/logo.ts), and only an inline image is accepted.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())

import { CreatePersonSchema } from '../manage-persons.service'

const base = { firstName: 'Claire', name: 'Vasseur' }
const parse = (photo: string) => CreatePersonSchema.safeParse({ ...base, photo })

describe('photo of a person', () => {
  it('accepts a PNG, JPEG, GIF or WebP data URL', () => {
    for (const type of ['png', 'jpeg', 'gif', 'webp']) expect(parse(`data:image/${type};base64,iVBORw0KGgo=`).success, type).toBe(true)
    expect(parse('').data?.photo).toBeNull()
  })

  it('refuses an address, an SVG, a broken payload or a photo too heavy', () => {
    for (const photo of ['https://exemple.test/photo.jpg', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,<script>', `data:image/png;base64,${'A'.repeat(700_000)}`]) {
      const result = parse(photo)
      expect(result.success, photo.slice(0, 40)).toBe(false)
    }
    expect(parse('data:image/svg+xml;base64,PHN2Zz4=').error?.issues[0].message).toBe('Format de photo non pris en charge (PNG, JPEG, GIF ou WebP).')
  })
})
