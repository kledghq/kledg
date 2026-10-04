/** Query parameter of the dashboard that shows the "Démarrer" checklist again (help menu). */
export const GUIDE_PARAM = 'guide'

/** Dashboard URL that shows the "Démarrer" checklist of a company again. */
export function guideHref(companyRef: string): string {
  return `/${companyRef}?${GUIDE_PARAM}=1`
}
