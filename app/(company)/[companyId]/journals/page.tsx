'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'

import { NoCompanySelected } from '@/components/features/companies/no-company-selected'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableEmpty,
} from '@/components/ui/table'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ConfirmDeleteDialog, Field, PageHeader } from '@/components/shared'
import { Plus, Pencil, PlusCircle, Trash2 } from 'lucide-react'
import { docsUrl } from '@/lib/docs-links'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'
import { normalizeJournalCode } from '@/lib/shared/helpers'

interface Journal {
  id: string
  code: string
  label: string
  companyId: string
}

const journalFormSchema = z.object({
  code: z
    .string()
    .min(1, 'Le code est requis')
    .max(3, '2 à 3 caractères')
    .transform((v) => normalizeJournalCode(v))
    .refine((v) => /^[A-Z0-9]{2,3}$/.test(v), 'Le code doit contenir 2 à 3 caractères (ex: BQ, AC, BQ2)'),
  label: z.string().min(1, 'Le libellé est requis').max(255),
})

type JournalFormData = z.infer<typeof journalFormSchema>

export default function JournalsPage() {
  const params = useParams()
  const companyId = params?.companyId as string
  const [journals, setJournals] = useState<Journal[]>([])
  const [loading, setLoading] = useState(true)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [createSubmitting, setCreateSubmitting] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [editingJournal, setEditingJournal] = useState<Journal | null>(null)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [addingDefaults, setAddingDefaults] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [journalToDelete, setJournalToDelete] = useState<Journal | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const loadJournals = useCallback(async () => {
    if (!companyId) {
      setLoading(false)
      return
    }
    try {
      const response = await fetch(`/api/journals?companyId=${companyId}`)
      if (response.ok) {
        const data = await response.json()
        setJournals(Array.isArray(data) ? data : [])
      }
    } catch (err) {
      logger.error('Error loading journals:', err)
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    loadJournals()
  }, [loadJournals])

  const createForm = useForm<JournalFormData>({
    resolver: zodResolver(journalFormSchema),
    defaultValues: { code: '', label: '' },
  })

  const editForm = useForm<JournalFormData>({
    resolver: zodResolver(journalFormSchema),
  })

  useEffect(() => {
    if (editingJournal) {
      editForm.reset({
        code: editingJournal.code,
        label: editingJournal.label,
      })
    }
  }, [editingJournal, editForm])

  const onCreateSubmit = async (data: JournalFormData) => {
    if (!companyId) return
    setCreateSubmitting(true)
    setCreateError(null)
    try {
      const response = await fetch('/api/journals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          code: data.code,
          label: data.label,
        }),
      })
      if (response.ok) {
        setCreateDialogOpen(false)
        createForm.reset({ code: '', label: '' })
        await loadJournals()
        toast.success('Journal créé avec succès')
      } else {
        const err = await response.json()
        setCreateError(err.error || 'Erreur lors de la création')
      }
    } catch (err) {
      logger.error('Error creating journal:', err)
      setCreateError('Erreur lors de la création')
    } finally {
      setCreateSubmitting(false)
    }
  }

  const onEditSubmit = async (data: JournalFormData) => {
    if (!editingJournal) return
    setEditSubmitting(true)
    setEditError(null)
    try {
      const response = await fetch(`/api/journals/${editingJournal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: data.code, label: data.label }),
      })
      if (response.ok) {
        setEditDialogOpen(false)
        setEditingJournal(null)
        await loadJournals()
        toast.success('Journal modifié avec succès')
      } else {
        const err = await response.json()
        setEditError(err.error || 'Erreur lors de la modification')
      }
    } catch (err) {
      logger.error('Error updating journal:', err)
      setEditError('Erreur lors de la modification')
    } finally {
      setEditSubmitting(false)
    }
  }

  const openEdit = (journal: Journal) => {
    setEditingJournal(journal)
    setEditError(null)
    setEditDialogOpen(true)
  }

  const handleDeleteJournal = async () => {
    if (!journalToDelete) return
    setIsDeleting(true)
    try {
      const response = await fetch(`/api/journals/${journalToDelete.id}`, {
        method: 'DELETE',
      })
      if (response.ok) {
        setDeleteDialogOpen(false)
        setJournalToDelete(null)
        await loadJournals()
        toast.success('Journal supprimé')
      } else {
        const data = await response.json()
        toast.error(data.error || 'Erreur lors de la suppression')
      }
    } catch (err) {
      logger.error('Error deleting journal:', err)
      toast.error('Erreur lors de la suppression')
    } finally {
      setIsDeleting(false)
    }
  }

  const openDeleteDialog = (journal: Journal) => {
    setJournalToDelete(journal)
    setDeleteDialogOpen(true)
  }

  const handleAddDefaultJournals = async () => {
    if (!companyId) return
    setAddingDefaults(true)
    try {
      const response = await fetch(`/api/journals?companyId=${companyId}`)
      if (response.ok) {
        const data = await response.json()
        setJournals(Array.isArray(data) ? data : [])
        toast.success('Journaux par défaut ajoutés (AC, VT, BQ, CA, OD)')
      } else {
        toast.error('Erreur lors de l\'ajout des journaux par défaut')
      }
    } catch (err) {
      logger.error('Error adding default journals:', err)
      toast.error('Erreur lors de l\'ajout des journaux par défaut')
    } finally {
      setAddingDefaults(false)
    }
  }

  if (!companyId) {
    return (
      <NoCompanySelected description="Veuillez sélectionner une société pour gérer les journaux" />
    )
  }

  if (loading) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Chargement des journaux">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-full max-w-md" />
        </div>
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Journaux"
        description="Chaque écriture est classée dans un journal selon sa nature&nbsp;: achats (AC), ventes (VT), banque (BQ), caisse (CA), opérations diverses (OD)."
        docsHref={docsUrl('journals')}
        actions={
          <>
            <Button
              variant="outline"
              onClick={handleAddDefaultJournals}
              loading={addingDefaults}
            >
              <PlusCircle aria-hidden />
              Ajouter les journaux par défaut
            </Button>
            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <DialogTrigger asChild>
                  <Button>
                    <Plus aria-hidden />
                    Ajouter un journal
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Ajouter un journal</DialogTitle>
                    <DialogDescription>
                      Créez un nouveau journal. Le code doit contenir 2 à 3 caractères (ex&nbsp;: BQ, AC, BQ2).
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={createForm.handleSubmit(onCreateSubmit)}>
                    <div className="space-y-4 py-4">
                      {createError && (
                        <Alert variant="destructive">
                          <AlertDescription>{createError}</AlertDescription>
                        </Alert>
                      )}
                      <Field
                        label="Code"
                        htmlFor="create-code"
                        required
                        error={createForm.formState.errors.code?.message}
                      >
                        <Input
                          id="create-code"
                          placeholder="ex&nbsp;: BQ"
                          maxLength={3}
                          {...createForm.register('code')}
                          className="uppercase"
                        />
                      </Field>
                      <Field
                        label="Libellé"
                        htmlFor="create-label"
                        required
                        error={createForm.formState.errors.label?.message}
                      >
                        <Input
                          id="create-label"
                          placeholder="ex&nbsp;: Banque"
                          {...createForm.register('label')}
                        />
                      </Field>
                    </div>
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setCreateDialogOpen(false)}
                      >
                        Annuler
                      </Button>
                      <Button type="submit" loading={createSubmitting}>
                        Créer le journal
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
          </>
        }
      />

      <div className="bg-card overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Code</TableHead>
                <TableHead>Libellé</TableHead>
                <TableHead className="w-24 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {journals.length === 0 ? (
                <TableEmpty colSpan={3}>
                  Aucun journal. Ajoutez les journaux par défaut (AC, VT, BQ, CA, OD) pour commencer.
                </TableEmpty>
              ) : (
                journals.map((journal) => (
                  <TableRow key={journal.id}>
                    <TableCell className="font-mono text-xs font-medium">{journal.code}</TableCell>
                    <TableCell>{journal.label}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => openEdit(journal)}
                          aria-label={`Modifier le journal ${journal.code}`}
                          title="Modifier"
                        >
                          <Pencil aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => openDeleteDialog(journal)}
                          aria-label={`Supprimer le journal ${journal.code}`}
                          title="Supprimer"
                          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
      </div>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifier le journal</DialogTitle>
            <DialogDescription>
              Modifiez le code et le libellé du journal. Le code doit contenir 2 à 3 caractères.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={editForm.handleSubmit(onEditSubmit)}>
            <div className="space-y-4 py-4">
              {editError && (
                <Alert variant="destructive">
                  <AlertDescription>{editError}</AlertDescription>
                </Alert>
              )}
              <Field
                label="Code"
                htmlFor="edit-code"
                required
                error={editForm.formState.errors.code?.message}
              >
                <Input
                  id="edit-code"
                  placeholder="ex&nbsp;: BQ"
                  maxLength={3}
                  {...editForm.register('code')}
                  className="uppercase"
                />
              </Field>
              <Field
                label="Libellé"
                htmlFor="edit-label"
                required
                error={editForm.formState.errors.label?.message}
              >
                <Input
                  id="edit-label"
                  placeholder="ex&nbsp;: Banque"
                  {...editForm.register('label')}
                />
              </Field>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditDialogOpen(false)}
              >
                Annuler
              </Button>
              <Button type="submit" loading={editSubmitting}>
                Enregistrer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={`Supprimer le journal ${journalToDelete?.code ?? ''} ?`}
        description={
          journalToDelete && (
            <>
              Le journal <strong>{journalToDelete.label}</strong> sera supprimé. Seul un journal sans
              écriture peut être supprimé.
            </>
          )
        }
        loading={isDeleting}
        onConfirm={() => handleDeleteJournal()}
      />
    </div>
  )
}
