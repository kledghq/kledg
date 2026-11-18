'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { FileCode } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { FileInput } from '@/components/ui/file-input'
import { Field } from '@/components/shared'
import { responseError } from '@/hooks/use-cursor-list'

/** Answer of POST /api/invoices/import-e-invoice (lib/invoices/import-e-invoice.service.ts). */
interface EInvoiceImport {
  invoiceId: string
  number: string
  created: boolean
  supplierCreated: boolean
  supplier: { name: string }
  warnings: string[]
}

/**
 * Import of a received e-invoice (Factur-X PDF, CII or UBL XML) as a draft
 * purchase invoice; opens the invoice once recorded (or the one already
 * imported from the same file).
 */
export function EInvoiceImportDialog({ companyId, disabled }: { companyId: string; disabled?: boolean }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [file, setFile] = React.useState<File | null>(null)
  const [importing, setImporting] = React.useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!file) return
    setImporting(true)
    try {
      const form = new FormData()
      form.set('companyId', companyId)
      form.set('file', file)
      const response = await fetch('/api/invoices/import-e-invoice', { method: 'POST', body: form })
      if (!response.ok) throw new Error(await responseError(response, 'L’import de la facture électronique n’a pas abouti. Réessayez.'))
      const result = (await response.json()) as EInvoiceImport
      const description = result.warnings.length ? result.warnings.join(' ') : undefined
      if (result.created) {
        toast.success(`Facture n° ${result.number} de ${result.supplier.name} importée en brouillon${result.supplierCreated ? ', fournisseur créé' : ''}`, { description })
      } else {
        toast.info(`La facture n° ${result.number} de ${result.supplier.name} est déjà enregistrée`, { description })
      }
      setOpen(false)
      setFile(null)
      router.push(`/${companyId}/invoices/${result.invoiceId}`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setFile(null)
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          <FileCode aria-hidden />
          Importer une facture électronique
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Importer une facture électronique</DialogTitle>
            <DialogDescription>
              Le fichier reçu de votre plateforme agréée&nbsp;: PDF Factur-X, ou XML CII ou UBL. Kledg reprend ses lignes et sa TVA, retrouve ou crée le fournisseur et garde le
              fichier. La facture est enregistrée en brouillon&nbsp;: choisissez ensuite ses comptes et comptabilisez-la.
            </DialogDescription>
          </DialogHeader>
          <Field label="Fichier" htmlFor="e-invoice-file" required>
            <FileInput
              id="e-invoice-file"
              accept=".pdf,.xml,application/pdf,application/xml,text/xml"
              fileName={file?.name ?? null}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={!file} loading={importing}>
              Importer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
