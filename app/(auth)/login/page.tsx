import { Suspense } from 'react'
import { LoginExtra } from '@/components/instance/slots'
import { safeRedirectPath } from '@/lib/safe-redirect'
import { LoginForm } from './login-form'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Connexion' }

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ redirect?: string | string[] }> }) {
  const { redirect } = await searchParams
  // Only same-origin paths, like the sign-in form (lib/safe-redirect.ts)
  const redirectTo = safeRedirectPath(typeof redirect === 'string' ? redirect : null)
  return (
    <Suspense fallback={null}>
      <LoginForm extra={<LoginExtra redirectTo={redirectTo} />} />
    </Suspense>
  )
}
