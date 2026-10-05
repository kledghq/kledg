/**
 * "Proposer avec l'IA" (components/features/ai-assist): no button without a
 * connected assistant; one assistant opens a new chat with the request (and
 * copies it); another assistant gets the request copied; several open the
 * last one chosen, remembered per user, and list the others in a menu that
 * the keyboard reaches; blocked storage changes nothing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { toast } from 'sonner'
import { AiAssistProvider, type AiAssistContextValue } from '../ai-assist-context'
import { ProposeWithAiButton } from '../propose-with-ai-button'
import type { AiPromptTarget } from '@/lib/ai-assist/prompts'

const TARGET: AiPromptTarget = { kind: 'bank_transaction', id: 'tx_1', date: '2026-09-29', label: 'PRLV SEPA FREE PRO', amountCents: -4_799 }
const NAME = "Proposer avec l'IA"

function renderWith(apps: AiAssistContextValue['apps'], props: Partial<React.ComponentProps<typeof ProposeWithAiButton>> = {}) {
  return render(
    <AiAssistProvider value={{ companyId: 'cmp_1', companyName: 'Atelier Lumen', userId: 'u1', apps }}>
      <ProposeWithAiButton target={TARGET} {...props} />
    </AiAssistProvider>,
  )
}

/** In-memory localStorage: the one of the test environment is not always usable. */
class MemoryStorage implements Storage {
  private items = new Map<string, string>()
  get length() {
    return this.items.size
  }
  clear() {
    this.items.clear()
  }
  getItem(key: string) {
    return this.items.get(key) ?? null
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.items.delete(key)
  }
  setItem(key: string, value: string) {
    this.items.set(key, String(value))
  }
}

class BlockedStorage extends MemoryStorage {
  getItem(): string | null {
    throw new DOMException('blocked', 'SecurityError')
  }
  setItem(): void {
    throw new DOMException('blocked', 'SecurityError')
  }
}

const openedUrl = () => new URL(String(vi.mocked(window.open).mock.calls[0][0]))

describe('ProposeWithAiButton', () => {
  const writeText = vi.fn<(text: string) => Promise<void>>(async () => {})
  /** user-event installs its own clipboard: spy on it after the setup. */
  const setup = () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(writeText)
    return user
  }

  beforeEach(() => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    vi.stubGlobal('localStorage', new MemoryStorage())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('shows nothing when the user connected no assistant to the company', () => {
    const { container } = renderWith([])
    expect(container).toBeEmptyDOMElement()
  })

  it('opens Claude in a new tab with the request naming the company and the transaction, and copies it', async () => {
    const user = setup()
    renderWith(['claude'])
    const button = screen.getByRole('button', { name: NAME })
    expect(button).toHaveAttribute('title', 'Ouvrir dans Claude avec une demande préparée')
    await user.click(button)
    expect(window.open).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/claude\.ai\/new\?q=/), '_blank', 'noopener,noreferrer')
    const prompt = openedUrl().searchParams.get('q') ?? ''
    expect(prompt.replace(/ /g, ' ')).toMatch(/^Avec Kledg \(société « Atelier Lumen », id cmp_1\), propose l'écriture pour la transaction tx_1 du 29\/09\/2026/)
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(prompt))
    expect(toast.success).toHaveBeenCalledWith('Demande ouverte dans Claude', { description: 'Elle est aussi copiée : collez-la si le champ est vide.' })
  })

  it('copies the request for another assistant (API key, Claude Code), without opening a tab', async () => {
    const user = setup()
    renderWith(['other'])
    await user.click(screen.getByRole('button', { name: NAME }))
    expect(window.open).not.toHaveBeenCalled()
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Demande copiée', { description: 'Collez-la dans votre assistant connecté à Kledg.' }))
    expect(writeText.mock.calls[0][0]).toContain('tx_1')
  })

  it('says so when the request cannot be copied', async () => {
    const user = setup()
    writeText.mockRejectedValueOnce(new Error('denied'))
    renderWith(['other'])
    await user.click(screen.getByRole('button', { name: NAME }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("La demande n'a pas pu être copiée. Réessayez, ou autorisez le presse-papiers pour ce site."))
  })

  it('lets the user choose among several assistants with the keyboard, and remembers the choice', async () => {
    const user = setup()
    const { unmount } = renderWith(['claude', 'chatgpt', 'other'])
    const chooser = screen.getByRole('button', { name: "Choisir l'assistant" })
    chooser.focus()
    await user.keyboard('{Enter}')
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((i) => i.textContent)).toEqual(['Ouvrir dans ClaudeDernier choix', 'Ouvrir dans ChatGPT', 'Copier la demande'])
    await user.keyboard('{ArrowDown}{Enter}')
    expect(openedUrl().origin).toBe('https://chatgpt.com')
    expect(window.localStorage.getItem('kledg:ai-assist:last-app:u1')).toBe('chatgpt')
    unmount()

    // Next time, the main button opens ChatGPT directly.
    vi.mocked(window.open).mockClear()
    renderWith(['claude', 'chatgpt', 'other'])
    await waitFor(() => expect(screen.getByRole('button', { name: NAME })).toHaveAttribute('title', 'Ouvrir dans ChatGPT avec une demande préparée'))
    await user.click(screen.getByRole('button', { name: NAME }))
    expect(openedUrl().origin).toBe('https://chatgpt.com')
  })

  it('works when the browser blocks storage', async () => {
    const user = setup()
    vi.stubGlobal('localStorage', new BlockedStorage())
    renderWith(['claude', 'chatgpt'])
    await user.click(screen.getByRole('button', { name: NAME }))
    expect(openedUrl().origin).toBe('https://claude.ai')
  })

  it('is an icon button with a name in table rows', async () => {
    const user = setup()
    renderWith(['chatgpt'], { icon: true })
    const button = screen.getByRole('button', { name: NAME })
    expect(button.textContent).toBe('')
    await user.click(button)
    expect(openedUrl().origin).toBe('https://chatgpt.com')
  })
})
