'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { FileInput } from '@/components/ui/file-input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { DatePicker } from '@/components/ui/date-picker'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { ConfirmDeleteDialog, ConfirmDialog, EmptyState } from '@/components/shared'
import { docsUrl } from '@/lib/docs-links'
import Link from 'next/link'
import { Trash2, Building2, Pencil, Plus, Archive, ArchiveRestore } from 'lucide-react'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'
import type { Address } from '@/lib/utils/address'
import { LEGAL_FORMS, LEGAL_TYPES, companyInitials, isLegalType, type LegalType } from '@/lib/companies/legal-forms'
import { calendarDayOf, isoDateToLocal, localDateToIso } from '@/lib/utils/date'
import { CompanyNameWithForm } from './legal-form-tag'

const companySchema = z.object({
  name: z.string().min(1, 'Le nom est requis'),
  siren: z.string().min(9, 'Le SIREN doit contenir 9 chiffres').max(9, 'Le SIREN doit contenir 9 chiffres').regex(/^\d{9}$/, 'Le SIREN doit contenir exactement 9 chiffres'),
  // Note: Company addresses are managed through establishments only
  phone: z.string().optional(),
  email: z.string().email('Email invalide').optional().or(z.literal('')),
  logo: z.string().optional(),
  foundationDate: z.string().optional(),
  closingDay: z.number().min(1).max(31).optional(),
  closingMonth: z.number().min(1).max(12).optional(),
  vatRegime: z.string().optional(),
  isVatExempt: z.boolean().optional(),
  vatExemptReason: z.string().optional(),
  corporateTaxRegime: z.string().optional(),
  legalType: z.enum(LEGAL_TYPES).optional(),
})

type CompanyFormData = z.infer<typeof companySchema>

interface Company {
  id: string
  name: string
  slug?: string | null
  siren?: string | null
  address?: Address | null
  phone?: string | null
  email?: string | null
  logo?: string | null
  foundationDate?: Date | string | null
  closingDay?: number | null
  closingMonth?: number | null
  vatRegime?: string | null
  isVatExempt?: boolean | null
  vatExemptReason?: string | null
  corporateTaxRegime?: string | null
  legalType?: LegalType | null
}

interface CompaniesListProps {
  companies: Company[]
  /** When false, only the "Créer une société" button is shown (no cards grid). */
  showList?: boolean
  /** Instance administrators create companies (with the wizard, /companies/new). */
  canCreate?: boolean
  /** Instance administrators archive, restore and delete companies. */
  canManage?: boolean
  /** Archived companies (instance administrators only), to restore them. */
  archived?: Array<{ id: string; name: string; siren?: string | null; archivedAt?: Date | string | null }>
}

const months = [
  { value: 1, label: 'Janvier' },
  { value: 2, label: 'Février' },
  { value: 3, label: 'Mars' },
  { value: 4, label: 'Avril' },
  { value: 5, label: 'Mai' },
  { value: 6, label: 'Juin' },
  { value: 7, label: 'Juillet' },
  { value: 8, label: 'Août' },
  { value: 9, label: 'Septembre' },
  { value: 10, label: 'Octobre' },
  { value: 11, label: 'Novembre' },
  { value: 12, label: 'Décembre' },
]

