'use client'

import { useSyncExternalStore } from 'react'
import { isIosDevice, isStandaloneDisplay, PWA_CACHE_PREFIX } from '@/lib/pwa/platform'

/**
 * Install state of the app, shared by the user menu ("Installer
 * l'application", Chromium) and the help menu (the Share menu steps, iOS).
 * The `beforeinstallprompt` event is captured once by PwaProvider and kept
 * here; nothing is shown unprompted (no banner).
 */

/** Chromium's install prompt event (not in the DOM typings). */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferredPrompt: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Keeps (or forgets, with null) the install prompt the browser offered. */
export function setInstallPrompt(event: BeforeInstallPromptEvent | null) {
  deferredPrompt = event
  emit()
}

/** Whether the browser offered to install the app, and the action that asks it. */
export function useInstallPrompt(): { canInstall: boolean; install: () => Promise<void> } {
  const prompt = useSyncExternalStore(
    subscribe,
    () => deferredPrompt,
    () => null,
  )
  return {
    canInstall: prompt !== null,
    install: async () => {
      if (!prompt) return
      await prompt.prompt()
      // A prompt can be shown once: forget it whatever the answer.
      await prompt.userChoice.catch(() => undefined)
      setInstallPrompt(null)
    },
  }
}

function iosHintSnapshot(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean }
  const standalone = isStandaloneDisplay({
    displayModeStandalone: window.matchMedia?.('(display-mode: standalone)').matches ?? false,
    navigatorStandalone: nav.standalone,
  })
  return !standalone && isIosDevice({ userAgent: nav.userAgent, maxTouchPoints: nav.maxTouchPoints ?? 0 })
}

const noSubscription = () => () => {}

/** True on iOS outside the installed app: Safari has no install prompt, the help menu explains the Share menu. */
export function useIosInstallHint(): boolean {
  return useSyncExternalStore(noSubscription, iosHintSnapshot, () => false)
}

/**
 * Deletes what the service worker (public/sw.js) stored while the session
 * browsed: the build assets of `kledg-static-*`. They are never data, but
 * sign out leaves nothing of the session's browsing behind. The shell cache
 * (`kledg-shell-*`: offline page and icons, the same public files for
 * everyone, stored at install) is kept, otherwise the offline page would
 * be gone until the next build; so is the worker, which serves no user
 * content. `all` also deletes the shell (kill switch, worker unregistered).
 */
export async function clearPwaCaches(options: { all?: boolean } = {}): Promise<void> {
  if (typeof caches === 'undefined') return
  const prefix = options.all ? PWA_CACHE_PREFIX : `${PWA_CACHE_PREFIX}static-`
  const names = await caches.keys()
  await Promise.all(names.filter((name) => name.startsWith(prefix)).map((name) => caches.delete(name)))
}
