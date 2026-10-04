'use client'

import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared'
import type { OnboardingStepId } from '@/lib/onboarding/checklist'
import { useCompanyOnboarding } from './use-company-onboarding'

interface OnboardingEmptyStateProps {
  companyId: string
  title: string
  /** What the page shows once there is data, and where it comes from. */
  description: string
  /** Steps of the "Démarrer" checklist that fill this page, in order. */
  steps: OnboardingStepId[]
  /** Shown when every step is done or the guide is off (e.g. "Nouvelle écriture"). */
  fallback?: { label: string; href: string }
  icon?: LucideIcon
  docsHref?: string
  docsLabel?: string
  bordered?: boolean
}

/**
 * Empty state of a main company page that points to the next step of the
 * "Démarrer" checklist which would fill it (connect the bank, take over the
 * history), instead of an empty table. Falls back to the page's own action.
 */
export function OnboardingEmptyState({
  companyId,
  title,
  description,
  steps,
  fallback,
  icon,
  docsHref,
  docsLabel,
  bordered = true,
}: OnboardingEmptyStateProps) {
  const { data } = useCompanyOnboarding(companyId)
  const step = data?.enabled ? data.steps.find((s) => steps.includes(s.id) && !s.done && s.action) : undefined

  return (
    <EmptyState
      bordered={bordered}
      icon={icon}
      title={title}
      description={step ? `${description} Prochaine étape\u00a0: ${step.title.toLowerCase()}.` : description}
      action={
        step?.action ? (
          <Button asChild size="sm">
            <Link href={step.action.href}>{step.action.label}</Link>
          </Button>
        ) : fallback ? (
          <Button asChild size="sm">
            <Link href={fallback.href}>{fallback.label}</Link>
          </Button>
        ) : null
      }
      secondaryAction={
        step?.action && fallback ? (
          <Button asChild size="sm" variant="outline">
            <Link href={fallback.href}>{fallback.label}</Link>
          </Button>
        ) : null
      }
      docsHref={docsHref}
      docsLabel={docsLabel}
    />
  )
}
