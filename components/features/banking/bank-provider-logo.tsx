import { Landmark } from 'lucide-react'

import { cn } from '@/lib/utils'
import { BANK_PROVIDER_LABELS } from '@/lib/banking/links'

/**
 * Logo of the way a bank account is reached, the same everywhere in the app:
 * Qonto wordmark and Revolut mark (monochrome, currentColor, so they follow
 * the theme), the bank logo served by Ponto for other banks, and a neutral
 * bank icon for manual accounts, file imports and banks without a logo.
 *
 * Marks: Qonto wordmark as published on qonto.com; Revolut "R" from Simple
 * Icons (CC0 path data of the official mark). Kledg is not affiliated with
 * these companies (BANK_TRADEMARKS_NOTICE on the setup pages).
 */

export type BankProviderName = 'QONTO' | 'REVOLUT' | 'PONTO' | 'MANUAL' | string

interface BankProviderLogoProps {
  provider: BankProviderName | null | undefined
  /** Ponto: logo URL of the institution (from the Ponto API). */
  logoUrl?: string | null
  /** Ponto: name of the institution, used as alt text. */
  institutionName?: string | null
  /** Shows the provider name next to the mark (Revolut Business, Fichier...). */
  withLabel?: boolean
  className?: string
}

export { BANK_PROVIDER_LABELS }

function QontoWordmark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 82 24" fill="currentColor" role="img" aria-label="Qonto" className={cn('h-4 w-auto', className)}>
      <path d="M42.0568 23.1253H45.1924V14.0659C45.1924 11.8462 46.6873 10.167 48.6803 10.167C50.6734 10.167 52.3143 11.8462 52.3143 14.0659V23.1209H55.6862V13.8286C55.6862 9.89892 52.5806 6.93188 49.1786 6.93188C47.89 6.93188 46.3565 7.34507 45.1924 8.98903V7.29232H42.0568V23.1253Z" />
      <path d="M73.8516 6.92749C69.307 6.92749 65.8234 10.6154 65.8234 15.2659C65.8234 20.0352 69.3113 23.4813 73.8516 23.4813C78.5121 23.4813 82 20.0308 82 15.2659C82 10.6198 78.5121 6.92749 73.8516 6.92749ZM73.8516 20.1539C71.3001 20.1539 69.191 17.9956 69.191 15.2659C69.191 12.3868 71.3001 10.2594 73.8516 10.2594C76.5491 10.2594 78.6281 12.3868 78.6281 15.2659C78.6281 17.9956 76.5491 20.1539 73.8516 20.1539Z" />
      <path d="M65.2348 23.1252V19.7977C62.8895 20.9977 60.6903 20.0395 60.6903 17.3977V10.4967H64.8826V7.28786H60.6903V3.20874H57.4386V16.8263C57.4429 22.4043 61.1628 24.3252 65.2348 23.1252Z" />
      <path d="M32.1514 6.92749C27.6068 6.92749 24.1232 10.6154 24.1232 15.2659C24.1232 20.0352 27.6111 23.4813 32.1514 23.4813C36.8119 23.4813 40.2998 20.0308 40.2998 15.2659C40.2955 10.6198 36.8076 6.92749 32.1514 6.92749ZM32.1514 20.1539C29.5741 20.1539 27.4908 17.9956 27.4908 15.2659C27.4908 12.3868 29.5698 10.2594 32.1514 10.2594C34.8188 10.2594 36.9279 12.3868 36.9279 15.2659C36.9279 17.9956 34.8145 20.1539 32.1514 20.1539Z" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M0 11.8198C0 5.01099 4.89251 0 11.2841 0C17.8175 0 22.7143 5.01099 22.7143 11.8198C22.7143 15.0108 21.5472 17.8667 19.5922 19.954C20.4874 20.2473 21.4701 20.4512 22.5472 20.5714L22.1777 24C19.9817 23.755 18.0572 23.1983 16.395 22.3223C14.8746 23.0692 13.1458 23.4857 11.2841 23.4857C4.89251 23.4857 0 18.356 0 11.8198ZM11.2841 20.0352C11.9228 20.0352 12.5365 19.9669 13.1197 19.8363C11.6342 18.2601 10.4946 16.2439 9.68659 13.7758L12.8824 12.6813C13.6769 15.1072 14.8103 16.9278 16.3708 18.2161C18.0764 16.7474 19.108 14.4899 19.1104 11.8198C19.1104 6.93187 15.8287 3.33187 11.2841 3.33187C6.85553 3.33187 3.60388 6.93187 3.60388 11.8198C3.60388 16.5846 6.85983 20.0352 11.2841 20.0352Z"
      />
    </svg>
  )
}

function RevolutMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={cn('size-4 shrink-0', className)}>
      <path d="M20.9133 6.9566C20.9133 3.1208 17.7898 0 13.9503 0H2.424v3.8605h10.9782c1.7376 0 3.177 1.3651 3.2087 3.043.016.84-.2994 1.633-.8878 2.2324-.5886.5998-1.375.9303-2.2144.9303H9.2322a.2756.2756 0 0 0-.2755.2752v3.431c0 .0585.018.1142.052.1612L16.2646 24h5.3114l-7.2727-10.094c3.6625-.1838 6.61-3.2612 6.61-6.9494zM6.8943 5.9229H2.424V24h4.4704z" />
    </svg>
  )
}

export function BankProviderLogo({ provider, logoUrl, institutionName, withLabel = false, className }: BankProviderLogoProps) {
  if (provider === 'QONTO') {
    return (
      <span className={cn('inline-flex h-5 items-center', className)}>
        <QontoWordmark />
      </span>
    )
  }
  if (provider === 'REVOLUT') {
    return (
      <span className={cn('inline-flex h-5 items-center gap-1.5 text-sm font-medium', className)}>
        <RevolutMark />
        {withLabel ? <span>Revolut Business</span> : <span className="sr-only">Revolut Business</span>}
      </span>
    )
  }
  const label = institutionName || (provider ? BANK_PROVIDER_LABELS[provider] : null) || 'Banque'
  return (
    <span className={cn('inline-flex h-5 items-center gap-1.5 text-sm', className)}>
      {logoUrl ? (
        // Logo served by the Ponto API for this institution (external SVG, no optimization needed)
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="size-5 shrink-0 rounded-sm object-contain" loading="lazy" />
      ) : (
        <Landmark aria-hidden className="text-muted-foreground size-4 shrink-0" />
      )}
      {withLabel ? <span className="truncate">{label}</span> : <span className="sr-only">{label}</span>}
    </span>
  )
}
