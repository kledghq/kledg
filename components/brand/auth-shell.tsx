import Link from 'next/link'
import { Logo } from '@/components/brand/logo'

/**
 * Frame of the pages shown before or outside the app (login, setup, password,
 * OAuth consent): the logo and one narrow column of cards on a subtle surface.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    // Safe areas (viewport-fit=cover): the column clears the notch in landscape and the home indicator.
    <div className="bg-surface flex min-h-svh flex-col items-center justify-center gap-6 pt-[max(2.5rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(2.5rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] md:pr-[max(2.5rem,env(safe-area-inset-right))] md:pl-[max(2.5rem,env(safe-area-inset-left))]">
      <main className="flex w-full max-w-sm flex-col gap-6">
        <Link href="/" data-touch-target className="self-center" aria-label="Kledg, accueil">
          <Logo />
        </Link>
        {children}
      </main>
    </div>
  )
}
