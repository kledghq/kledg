/**
 * Path of the forecast page of a company (id or slug). Kept out of the
 * 'use client' cards so server components (the simple home) can call it:
 * a function exported by a client module is only a client reference there.
 */
export const forecastPath = (companyRef: string) => `/${companyRef}/prevision-tresorerie`
