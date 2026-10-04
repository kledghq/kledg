'use client'

import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { useCompanyAccess } from '@/components/features/companies/company-access'

interface ConnectBankButtonProps extends Pick<React.ComponentProps<typeof Button>, 'size' | 'variant'> {
  companyId: string
  children?: React.ReactNode
}

/**
 * "Connecter une banque", on every page that offers it (Banque, Relevés,
 * Informations): a link to the connection page, or the same button disabled
 * with the reason when the role cannot manage bank connections.
 */
export function ConnectBankButton({ companyId, size, variant, children = 'Connecter une banque' }: ConnectBankButtonProps) {
  const { can, denied } = useCompanyAccess()
  if (!can({ banking: ['manage'] })) {
    return (
      <Button size={size} variant={variant} disabled title={denied('connecter une banque')}>
        {children}
      </Button>
    )
  }
  return (
    <Button asChild size={size} variant={variant}>
      <Link href={`/${companyId}/banking/connect`}>{children}</Link>
    </Button>
  )
}
