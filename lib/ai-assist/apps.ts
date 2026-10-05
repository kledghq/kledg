/**
 * The assistant apps "Proposer avec l'IA" can open with a prepared request.
 * Pure module.
 *
 * - Claude: https://claude.ai/new?q=<request>, the "new chat" address with
 *   the prompt field prefilled; the desktop app documents the same address
 *   with the q parameter (claude://claude.ai/new?q=..., Anthropic help
 *   center, "Open Claude Desktop with a link"; q is URL encoded and cut near
 *   14 000 characters). The web page fills the field without sending it.
 * - ChatGPT: https://chatgpt.com/?q=<request>, the address ChatGPT reads on
 *   load to start a chat with that message (widely used, not documented by
 *   OpenAI).
 * Neither address is guaranteed by its vendor, so the request is always
 * copied to the clipboard as well: the user pastes it if the field is empty.
 * Any other assistant (an API key, Claude Code, an unverified client) gets
 * the request copied only.
 */

/** An app the button can open with a prepared request, or 'other' (the request is copied). */
export type AssistantApp = 'claude' | 'chatgpt' | 'other'

/** Order of the apps in the menu: Claude first. */
export const ASSISTANT_APP_ORDER: readonly AssistantApp[] = ['claude', 'chatgpt', 'other']

export interface AssistantAppInfo {
  label: string
  /** Address of a new chat with `prompt`, or null when the app is opened by the user (copy only). */
  url: ((prompt: string) => string) | null
}

export const ASSISTANT_APPS: Record<AssistantApp, AssistantAppInfo> = {
  claude: { label: 'Claude', url: (prompt) => `https://claude.ai/new?q=${encodeURIComponent(prompt)}` },
  chatgpt: { label: 'ChatGPT', url: (prompt) => `https://chatgpt.com/?q=${encodeURIComponent(prompt)}` },
  other: { label: 'Autre assistant', url: null },
}

/** The app to use: the remembered one when still connected, else the first connected. */
export function pickApp(apps: readonly AssistantApp[], remembered: string | null): AssistantApp | null {
  if (apps.length === 0) return null
  return apps.find((a) => a === remembered) ?? apps[0]
}

/** localStorage key of the last app chosen by `userId` (per browser). */
export function lastAppStorageKey(userId: string): string {
  return `kledg:ai-assist:last-app:${userId}`
}
