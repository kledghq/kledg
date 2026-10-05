/**
 * Label patterns shared by a template of the catalog and the vendors of
 * lib/receipts/vendors.ts, when a template recognises a vendor among
 * others. The template keeps exactly the same pattern string: installed
 * rules are compared to it (duplicates.ts). Pure module without imports.
 */

/** Uber rides (not Uber Eats): "UBER *TRIP HELP.UBER.COM", "UBER BV". */
export const UBER_RIDES_PATTERN = '\\buber\\W*(trip|bv|rides?)\\b'
