/**
 * Public links and facts about the bank providers, shown in the setup
 * guides (pure: usable in client components).
 */

/** Ponto dashboard: account creation, bank links, custom integrations, consent renewal. */
export const PONTO_DASHBOARD_URL = 'https://dashboard.myponto.com/'
/** Ponto pricing for companies paying Ponto directly (14 day trial). */
export const PONTO_PRICING_URL = 'https://myponto.com/en/pricing/customer-paying-model/'
export const PONTO_CUSTOM_INTEGRATION_DOCS_URL = 'https://documentation.myponto.com/custom-integrations'

/** Revolut Business settings (then APIs, Business API: certificate upload, redirect URI). */
export const REVOLUT_API_SETTINGS_URL = 'https://business.revolut.com/settings'
export const REVOLUT_API_GUIDE_URL =
  'https://developer.revolut.com/docs/guides/manage-accounts/get-started/make-your-first-api-request'
/** Plans that include the Business API (help.revolut.com, "Using Revolut Business API"). */
export const REVOLUT_API_PLANS_URL =
  'https://help.revolut.com/en-US/business/help/integrating-with-external-apps/revolut-business-api/question-using-revolut-business-api/'

/** Qonto API key (Settings > Integrations > API key). */
export const QONTO_API_KEY_HELP_URL = 'https://docs.qonto.com/get-started/business-api/authentication/api-key'

/** Shown on the connection setup pages only. */
export const BANK_TRADEMARKS_NOTICE =
  "Qonto et Revolut sont des marques de leurs titulaires respectifs. Kledg n'est affilié à aucune de ces sociétés."

/** How each way of reaching a bank is named in the UI and in messages. */
export const BANK_PROVIDER_LABELS: Record<string, string> = {
  QONTO: 'Qonto',
  REVOLUT: 'Revolut Business',
  PONTO: 'Ponto',
  MANUAL: 'Compte manuel',
}
