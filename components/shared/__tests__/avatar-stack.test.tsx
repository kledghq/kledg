/**
 * The holders of a holding as an avatar stack (switcher and group views,
 * docs/vue-groupe.md): largest stake first, at most three then "+N", each
 * named "Name, 60 %" for screen readers and in its title; a person round
 * with photo or initials, a company square with logo or initials.
 */

import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AvatarStack, type StackedHolder } from '../avatar-stack'

const PHOTO = 'data:image/png;base64,iVBORw0KGgo='
const NBSP = ' '

const holder = (name: string, percentBp: number, kind: StackedHolder['kind'] = 'person', photo: string | null = null): StackedHolder => ({ name, percentBp, kind, photo })

describe('AvatarStack', () => {
  it('shows a single shareholder with their photo and name', () => {
    render(<AvatarStack holders={[holder('Claire Vasseur', 10000, 'person', PHOTO)]} />)
    const stack = screen.getByRole('group', { name: 'Associés de la holding' })
    const avatar = within(stack).getByRole('img', { name: `Claire Vasseur, 100${NBSP}%` })
    expect(avatar).toHaveAttribute('title', `Claire Vasseur, 100${NBSP}%`)
    expect(avatar.querySelector('img')).toHaveAttribute('src', PHOTO)
    expect(avatar.className).toContain('rounded-full')
    expect(within(stack).queryByText(/^\+/)).toBeNull()
  })

  it('shows three shareholders, largest stake first, a company square with its initials', () => {
    render(<AvatarStack holders={[holder('Marc Vasseur', 2500), holder('Nova Invest', 1500, 'company'), holder('Claire Vasseur', 6000, 'person', PHOTO)]} />)
    const avatars = within(screen.getByRole('group')).getAllByRole('img')
    expect(avatars.map((a) => a.getAttribute('aria-label'))).toEqual([`Claire Vasseur, 60${NBSP}%`, `Marc Vasseur, 25${NBSP}%`, `Nova Invest, 15${NBSP}%`])
    expect(avatars[1]).toHaveTextContent('MV')
    expect(avatars[2]).toHaveTextContent('NI')
    expect(avatars[2].className).toContain('rounded-md')
    expect(screen.queryByText(/^\+/)).toBeNull()
  })

  it('shows three of five shareholders, then "+2" naming the two others', () => {
    render(
      <AvatarStack
        holders={[holder('A Un', 3000), holder('B Deux', 2500), holder('C Trois', 2000), holder('D Quatre', 1500), holder('E Cinq', 1000)]}
      />,
    )
    const items = within(screen.getByRole('group')).getAllByRole('img')
    expect(items).toHaveLength(4)
    expect(items.slice(0, 3).map((a) => a.getAttribute('aria-label'))).toEqual([`A Un, 30${NBSP}%`, `B Deux, 25${NBSP}%`, `C Trois, 20${NBSP}%`])
    expect(items[3]).toHaveTextContent('+2')
    expect(items[3]).toHaveAttribute('aria-label', `2 autres associés${NBSP}: D Quatre, 15${NBSP}%${NBSP}; E Cinq, 10${NBSP}%`)
  })

  it('renders nothing without a shareholder to show', () => {
    const { container } = render(<AvatarStack holders={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
