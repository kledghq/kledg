/**
 * Revolut Business API endpoints. Production by default; REVOLUT_ENVIRONMENT=sandbox
 * switches to the sandbox (test data), REVOLUT_API_URL / REVOLUT_CONSENT_URL
 * override either URL.
 *
 * Servers: https://github.com/revolut-engineering/revolut-openapi (json/business.json)
 * Consent page and token endpoint:
 * https://developer.revolut.com/docs/guides/manage-accounts/get-started/make-your-first-api-request
 */

import { getAppUrl } from '@/lib/config'

export type RevolutEnvironment = 'production' | 'sandbox'

const URLS: Record<RevolutEnvironment, { api: string; consent: string }> = {
  production: {
    api: 'https://b2b.revolut.com/api/1.0',
    consent: 'https://business.revolut.com/app-confirm',
  },
  sandbox: {
    api: 'https://sandbox-b2b.revolut.com/api/1.0',
    consent: 'https://sandbox-business.revolut.com/app-confirm',
  },
}

export function getRevolutEnvironment(): RevolutEnvironment {
  return process.env.REVOLUT_ENVIRONMENT === 'sandbox' ? 'sandbox' : 'production'
}

export function getRevolutUrls(environment: RevolutEnvironment = getRevolutEnvironment()): { api: string; consent: string } {
  const defaults = URLS[environment]
  return {
    api: (process.env.REVOLUT_API_URL || defaults.api).replace(/\/$/, ''),
    consent: process.env.REVOLUT_CONSENT_URL || defaults.consent,
  }
}

/** OAuth redirect URI to enter in Revolut Business: the callback of this instance. */
export function getRevolutRedirectUri(): string {
  return `${getAppUrl()}/api/banking/revolut/callback`
}

/**
 * Refresh tokens expire after 90 days (PSD2 strong customer authentication):
 * the user then authorizes Kledg again in Revolut Business.
 */
export const REVOLUT_CONSENT_DAYS = 90

/** Revolut Business plans that include the Business API (Basic does not). */
export const REVOLUT_API_PLANS = ['Grow', 'Scale', 'Enterprise'] as const
