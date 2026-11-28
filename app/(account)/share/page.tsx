'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { FileText, Share2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Field, PageHeader } from '@/components/shared'
import { responseError } from '@/hooks/use-cursor-list'
import { prepareReceiptFile } from '@/components/features/receipts/prepare-receipt-file'
import { clearSharedFiles, readSharedFiles, type SharedFile } from '@/components/features/receipts/shared-files'

interface CompanyOption {
  id: string
  slug: string
  name: string
}

const sizeOf = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} Ko` : `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`)

/**
 * Files shared to Kledg from another app of the phone (docs/justificatifs-photo.md#partage-depuis-le-téléphone):
 * the service worker kept them on the device; the user picks the company,
 * they are dropped there as receipts (POST /api/receipts/staged), and the
 * Justificatifs page searches their transaction. Nothing is sent before the
 * user chooses.
 */
export default function SharePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [files, setFiles] = React.useState<SharedFile[] | null>(null)
  const [companies, setCompanies] = React.useState<CompanyOption[] | null>(null)
  const [companyId, setCompanyId] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [errors, setErrors] = React.useState<string[]>([])
  const skipped = Number(searchParams.get('skipped') ?? 0)
  const failed = searchParams.get('error') !== null

  React.useEffect(() => {
    readSharedFiles()
      .then(setFiles)
      .catch(() => setFiles([]))
    fetch('/api/companies', { cache: 'no-store' })
      .then((response) => (response.ok ? (response.json() as Promise<CompanyOption[]>) : []))
      .then((list) => {
        const options = list.map(({ id, slug, name }) => ({ id, slug, name }))
        setCompanies(options)
        if (options.length === 1) setCompanyId(options[0].id)
      })
      .catch(() => setCompanies([]))
  }, [])

  async function send() {
    const company = companies?.find((c) => c.id === companyId)
    if (!company || !files?.length) return
    setBusy(true)
    const problems: string[] = []
    for (const { file } of files) {
      try {
        const form = new FormData()
        form.set('companyId', company.id)
        form.set('file', await prepareReceiptFile(file))
        const response = await fetch('/api/receipts/staged', { method: 'POST', body: form })
        if (!response.ok) throw new Error(await responseError(response, 'le fichier n’a pas pu être déposé'))
      } catch (error) {
        problems.push(`${file.name} : ${(error as Error).message}`)
      }
    }
    await clearSharedFiles().catch(() => undefined)
    setBusy(false)
    if (problems.length === 0) {
      router.push(`/${encodeURIComponent(company.slug)}/banking/missing-receipts`)
      return
    }
    setErrors(problems)
    setFiles([])
  }

  async function setAside() {
    await clearSharedFiles().catch(() => undefined)
    setFiles([])
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <PageHeader title="Justificatifs partagés" description="Les fichiers partagés depuis une autre application, à déposer dans une société." />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Share2 className="size-4" aria-hidden />
            {files === null ? 'Lecture des fichiers…' : files.length > 0 ? `${files.length} fichier${files.length > 1 ? 's' : ''} à déposer` : 'Aucun fichier à déposer'}
          </CardTitle>
          <CardDescription>
            Ils restent sur cet appareil tant que vous ne les déposez pas. Kledg cherche ensuite leur transaction sur la page Justificatifs&nbsp;: le rattachement reste votre clic.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {failed ? (
            <p className="text-destructive text-sm" role="alert">
              Le partage n’a pas pu être reçu. Partagez de nouveau le fichier.
            </p>
          ) : null}
          {skipped > 0 ? (
            <p className="text-muted-foreground text-sm" role="note">
              {skipped} fichier{skipped > 1 ? 's' : ''} laissé{skipped > 1 ? 's' : ''} de côté&nbsp;: 10 fichiers au plus par partage, de 25&nbsp;Mo chacun au plus.
            </p>
          ) : null}
          {files && files.length > 0 ? (
            <>
              <ul className="divide-y rounded-md border" aria-label="Fichiers partagés">
                {files.map(({ key, file }) => (
                  <li key={key} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <FileText className="text-muted-foreground size-4 shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{file.name}</span>
                    <span className="text-muted-foreground shrink-0 text-xs">{sizeOf(file.size)}</span>
                  </li>
                ))}
              </ul>
              {companies && companies.length === 0 ? (
                <p className="text-muted-foreground text-sm">Vous n’êtes membre d’aucune société.</p>
              ) : (
                <Field label="Société" htmlFor="share-company">
                  <Select value={companyId} onValueChange={setCompanyId} disabled={!companies}>
                    <SelectTrigger id="share-company">
                      <SelectValue placeholder="Choisissez la société" />
                    </SelectTrigger>
                    <SelectContent>
                      {(companies ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void send()} loading={busy} disabled={!companyId}>
                  Déposer dans les justificatifs
                </Button>
                <Button variant="ghost" onClick={() => void setAside()} disabled={busy}>
                  Ne pas déposer
                </Button>
              </div>
            </>
          ) : null}
          {errors.length > 0 ? (
            <div className="space-y-1" role="alert">
              <p className="text-destructive text-sm">Certains fichiers n’ont pas été déposés&nbsp;:</p>
              <ul className="text-destructive list-disc pl-5 text-sm">
                {errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {files && files.length === 0 && errors.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Sur un téléphone où Kledg est installé, partagez une photo de ticket ou un PDF de facture et choisissez Kledg. Vous pouvez aussi déposer vos fichiers sur la page Justificatifs d’une société.{' '}
              <Link href="/companies" className="underline underline-offset-4">
                Vos sociétés
              </Link>
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
