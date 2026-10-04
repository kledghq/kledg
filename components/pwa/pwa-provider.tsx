'use client'

import { useEffect } from 'react'
import { toast } from 'sonner'
import { serviceWorkerDecision, serviceWorkerUrl } from '@/lib/pwa/platform'
import { clearPwaCaches, setInstallPrompt, type BeforeInstallPromptEvent } from '@/components/pwa/install'

const UPDATE_TOAST_ID = 'kledg-update'

/**
 * Registers the service worker (public/sw.js) and keeps the browser's
 * install prompt for the user menu. Rendered once by the root layout; it
 * renders nothing and runs no inline script (the page CSP allows none
 * without its nonce): this is bundled client code.
 *
 * A new build installs a new worker that waits (public/sw.js). When one is
 * waiting and the page is already controlled, a toast offers to reload:
 * the worker takes over only then, and the page reloads once.
 */
export function PwaProvider() {
  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      // Keep the prompt for "Installer l'application" instead of the browser's mini bar.
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
    }
    const onInstalled = () => setInstallPrompt(null)
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const container = navigator.serviceWorker
    const decision = serviceWorkerDecision({
      nodeEnv: process.env.NODE_ENV,
      disabled: process.env.NEXT_PUBLIC_DISABLE_SW,
      protocol: window.location.protocol,
      hostname: window.location.hostname,
    })
    if (decision === 'unregister') {
      void container
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
        .then(() => clearPwaCaches({ all: true }))
        .catch(() => undefined)
      return
    }
    if (decision !== 'register') return

    let reloadRequested = false
    // The first install also changes the controller (clients.claim): reload
    // only when the user asked for the new version.
    const onControllerChange = () => {
      if (!reloadRequested) return
      reloadRequested = false
      window.location.reload()
    }
    container.addEventListener('controllerchange', onControllerChange)

    const offerUpdate = (worker: ServiceWorker) => {
      // Nothing to update on the first visit: no page runs an older version.
      if (!container.controller) return
      toast('Nouvelle version disponible', {
        id: UPDATE_TOAST_ID,
        description: 'Rechargez la page pour utiliser la dernière version de Kledg.',
        duration: Infinity,
        action: {
          label: 'Recharger',
          onClick: () => {
            reloadRequested = true
            worker.postMessage({ type: 'SKIP_WAITING' })
          },
        },
      })
    }

    let cancelled = false
    container
      .register(serviceWorkerUrl(process.env.KLEDG_BUILD_DATE), { scope: '/', updateViaCache: 'none' })
      .then((registration) => {
        if (cancelled) return
        if (registration.waiting) offerUpdate(registration.waiting)
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing
          installing?.addEventListener('statechange', () => {
            if (installing.state === 'installed') offerUpdate(installing)
          })
        })
      })
      .catch(() => {
        // No worker (private browsing, blocked storage): the app works the same online.
      })

    return () => {
      cancelled = true
      container.removeEventListener('controllerchange', onControllerChange)
    }
  }, [])

  return null
}
