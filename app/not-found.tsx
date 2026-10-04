import Link from 'next/link'

import { AuthShell } from '@/components/brand/auth-shell'
import { Button } from '@/components/ui/button'
import { DOCS_URL } from '@/lib/config'

export const metadata = { title: 'Page introuvable' }

export default function NotFound() {
  return (
    <AuthShell>
      <div className="bg-card space-y-4 rounded-lg border p-6">
        <div className="space-y-1.5">
          <p className="text-muted-foreground num text-sm">Erreur 404</p>
          <h1 className="text-xl font-semibold tracking-tight">Cette page n&apos;existe pas</h1>
          <p className="text-muted-foreground text-sm">
            Le lien est peut-être ancien, ou la société a changé d&apos;identifiant dans son adresse.
            Repartez de la liste de vos sociétés.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/companies">Voir mes sociétés</Link>
          </Button>
          <Button variant="outline" asChild>
            <a href={DOCS_URL} target="_blank" rel="noreferrer">
              Documentation
            </a>
          </Button>
        </div>
      </div>
    </AuthShell>
  )
}
