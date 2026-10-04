/**
 * Cache headers utilities for API routes
 * 
 * Provides consistent cache control headers to prevent browser caching
 * of dynamic financial data and reports.
 */

/**
 * Headers to disable browser caching for dynamic financial data
 * Use for reports, KPIs, and any data that changes frequently
 */
export const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
} as const
