'use client'

import * as React from 'react'

import { cn } from '@/lib/utils'

/** Up to two initials of a name ("Claire Vasseur" is "CV"), letters only. */
export function personInitials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/[\s-]+/).filter((w) => /\p{L}/u.test(w))
  if (words.length === 0) return ''
  const first = words[0][0] ?? ''
  const last = words.length > 1 ? (words[words.length - 1][0] ?? '') : ''
  return `${first}${last}`.toUpperCase()
}

/** Only an inline image is shown (Person.photo is a data URL, validated when saved): nothing is fetched from elsewhere. */
const isImageDataUrl = (value: string | null | undefined): value is string => typeof value === 'string' && /^data:image\/(png|jpe?g|gif|webp);base64,/.test(value)

const SIZES = { sm: 'size-6 text-[10px]', md: 'size-8 text-xs', lg: 'size-12 text-sm' } as const

/**
 * The photo of a natural person (Person.photo), round, with the initials of
 * the name when there is no photo or it cannot be read. Decorative next to
 * the name it stands for: the name is always written beside it.
 */
export function PersonAvatar({ name, photo, size = 'md', className }: { name: string | null; photo?: string | null; size?: keyof typeof SIZES; className?: string }) {
  const [failed, setFailed] = React.useState(false)
  const showPhoto = isImageDataUrl(photo) && !failed
  return (
    <span
      data-slot="person-avatar"
      aria-hidden
      className={cn('bg-muted text-muted-foreground flex shrink-0 items-center justify-center overflow-hidden rounded-full border font-medium', SIZES[size], className)}
    >
      {showPhoto ? <img src={photo} alt="" className="size-full object-cover" onError={() => setFailed(true)} /> : personInitials(name)}
    </span>
  )
}
