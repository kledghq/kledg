/**
 * `@/lib/utils` is the Tailwind class helper every component imports. Other
 * helpers are imported from their own module (`@/lib/utils/money`,
 * `@/lib/utils/date`, `@/lib/utils/address`...), so a client component
 * never pulls in more than it uses.
 */
export { cn } from './cn'
