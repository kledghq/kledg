'use client'

import * as React from 'react'

import { cn } from '@/lib/utils'
import { personInitials } from './person-avatar'

export interface StackedHolder {
  name: string
  /** A person's photo or a company's logo (data URL or same-origin image). */
  photo: string | null
  /** Basis points (6000 = 60 %). */
  percentBp: number
  kind: 'person' | 'company'
}

const SIZES = { sm: 'size-6 text-[10px]', md: 'size-8 text-xs' } as const

/** How much each avatar slides under the previous one: about 40 % of its width. */
const OVERLAP = { sm: '-space-x-2.5', md: '-space-x-3.5' } as const

const percentText = (bp: number) => `${(bp / 100).toFixed(2).replace(/\.?0+$/, '').replace('.', ',')} %`

/** "Claire Vasseur, 60 %": the accessible name and the title of an avatar. */
export const holderLabel = (h: StackedHolder) => `${h.name}, ${percentText(h.percentBp)}`

const isImage = (value: string | null): value is string => typeof value === 'string' && (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/.test(value) || value.startsWith('/'))

function StackAvatar({ holder, size }: { holder: StackedHolder; size: keyof typeof SIZES }) {
  const [failed, setFailed] = React.useState(false)
  const label = holderLabel(holder)
  const showImage = isImage(holder.photo) && !failed
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-slot="avatar-stack-item"
      className={cn(
        'bg-muted text-muted-foreground ring-sidebar flex shrink-0 items-center justify-center overflow-hidden border font-medium ring-2',
        holder.kind === 'person' ? 'rounded-full' : 'rounded-md',
        SIZES[size],
      )}
    >
      {showImage ? (
        <img src={holder.photo as string} alt="" className={cn('size-full', holder.kind === 'person' ? 'object-cover' : 'bg-background object-contain')} onError={() => setFailed(true)} />
      ) : (
        personInitials(holder.name)
      )}
    </span>
  )
}

/**
 * The holders of a company as overlapping avatars, largest stake first: at
 * most `max` avatars, then "+N" for the others. A person is round (photo,
 * else initials), a company square (logo, else initials). Each avatar is
 * named for screen readers and in its title: "Claire Vasseur, 60 %". The
 * caller passes only the holders the user may see.
 */
export function AvatarStack({ holders, max = 3, size = 'md', className }: { holders: readonly StackedHolder[]; max?: number; size?: keyof typeof SIZES; className?: string }) {
  if (holders.length === 0) return null
  const sorted = [...holders].sort((a, b) => b.percentBp - a.percentBp)
  const shown = sorted.slice(0, max)
  const rest = sorted.slice(max)
  const restLabel = rest.length > 0 ? `${rest.length} autre${rest.length > 1 ? 's' : ''} associé${rest.length > 1 ? 's' : ''}\u00a0: ${rest.map(holderLabel).join(' ; ')}` : ''
  return (
    <span role="group" aria-label="Associés de la holding" data-slot="avatar-stack" className={cn('flex shrink-0 items-center', OVERLAP[size], className)}>
      {shown.map((h, i) => (
        <StackAvatar key={`${h.name}-${i}`} holder={h} size={size} />
      ))}
      {rest.length > 0 ? (
        <span
          role="img"
          aria-label={restLabel}
          title={restLabel}
          className={cn('bg-background text-muted-foreground ring-sidebar num flex shrink-0 items-center justify-center rounded-full border font-medium ring-2', SIZES[size])}
        >
          +{rest.length}
        </span>
      ) : null}
    </span>
  )
}
