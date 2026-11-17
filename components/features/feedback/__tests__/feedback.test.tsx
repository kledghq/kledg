/**
 * Feedback from Kledg (docs/signaler-un-probleme.md): the help menu opens
 * the dialog, which shows the technical context before sending and links to
 * the prefilled GitHub issue form, with the page as a route pattern (never
 * the company slug). The error page prepares a bug with the error reference.
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({ params: { companyId: 'atelier-lumen' } as Record<string, string>, pathname: '/atelier-lumen/entries' }))
vi.mock('next/navigation', () => ({ useParams: () => nav.params, usePathname: () => nav.pathname }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))
vi.mock('@/components/pwa/install', () => ({ useIosInstallHint: () => false }))

import { FeedbackProvider } from '../feedback-context'
import { HelpMenu } from '@/components/layout/help-menu'
import ErrorPage from '@/app/error'

const TARGET = { repo: 'kledghq/kledg', version: '0.6.0', commit: 'abcdef1234567', host: 'Vercel' }

function renderMenu() {
  return render(
    <FeedbackProvider target={TARGET} displayMode="Expert">
      <HelpMenu onboardingEnabled={false} />
    </FeedbackProvider>,
  )
}

describe('feedback dialog', () => {
  it('opens from the help menu and prepares the bug on GitHub with the context shown first', async () => {
    const user = userEvent.setup()
    renderMenu()
    await user.click(screen.getByRole('button', { name: 'Aide' }))
    await user.click(screen.getByRole('menuitem', { name: 'Signaler un problème' }))
    const dialog = screen.getByRole('dialog', { name: 'Signaler un problème' })

    expect(within(dialog).getByRole('button', { name: /Ouvrir sur GitHub/ })).toBeDisabled()
    const context = within(dialog).getByRole('region', { name: 'Contexte technique ajouté' })
    expect(within(context).getByText('Version : 0.6.0 (abcdef1)')).toBeInTheDocument()
    expect(within(context).getByText('Page : /[companyId]/entries')).toBeInTheDocument()
    expect(within(context).getByText("Mode d'affichage : Expert")).toBeInTheDocument()
    expect(context).not.toHaveTextContent('atelier-lumen')

    await user.type(within(dialog).getByRole('textbox', { name: /Titre/ }), 'Export FEC vide')
    await user.type(within(dialog).getByRole('textbox', { name: /Que se passe-t-il/ }), 'Le fichier est vide.')
    await user.type(within(dialog).getByRole('textbox', { name: /Étapes pour reproduire/ }), '1. Exporter')

    const link = within(dialog).getByRole('link', { name: /Ouvrir sur GitHub/ })
    expect(link).toHaveAttribute('target', '_blank')
    const url = new URL(link.getAttribute('href')!)
    expect(url.origin + url.pathname).toBe('https://github.com/kledghq/kledg/issues/new')
    expect(url.searchParams.get('template')).toBe('bug_report.yml')
    expect(url.searchParams.get('title')).toBe('Export FEC vide')
    expect(url.searchParams.get('what')).toContain('Le fichier est vide.')
    expect(url.searchParams.get('what')).not.toContain('atelier-lumen')
    expect(url.searchParams.get('steps')).toBe('1. Exporter')
    expect(within(dialog).getByRole('link', { name: /Est-ce déjà signalé/ })).toHaveAttribute(
      'href',
      'https://github.com/kledghq/kledg/issues?q=is%3Aissue+Export+FEC+vide',
    )
  })

  it('prepares an idea with the feature request form', async () => {
    const user = userEvent.setup()
    renderMenu()
    await user.click(screen.getByRole('button', { name: 'Aide' }))
    await user.click(screen.getByRole('menuitem', { name: 'Proposer une idée' }))
    const dialog = screen.getByRole('dialog', { name: 'Proposer une idée' })
    await user.type(within(dialog).getByRole('textbox', { name: /Titre/ }), 'Export Excel')
    await user.type(within(dialog).getByRole('textbox', { name: /Besoin/ }), 'Partager avec mon expert-comptable')
    const url = new URL(within(dialog).getByRole('link', { name: /Ouvrir sur GitHub/ }).getAttribute('href')!)
    expect(url.searchParams.get('template')).toBe('feature_request.yml')
    expect(url.searchParams.get('need')).toContain('Partager avec mon expert-comptable')
  })

  it('reports an error page with its reference, even outside the app frame', async () => {
    const user = userEvent.setup()
    const error = Object.assign(new Error('boom'), { digest: '4242' })
    render(<ErrorPage error={error} reset={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Signaler le problème' }))
    const dialog = screen.getByRole('dialog', { name: 'Signaler un problème' })
    expect(within(dialog).getByText("Référence de l'erreur : 4242")).toBeInTheDocument()
  })
})