export function CompaniesList({
  companies: initialCompanies,
  showList = true,
  canCreate = false,
  canManage = false,
  archived = [],
}: CompaniesListProps) {
  const router = useRouter()
  const [companies, setCompanies] = useState(initialCompanies)
  const [editOpen, setEditOpen] = useState(false)
  const [editingCompany, setEditingCompany] = useState<Company | null>(null)
  const [editLoading, setEditLoading] = useState(false)
  const [deletingCompanyId, setDeletingCompanyId] = useState<string | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false)
  const [isArchiving, setIsArchiving] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)

  const methodsEdit = useForm<CompanyFormData>({
    resolver: zodResolver(companySchema),
  })

  const {
    register: registerEdit,
    handleSubmit: handleSubmitEdit,
    formState: { errors: errorsEdit },
    reset: resetEdit,
    watch: watchEdit,
    setValue: setValueEdit,
  } = useForm<CompanyFormData>({
    resolver: zodResolver(companySchema),
  })

  const [editLogoPreview, setEditLogoPreview] = useState<string | null>(null)

  const handleLogoUpload = (event: React.ChangeEvent<HTMLInputElement>, isEdit: boolean = false) => {
    const file = event.target.files?.[0]
    if (!file) return

    // Vérifier le type de fichier
    if (!file.type.startsWith('image/')) {
      toast.error('Choisissez un fichier image (JPG, PNG ou GIF).')
      return
    }

    // Vérifier la taille (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      toast.error("L'image ne doit pas dépasser 2 Mo.")
      return
    }

    const reader = new FileReader()
    reader.onloadend = () => {
      const base64String = reader.result as string
      if (isEdit) {
        setEditLogoPreview(base64String)
        setValueEdit('logo', base64String)
      }
    }
    reader.readAsDataURL(file)
  }

  const openEditDialog = (company: Company) => {
    setEditingCompany(company)
    const closingDay = company.closingDay || 31
    const closingMonth = company.closingMonth || 12
    setEditLogoPreview(company.logo || null)
    resetEdit({
      name: company.name,
      siren: company.siren || '',
      // Note: Company addresses are managed through establishments only
      phone: company.phone || '',
      email: company.email || '',
      logo: company.logo || '',
      // The page passes dates through JSON (ISO timestamps): the form keeps the calendar day.
      foundationDate: calendarDayOf(company.foundationDate) ?? '',
      closingDay,
      closingMonth,
      vatRegime: company.vatRegime || '',
      isVatExempt: company.isVatExempt || false,
      vatExemptReason: company.vatExemptReason || '',
      corporateTaxRegime: company.corporateTaxRegime || '',
      legalType: company.legalType || undefined,
    })
    setValueEdit('closingMonth', closingMonth)
    setEditOpen(true)
  }

  const onSubmitEdit = async (data: CompanyFormData) => {
    if (!editingCompany) return

    setEditLoading(true)
    try {
      const response = await fetch(`/api/companies/${editingCompany.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      })

      if (response.ok) {
        const updatedCompany = await response.json()
        setCompanies(companies.map(c => c.id === updatedCompany.id ? updatedCompany : c))
        setEditOpen(false)
        setEditingCompany(null)
        setEditLogoPreview(null)
        toast.success('Modifications enregistrées')
        window.dispatchEvent(new Event('companies:refresh'))
        router.refresh()
      } else {
        const error = await response.json()
        toast.error(error.error || 'Les modifications n\'ont pas pu être enregistrées.')
      }
    } catch (error) {
      logger.error('Error updating company:', error)
      toast.error('Les modifications n\'ont pas pu être enregistrées. Vérifiez votre connexion et réessayez.')
    } finally {
      setEditLoading(false)
    }
  }

  /** Archives (POST) or restores (DELETE) a company: instance administrators only. */
  const setArchived = async (companyId: string, archive: boolean) => {
    const response = await fetch(`/api/companies/${companyId}/archive`, { method: archive ? 'POST' : 'DELETE' })
    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error((error as { error?: string }).error ?? "L'opération n'a pas abouti. Réessayez.")
    }
  }

  const handleArchiveCompany = async (companyId: string) => {
    setIsArchiving(true)
    try {
      await setArchived(companyId, true)
      setCompanies(companies.filter((c) => c.id !== companyId))
      toast.success('Société archivée', { description: 'Elle est en lecture seule et ne figure plus dans les listes.' })
      setArchiveDialogOpen(false)
      setEditOpen(false)
      setEditingCompany(null)
      window.dispatchEvent(new Event('companies:refresh'))
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "La société n'a pas pu être archivée.")
    } finally {
      setIsArchiving(false)
    }
  }

  const handleRestoreCompany = async (companyId: string) => {
    setRestoringId(companyId)
    try {
      await setArchived(companyId, false)
      toast.success('Société restaurée')
      window.dispatchEvent(new Event('companies:refresh'))
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "La société n'a pas pu être restaurée.")
    } finally {
      setRestoringId(null)
    }
  }

  const handleDeleteCompany = async (companyId: string) => {
    setIsDeleting(true)
    try {
      const response = await fetch(`/api/companies/${companyId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        setCompanies(companies.filter(c => c.id !== companyId))
        toast.success('Société supprimée')
        setDeleteDialogOpen(false)
        setDeletingCompanyId(null)
        setEditOpen(false)
        setEditingCompany(null)
        // Trigger event to reload company selector
        window.dispatchEvent(new Event('companies:refresh'))
        router.refresh()
      } else {
        const error = await response.json()
        toast.error(error.error || "La société n'a pas pu être supprimée.")
      }
    } catch (error) {
      logger.error('Error deleting company:', error)
      toast.error("La société n'a pas pu être supprimée. Vérifiez votre connexion et réessayez.")
    } finally {
      setIsDeleting(false)
      setDeletingCompanyId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {showList ? (
          <p className="text-muted-foreground text-sm">
            <span className="num">{companies.length}</span> société{companies.length > 1 ? 's' : ''}
          </p>
        ) : (
          <span />
        )}
        {canCreate ? (
          <Button asChild>
            <Link href="/companies/new">
              <Plus aria-hidden />
              Créer une société
            </Link>
          </Button>
        ) : null}
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Modifier la société</DialogTitle>
            <DialogDescription>
              Modifiez les informations de la société
            </DialogDescription>
          </DialogHeader>
          <FormProvider {...methodsEdit}>
            <form onSubmit={handleSubmitEdit(onSubmitEdit)}>
              <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-name">Nom *</Label>
                <Input
                  id="edit-name"
                  {...registerEdit('name')}
                  placeholder="Nom de la société"
                />
                {errorsEdit.name && (
                  <p className="text-sm text-destructive">{errorsEdit.name.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-siren">SIREN *</Label>
                <Input
                  id="edit-siren"
                  {...registerEdit('siren')}
                  placeholder="123456789"
                  maxLength={9}
                  inputMode="numeric"
                  autoComplete="off"
                  spellCheck={false}
                />
                {errorsEdit.siren && (
                  <p className="text-sm text-destructive">{errorsEdit.siren.message}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Le SIREN (9 chiffres) identifie la société. Les établissements (SIRET) sont gérés séparément.
                </p>
              </div>
              {/* Note: Company addresses are managed through establishments only */}
              <div className="space-y-2">
                <Label htmlFor="edit-phone">Téléphone</Label>
                <Input
                  id="edit-phone"
                  type="tel"
                  autoComplete="tel"
                  {...registerEdit('phone')}
                  placeholder="01 23 45 67 89"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-email">Email</Label>
                <Input
                  id="edit-email"
                  type="email"
                  autoComplete="email"
                  spellCheck={false}
                  {...registerEdit('email')}
                  placeholder="contact@société.fr"
                />
                {errorsEdit.email && (
                  <p className="text-sm text-destructive">{errorsEdit.email.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-logo">Logo</Label>
                <FileInput id="edit-logo" accept="image/*" onChange={(e) => handleLogoUpload(e, true)} />
                {editLogoPreview && (
                  <div className="mt-2">
                    <img
                      src={editLogoPreview}
                      alt="Logo preview"
                      className="h-20 w-20 object-contain rounded border"
                    />
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Format accepté&nbsp;: JPG, PNG, GIF (max 2MB)
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-foundationDate">Date de création de la société</Label>
                <DatePicker
                  id="edit-foundationDate"
                  date={isoDateToLocal(watchEdit('foundationDate') ?? '')}
                  onDateChange={(date) => setValueEdit('foundationDate', date ? localDateToIso(date) : '')}
                  placeholder="Sélectionner la date de création"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="edit-closingDay">Jour de clôture</Label>
                  <Input
                    id="edit-closingDay"
                    type="number"
                    {...registerEdit('closingDay', { valueAsNumber: true })}
                    placeholder="31"
                    min="1"
                    max="31"
                  />
                  {errorsEdit.closingDay && (
                    <p className="text-sm text-destructive">{errorsEdit.closingDay.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-closingMonth">Mois de clôture</Label>
                  <Select
                    value={watchEdit('closingMonth')?.toString() || ''}
                    onValueChange={(value) => setValueEdit('closingMonth', parseInt(value, 10))}
                  >
                    <SelectTrigger id="edit-closingMonth">
                      <SelectValue placeholder="Sélectionner un mois" />
                    </SelectTrigger>
                    <SelectContent>
                      {months.map((month) => (
                        <SelectItem key={month.value} value={month.value.toString()}>
                          {month.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errorsEdit.closingMonth && (
                    <p className="text-sm text-destructive">{errorsEdit.closingMonth.message}</p>
                  )}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="edit-vatRegime">Régime de TVA</Label>
                  <Select
                    value={watchEdit('vatRegime') || ''}
                    onValueChange={(value) => setValueEdit('vatRegime', value || undefined)}
                  >
                    <SelectTrigger id="edit-vatRegime">
                      <SelectValue placeholder="Sélectionner un régime" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="normal">Régime normal</SelectItem>
                      <SelectItem value="simplified">Régime simplifié</SelectItem>
                      <SelectItem value="mini_real">Régime mini-réel</SelectItem>
                      <SelectItem value="franchise">Franchise en base</SelectItem>
                      <SelectItem value="real">Régime réel</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="edit-isVatExempt"
                    checked={watchEdit('isVatExempt') || false}
                    onCheckedChange={(checked) => setValueEdit('isVatExempt', checked === true)}
                  />
                  <Label htmlFor="edit-isVatExempt" className="text-sm font-normal cursor-pointer">
                    Société exonérée de TVA (ex&nbsp;: organisme de formation)
                  </Label>
                </div>
                {watchEdit('isVatExempt') && (
                  <div className="ml-6 space-y-2">
                    <Label htmlFor="edit-vatExemptReason" className="text-sm">
                      Raison de l'exonération
                    </Label>
                    <Input
                      id="edit-vatExemptReason"
                      {...registerEdit('vatExemptReason')}
                      placeholder="Ex&nbsp;: Organisme de formation"
                    />
                    <p className="text-xs text-muted-foreground">
                      Si la société est exonérée de TVA, elle ne pourra pas récupérer la TVA déductible sur ses achats.
                    </p>
                  </div>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="edit-corporateTaxRegime">Régime d'IS</Label>
                  <Select
                    value={watchEdit('corporateTaxRegime') || ''}
                    onValueChange={(value) => setValueEdit('corporateTaxRegime', value || undefined)}
                  >
                    <SelectTrigger id="edit-corporateTaxRegime">
                      <SelectValue placeholder="Sélectionner un régime" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="normal">Régime normal</SelectItem>
                      <SelectItem value="simplified">Régime simplifié</SelectItem>
                      <SelectItem value="micro">Micro-société</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-legalType">Forme juridique</Label>
                <Select
                  value={watchEdit('legalType') || ''}
                  onValueChange={(value) => setValueEdit('legalType', isLegalType(value) ? value : undefined)}
                >
                  <SelectTrigger id="edit-legalType">
                    <SelectValue placeholder="Choisir une forme juridique" />
                  </SelectTrigger>
                  <SelectContent>
                    {LEGAL_FORMS.map((form) => (
                      <SelectItem key={form.value} value={form.value}>
                        {form.tag} ({form.name})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter className="gap-2 sm:justify-between">
              {canManage ? (
                <div className="flex flex-wrap gap-1">
                  <Button type="button" variant="ghost" onClick={() => setArchiveDialogOpen(true)}>
                    <Archive aria-hidden />
                    Archiver
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => {
                      if (editingCompany) {
                        setDeleteDialogOpen(true)
                        setDeletingCompanyId(editingCompany.id)
                      }
                    }}
                  >
                    <Trash2 aria-hidden />
                    Supprimer
                  </Button>
                </div>
              ) : (
                <span />
              )}
              <ConfirmDialog
                open={archiveDialogOpen}
                onOpenChange={setArchiveDialogOpen}
                title={`Archiver « ${editingCompany?.name ?? ''} » ?`}
                description="La société passe en lecture seule et disparaît des listes. Ses écritures, exercices et pièces sont conservés ; un administrateur de l'instance peut la restaurer à tout moment depuis cette page."
                confirmLabel="Archiver"
                tone="default"
                loading={isArchiving}
                onConfirm={() => {
                  if (editingCompany) handleArchiveCompany(editingCompany.id)
                }}
              />
              <ConfirmDeleteDialog
                open={deleteDialogOpen && deletingCompanyId === editingCompany?.id}
                onOpenChange={(open) => {
                  if (!open) {
                    setDeleteDialogOpen(false)
                    setDeletingCompanyId(null)
                  } else {
                    setDeleteDialogOpen(true)
                    if (editingCompany) {
                      setDeletingCompanyId(editingCompany.id)
                    }
                  }
                }}
                title={`Supprimer « ${editingCompany?.name ?? ''} » ?`}
                description="Seule une société sans écriture validée ni exercice clôturé peut être supprimée : ses données (comptes, brouillons, relevés, pièces) seront effacées définitivement. Une société qui a des écritures validées doit conserver ses livres 10 ans : archivez-la plutôt."
                confirmLabel="Supprimer définitivement"
                loading={isDeleting}
                onConfirm={() => {
                  if (editingCompany) {
                    handleDeleteCompany(editingCompany.id)
                  }
                }}
              />
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                  Annuler
                </Button>
                <Button type="submit" loading={editLoading}>
                  Enregistrer
                </Button>
              </div>
            </DialogFooter>
          </form>
          </FormProvider>
        </DialogContent>
      </Dialog>

      {showList && (
        companies.length === 0 ? (
          <EmptyState
            bordered
            icon={Building2}
            title="Aucune société"
            description={
              canCreate
                ? "Créez votre première société\u00a0: son SIREN suffit pour retrouver son identité, puis Kledg prépare l'exercice, le plan comptable et les journaux."
                : "Aucune société ne vous est encore ouverte. Demandez à l'administrateur de l'instance de vous y donner accès."
            }
            action={
              canCreate ? (
                <Button asChild size="sm">
                  <Link href="/companies/new">Créer ma première société</Link>
                </Button>
              ) : null
            }
            docsHref={docsUrl('firstSteps')}
            docsLabel="Premiers pas"
          />
        ) : (
          <ul className="bg-card divide-y rounded-lg border">
            {companies.map((company) => {
              const href = `/${company.slug ?? company.id}`
              return (
                <li key={company.id} className="hover:bg-muted/40 relative flex items-center gap-3 px-4 py-3 transition-colors">
                  {company.logo ? (
                    <img
                      src={company.logo}
                      alt=""
                      className="bg-background size-9 shrink-0 rounded-md border object-contain"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none'
                      }}
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="bg-foreground text-background flex size-9 shrink-0 items-center justify-center rounded-md text-xs font-semibold"
                    >
                      {companyInitials(company.name, company.legalType)}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    {/* The whole row opens the company (a large target on phones); the actions sit above it. */}
                    <Link
                      href={href}
                      className="flex min-w-0 font-medium underline-offset-4 after:absolute after:inset-0 after:content-[''] hover:underline"
                    >
                      <CompanyNameWithForm name={company.name} legalType={company.legalType} />
                    </Link>
                    <p className="text-muted-foreground line-clamp-2 text-xs sm:truncate">
                      {[
                        company.siren ? `SIREN ${company.siren.replace(/(\d{3})(?=\d)/g, '$1 ')}` : null,
                        company.closingDay && company.closingMonth
                          ? `clôture au ${company.closingDay} ${months[company.closingMonth - 1]?.label.toLowerCase()}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <div className="relative flex shrink-0 items-center gap-1">
                    <Button variant="outline" size="sm" asChild className="max-sm:hidden">
                      <Link href={`${href}/informations`}>Informations</Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => openEditDialog(company)}
                      aria-label={`Modifier ${company.name}`}
                      title="Modifier"
                    >
                      <Pencil aria-hidden />
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )
      )}

      {showList && canManage && archived.length > 0 ? (
        <section aria-labelledby="archived-companies" className="space-y-2 pt-4">
          <h2 id="archived-companies" className="text-sm font-medium">
            Sociétés archivées
          </h2>
          <p className="text-muted-foreground text-xs">
            En lecture seule, masquées des listes. Leurs livres sont conservés ; restaurez une société pour la modifier
            de nouveau.
          </p>
          <ul className="bg-card divide-y rounded-lg border">
            {archived.map((company) => (
              <li key={company.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{company.name}</p>
                  {company.siren ? (
                    <p className="text-muted-foreground text-xs">SIREN {company.siren.replace(/(\d{3})(?=\d)/g, '$1 ')}</p>
                  ) : null}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  loading={restoringId === company.id}
                  onClick={() => handleRestoreCompany(company.id)}
                >
                  <ArchiveRestore aria-hidden />
                  Restaurer
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
