import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PersonAvatar, personInitials } from '../person-avatar'

const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ=='

describe('PersonAvatar', () => {
  it('shows the photo of the person, decorative next to the name', () => {
    const { container } = render(<PersonAvatar name="Claire Vasseur" photo={PHOTO} />)
    const avatar = container.querySelector('[data-slot="person-avatar"]')
    expect(avatar).toHaveAttribute('aria-hidden')
    expect(avatar?.querySelector('img')).toHaveAttribute('src', PHOTO)
    expect(avatar?.querySelector('img')).toHaveAttribute('alt', '')
  })

  it('shows the initials without a photo', () => {
    const { container } = render(<PersonAvatar name="Hélène Garnier" />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toBe('HG')
  })

  it('never loads an address: only an image data URL is shown', () => {
    const { container } = render(<PersonAvatar name="Marc Vasseur" photo="https://exemple.test/photo.jpg" />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toBe('MV')
  })

  it('falls back to the initials when the photo cannot be read', () => {
    const { container } = render(<PersonAvatar name="Thomas Verdier" photo={PHOTO} />)
    fireEvent.error(container.querySelector('img') as HTMLImageElement)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toBe('TV')
  })

  it('takes the first and last word of a name', () => {
    expect(personInitials('Jean-Pierre de La Tour')).toBe('JT')
    expect(personInitials('claire')).toBe('C')
    expect(personInitials('')).toBe('')
    expect(personInitials(null)).toBe('')
  })
})
