'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Download, Trash2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/shared'

interface ListedPerson {
  id: string
  firstName: string
  name: string
}

interface PersonsPrivacyCardProps {
  companyId: string
  /** Settings update right: erasing needs it, exporting only reads. */
  canEdit: boolean
}

/**
 * Rights of the natural persons the company records (RGPD art. 15, 17 and
 * 20): export of every data held on a person, and erasure within what the
 * law obliges the company to keep (GET and DELETE
 * /api/companies/[id]/persons/[personId]). Lives inside the Informations
 * form: every button is type="button".
 */
export function PersonsPrivacyCard({ companyId, canEdit }: PersonsPrivacyCardProps) {
  const [persons, setPersons] = useState<ListedPerson[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toErase, setToErase] = useState<ListedPerson | null>(null)
  const [busy, setBusy] = useState(false)

  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    const failed = 'Les personnes n’ont pas pu être chargées. Réessayez.'
    fetch(`/api/companies/${companyId}/persons`)
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as ListedPerson[] | { error?: string } | null
        if (!response.ok || !Array.isArray(data)) throw new Error((data && !Array.isArray(data) && data.error) || failed)
        return data
      })
      .then(
        (list) => {
          if (!cancelled) setPersons(list)
        },
        (e: unknown) => {
          if (!cancelled) setError(e instanceof Error && e.message !== 'Failed to fetch' ? e.message : failed)
        },
      )
    return () => {
      cancelled = true
    }
  }, [companyId, attempt])

  const reload = () => {
    setError(null)
    setAttempt((n) => n + 1)
  }

  const exportPerson = async (person: ListedPerson) => {
    const response = await fetch(`/api/companies/${companyId}/persons/${person.id}`)
    const data = await response.json()
    if (!response.ok) {
      toast.error(data.error || 'L’export a échoué. Réessayez.')
      return
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `donnees-${person.firstName}-${person.name}.json`.toLowerCase().replace(/\s+/g, '-')
    link.click()
    URL.revokeObjectURL(url)
  }

  const erase = async () => {
    if (!toErase) return
    setBusy(true)
    try {
      const response = await fetch(`/api/companies/${companyId}/persons/${toErase.id}`, { method: 'DELETE' })
      const data = await response.json()
      if (!response.ok) {
        toast.error(data.error || 'L’effacement a échoué. Réessayez.')
        return
      }
      toast.success(`Données de ${toErase.firstName} ${toErase.name} effacées`)
      setToErase(null)
      reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Données personnelles</CardTitle>
        <CardDescription>
          Les personnes physiques enregistrées pour la société (associés, dirigeants, bénéficiaires de notes de frais).
          Exportez toutes les données qu’une personne vous demande, ou effacez-la quand rien ne vous oblige à les garder.
          Les écritures comptables et leurs pièces sont conservées 10 ans (Code de commerce, art. L123-22)&nbsp;: elles
          ne sont pas effacées.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-destructive">{error}</span>
            <Button type="button" variant="outline" size="sm" onClick={reload}>
              Réessayer
            </Button>
          </div>
        ) : persons === null ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : persons.length === 0 ? (
          <p className="text-muted-foreground text-sm">Aucune personne physique enregistrée.</p>
        ) : (
          <ul className="divide-y">
            {persons.map((person) => (
              <li key={person.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-sm">
                  {person.firstName} {person.name}
                </span>
                <span className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => void exportPerson(person)}>
                    <Download aria-hidden />
                    Exporter ses données
                  </Button>
                  <Button type="button" variant="outline" size="sm" disabled={!canEdit} onClick={() => setToErase(person)}>
                    <Trash2 aria-hidden />
                    Effacer
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <ConfirmDialog
        open={toErase !== null}
        onOpenChange={(open) => !open && setToErase(null)}
        title={toErase ? `Effacer ${toErase.firstName} ${toErase.name} ?` : 'Effacer la personne ?'}
        description="Sa fiche, ses coordonnées, sa photo, ses données de naissance et son adresse sont effacées. Le nom porté par les écritures et les notes de frais est conservé avec la comptabilité. Un associé ne peut être effacé qu’une fois sa participation retirée."
        confirmLabel="Effacer"
        loading={busy}
        onConfirm={erase}
      />
    </Card>
  )
}
