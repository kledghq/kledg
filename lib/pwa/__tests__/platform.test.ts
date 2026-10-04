import { describe, expect, it } from 'vitest'
import { isIosDevice, isStandaloneDisplay, serviceWorkerDecision, serviceWorkerUrl } from '@/lib/pwa/platform'
import { isPwaPublicPath } from '@/lib/pwa/paths'

describe('serviceWorkerDecision', () => {
  const base = { nodeEnv: 'production', disabled: undefined, protocol: 'https:', hostname: 'compta.example.fr' }

  it('registers in production on HTTPS', () => {
    expect(serviceWorkerDecision(base)).toBe('register')
  })

  it('registers on plain HTTP for localhost only', () => {
    expect(serviceWorkerDecision({ ...base, protocol: 'http:', hostname: 'localhost' })).toBe('register')
    expect(serviceWorkerDecision({ ...base, protocol: 'http:', hostname: '127.0.0.1' })).toBe('register')
    expect(serviceWorkerDecision({ ...base, protocol: 'http:', hostname: '[::1]' })).toBe('register')
    expect(serviceWorkerDecision({ ...base, protocol: 'http:', hostname: 'compta.example.fr' })).toBe('skip')
    expect(serviceWorkerDecision({ ...base, protocol: 'http:', hostname: '192.168.1.20' })).toBe('skip')
  })

  it('never registers in development or tests', () => {
    expect(serviceWorkerDecision({ ...base, nodeEnv: 'development' })).toBe('skip')
    expect(serviceWorkerDecision({ ...base, nodeEnv: 'test' })).toBe('skip')
  })

  it('unregisters everywhere with the kill switch', () => {
    expect(serviceWorkerDecision({ ...base, disabled: 'true' })).toBe('unregister')
    expect(serviceWorkerDecision({ ...base, nodeEnv: 'development', disabled: 'true' })).toBe('unregister')
    expect(serviceWorkerDecision({ ...base, disabled: 'false' })).toBe('register')
  })
})

describe('serviceWorkerUrl', () => {
  it('versions the worker by build so each deployment gets fresh caches', () => {
    expect(serviceWorkerUrl('2026-10-04T08:00:00.000Z')).toBe('/sw.js?v=2026-10-04T08%3A00%3A00.000Z')
    expect(serviceWorkerUrl(undefined)).toBe('/sw.js')
  })
})

describe('isIosDevice', () => {
  it('recognises iPhone, iPad (also reporting as a Mac) and not desktops or Android', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
    const ipadAsMac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
    const android = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'
    expect(isIosDevice({ userAgent: iphone, maxTouchPoints: 5 })).toBe(true)
    expect(isIosDevice({ userAgent: ipadAsMac, maxTouchPoints: 5 })).toBe(true)
    expect(isIosDevice({ userAgent: ipadAsMac, maxTouchPoints: 0 })).toBe(false)
    expect(isIosDevice({ userAgent: android, maxTouchPoints: 5 })).toBe(false)
  })
})

describe('isStandaloneDisplay', () => {
  it('is true in an installed window or from the iOS home screen', () => {
    expect(isStandaloneDisplay({ displayModeStandalone: true, navigatorStandalone: undefined })).toBe(true)
    expect(isStandaloneDisplay({ displayModeStandalone: false, navigatorStandalone: true })).toBe(true)
    expect(isStandaloneDisplay({ displayModeStandalone: false, navigatorStandalone: false })).toBe(false)
  })
})

describe('isPwaPublicPath', () => {
  it('lists the manifest, the worker and the offline page, nothing else', () => {
    expect(isPwaPublicPath('/manifest.webmanifest')).toBe(true)
    expect(isPwaPublicPath('/sw.js')).toBe(true)
    expect(isPwaPublicPath('/offline.html')).toBe(true)
    expect(isPwaPublicPath('/sw.js/../api/entries')).toBe(false)
    expect(isPwaPublicPath('/offline.html/x')).toBe(false)
    expect(isPwaPublicPath('/acme')).toBe(false)
  })
})
