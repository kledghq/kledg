'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { FileInput } from '@/components/ui/file-input'
import { Label } from '@/components/ui/label'
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
import { toast } from 'sonner'
import { Save } from 'lucide-react'
import { companySchema, type CompanyFormData } from '@/components/features/companies/company-informations-schemas'
import { ShareholdersManagement } from '@/components/features/companies/shareholders-management'
import { PersonsPrivacyCard } from '@/components/features/companies/persons-privacy-card'
import { EstablishmentsManagement } from '@/components/features/companies/establishments-management'
import { AccountCombobox } from '@/components/features/accounting/account-combobox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { TaxRegimeHistory } from '@/components/features/companies/tax-regime-history'
import { DeadlineSettingsCard } from '@/components/features/deadlines/deadline-settings-card'
import { NoCompanySelected } from '@/components/features/companies/no-company-selected'
import { HelpTip, PageHeader, formatAmount } from '@/components/shared'
import { AccessNotice, useCompanyAccess } from '@/components/features/companies/company-access'
import { plural } from '@/lib/utils/plural'
import { toCents } from '@/lib/utils/money'
import { logger } from '@/lib/logger'
import { Skeleton } from '@/components/ui/skeleton'
import { SECTOR_OPTIONS, type Sector } from '@/lib/companies/sectors'
import { LEGAL_FORMS, isLegalType } from '@/lib/companies/legal-forms'


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

export default function CompanyInformationsPage() {
  const router = useRouter()
  const params = useParams()
  const companyId = params?.companyId as string
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [allCompanies, setAllCompanies] = useState<Array<{ id: string; name: string }>>([])
  const [accounts, setAccounts] = useState<Array<{ id: string; code: string; label: string }>>([])
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [savedSlug, setSavedSlug] = useState<string | null>(null)
  const { can, denied } = useCompanyAccess()
  const canEdit = can({ settings: ['update'] })

  const methods = useForm<CompanyFormData>({
    resolver: zodResolver(companySchema),
  })

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    setValue: setFormValue,
    watch,
    reset,
  } = methods

  // Share capital = number of shares x nominal value, computed in cents
  const totalShares = watch('totalShares')
  const shareNominalValue = watch('shareNominalValue')
  const nominalCents = typeof shareNominalValue === 'number' && Number.isFinite(shareNominalValue) ? toCents(shareNominalValue) : null
  const shareCapitalCents =
    typeof totalShares === 'number' && Number.isInteger(totalShares) && totalShares > 0 && nominalCents !== null && nominalCents > 0
      ? totalShares * nominalCents
      : null

  // Values set from selects, date pickers and comboboxes count as user edits,
  // so the save bar appears for them too.
  const setValue: typeof setFormValue = (name, value, options) =>
    setFormValue(name, value, { shouldDirty: true, ...options })

  // Never lose input: warn before leaving the page with unsaved changes.
  useEffect(() => {
    if (!isDirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [isDirty])


  useEffect(() => {
    async function loadCompanies() {
      try {
        const response = await fetch('/api/companies')
        if (response.ok) {
          const companies = await response.json()
          setAllCompanies(companies.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })))
        }
      } catch (error) {
        logger.error('Error loading companies:', error)
      }
    }

    loadCompanies()
  }, [])

  useEffect(() => {
    async function loadCompany() {
      if (!companyId) {
        setInitialLoading(false)
        return
      }

      try {
        const response = await fetch(`/api/companies/${companyId}`)
        if (response.ok) {
          const companyData = await response.json()
          const closingDay = companyData.closingDay || 31
          const closingMonth = companyData.closingMonth || 12
          
          reset({
            name: companyData.name || '',
            slug: companyData.slug || '',
            siren: companyData.siren || '',
            phone: companyData.phone || '',
            email: companyData.email || '',
            logo: companyData.logo || '',
            foundationDate: companyData.foundationDate
              ? (typeof companyData.foundationDate === 'string'
                ? companyData.foundationDate.split('T')[0]
                : companyData.foundationDate.split('T')[0])
              : '',
            closingDay,
            closingMonth,
            vatRegime: companyData.vatRegime || '',
            isVatExempt: companyData.isVatExempt || false,
            vatExemptReason: companyData.vatExemptReason || '',
            corporateTaxRegime: companyData.corporateTaxRegime || '',
            legalType: companyData.legalType || undefined,
            totalShares: companyData.totalShares || undefined,
            shareNominalValue: companyData.shareNominalValue ? parseFloat(companyData.shareNominalValue.toString()) : undefined,
            sector: companyData.sector || undefined,
            isHolding: companyData.isHolding || false,
            defaultBankAccountCode: companyData.defaultBankAccountCode || undefined,
            // shareCapital est calculé automatiquement, pas besoin de le charger
          })
          setLogoPreview(companyData.logo || null)
          setSavedSlug(companyData.slug || null)
          setFormValue('closingMonth', closingMonth)
          
          // Charger les comptes pour la sélection du compte bancaire par défaut
          if (companyId) {
            try {
              const accountsResponse = await fetch(`/api/accounts?companyId=${companyId}`)
              if (accountsResponse.ok) {
                const accountsData = await accountsResponse.json()
                const accountsList = Array.isArray(accountsData) ? accountsData : (accountsData.accounts || [])
                setAccounts(accountsList)
              }
            } catch (error) {
              logger.error('Error loading accounts:', error)
            }
          }
          
        }
        
      } catch (error) {
        logger.error('Error loading company:', error)
        toast.error('Erreur lors du chargement des informations')
      } finally {
        setInitialLoading(false)
      }
    }

    loadCompany()
  }, [companyId, reset, setFormValue])



  const handleLogoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    // Vérifier le type de fichier
    if (!file.type.startsWith('image/')) {
      toast.error('Veuillez sélectionner un fichier image')
      return
    }

    // Vérifier la taille (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      toast.error('L\'image ne doit pas dépasser 2MB')
      return
    }

    const reader = new FileReader()
    reader.onloadend = () => {
      const base64String = reader.result as string
      setLogoPreview(base64String)
      setValue('logo', base64String, { shouldDirty: true })
    }
    reader.readAsDataURL(file)
  }

  const onSubmit = async (data: CompanyFormData) => {
    if (!companyId) {
      toast.error('Aucune société sélectionnée')
      return
    }

    // Calculer automatiquement le capital social si nombre de parts et valeur nominale sont fournis
    const calculatedShareCapital = data.totalShares && data.shareNominalValue
      ? data.totalShares * data.shareNominalValue
      : undefined

    setLoading(true)
    try {
      const response = await fetch(`/api/companies/${companyId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...data,
          shareCapital: calculatedShareCapital,
        }),
      })

      if (response.ok) {
        toast.success('Informations enregistrées')
        // The saved values become the new reference: the form is no longer dirty.
        reset(data)
        const updated = await response.json().catch(() => null)
        const newSlug: string | undefined = updated?.slug ?? data.slug
        // The company switcher keeps its own list (name, logo): reload it after every save.
        window.dispatchEvent(new Event('companies:refresh'))
        if (newSlug && newSlug !== savedSlug) {
          // The company URL changed: reopen this page under the new slug
          setSavedSlug(newSlug)
          router.replace(`/${newSlug}/informations`)
        } else {
          router.refresh()
        }
      } else {
        const error = await response.json()
        toast.error(error.error || 'Erreur lors de la mise à jour')
      }
    } catch (error) {
      logger.error('Error updating company:', error)
      toast.error('Erreur lors de la mise à jour des informations')
    } finally {
      setLoading(false)
    }
  }

  if (initialLoading) {
    return (
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-9 w-72" />
            <Skeleton className="h-5 w-96" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-10 w-48" />
            <Skeleton className="h-10 w-48" />
          </div>
        </div>

        {/* Skeleton pour la carte Informations générales */}
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-72" />
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-10 w-full" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-10 w-full" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-10 w-full" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-10 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-10 w-full" />
              </div>
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-10 w-full" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-full" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Skeleton pour la carte Capital social */}
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-36" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-10 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-10 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-10 w-full" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Skeleton pour la carte Paramètres comptables */}
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-80" />
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-10 w-full" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Skeleton pour la carte Actionnaires */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-4 w-72" />
              </div>
              <Skeleton className="h-10 w-44" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </CardContent>
        </Card>

        {/* Skeleton pour la carte Configuration bancaire */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-80" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-10 w-full" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-10 w-44" />
              <Skeleton className="h-10 w-32" />
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!companyId) {
    return (
      <NoCompanySelected 
        message="Aucune société sélectionnée"
        description="Veuillez sélectionner une société pour voir ses informations"
      />
    )
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Informations"
        description="Identité, capital, paramètres comptables et établissements de la société. Ces informations alimentent le bilan, la liasse et le FEC."
        actions={
          <Button
            type="submit"
            form="company-form"
            loading={loading}
            disabled={!isDirty || !canEdit}
            title={canEdit ? undefined : denied('modifier les informations de la société')}
          >
            <Save aria-hidden />
            Enregistrer
          </Button>
        }
      />

      {!canEdit ? (
        <AccessNotice>{denied('modifier les informations, les établissements ou les actionnaires de la société')}</AccessNotice>
      ) : null}

      <FormProvider {...methods}>
        <form id="company-form" onSubmit={handleSubmit(onSubmit)} className="space-y-8">
        {/* Read only for a role that cannot update settings: every field and button of the form is disabled */}
        <fieldset disabled={!canEdit} className="min-w-0 space-y-8">
        <Card>
          <CardHeader>
            <CardTitle>Informations générales</CardTitle>
            <CardDescription>
              Informations de base de la société
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name">Nom *</Label>
              <Input
                id="name"
                {...register('name')}
                placeholder="Nom de la société"
                autoComplete="organization"
              />
              {errors.name && (
                <p className="text-sm text-destructive">{errors.name.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="slug">Identifiant dans l&apos;adresse *</Label>
              <Input
                id="slug"
                {...register('slug')}
                placeholder="ma-societe"
                maxLength={60}
                autoComplete="off"
                spellCheck={false}
              />
              {errors.slug && (
                <p className="text-sm text-destructive">{errors.slug.message}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Utilisé dans les adresses des pages de la société (/{watch('slug') || 'ma-societe'}/...). Lettres minuscules sans accents, chiffres et tirets.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="siren">SIREN *</Label>
              <Input
                id="siren"
                {...register('siren')}
                placeholder="123456789"
                maxLength={9}
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
              />
              {errors.siren && (
                <p className="text-sm text-destructive">{errors.siren.message}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Le SIREN (9 chiffres) identifie la société. Les établissements (SIRET) sont gérés séparément.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="logo">Logo</Label>
              <FileInput id="logo" accept="image/*" onChange={handleLogoUpload} />
              {(logoPreview || watch('logo')) && (
                <div className="mt-2">
                  <img
                    src={logoPreview || watch('logo') || ''}
                    alt="Logo preview"
                    className="h-20 w-20 object-contain rounded border"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Format accepté&nbsp;: JPG, PNG, GIF (max 2MB)
              </p>
            </div>


            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="phone">Téléphone</Label>
                <Input
                  id="phone"
                  type="tel"
                  autoComplete="tel"
                  {...register('phone')}
                  placeholder="01 23 45 67 89"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  spellCheck={false}
                  {...register('email')}
                  placeholder="contact@société.fr"
                />
                {errors.email && (
                  <p className="text-sm text-destructive">{errors.email.message}</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="foundationDate">Date de création de la société</Label>
              <DatePicker
                id="foundationDate"
                date={
                  watch('foundationDate')
                    ? (() => {
                        const dateStr = watch('foundationDate')
                        if (!dateStr) return undefined
                        const date = new Date(dateStr + 'T00:00:00')
                        return isNaN(date.getTime()) ? undefined : date
                      })()
                    : undefined
                }
                onDateChange={(date) => {
                  if (date) {
                    const year = date.getFullYear()
                    const month = String(date.getMonth() + 1).padStart(2, '0')
                    const day = String(date.getDate()).padStart(2, '0')
                    setValue('foundationDate', `${year}-${month}-${day}`, { shouldDirty: true })
                  } else {
                    setValue('foundationDate', '', { shouldDirty: true })
                  }
                }}
                placeholder="Sélectionner la date de création"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="legalType">Forme juridique</Label>
                <Select
                  value={watch('legalType') || ''}
                  onValueChange={(value) => setValue('legalType', isLegalType(value) ? value : undefined, { shouldDirty: true })}
                >
                  <SelectTrigger id="legalType" className="w-full">
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

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="sector">Secteur d'activité</Label>
                  {/* A popover, not a hover card: it opens on tap too (phones). */}
                  <HelpTip term="Secteur d'activité">
                    Le secteur d&apos;activité est utilisé pour le calcul de valorisation avec des coefficients spécifiques
                    à chaque secteur. Ces coefficients déterminent les multiples de chiffre d&apos;affaires et
                    d&apos;EBITDA utilisés dans les calculs de valorisation.
                  </HelpTip>
                </div>
                <Select
                  value={watch('sector') || ''}
                  onValueChange={(value) =>
                    setValue('sector', (value as Sector) || undefined, { shouldDirty: true })
                  }
                >
                  <SelectTrigger id="sector" className="w-full">
                    <SelectValue placeholder="Sélectionner un secteur d'activité" />
                  </SelectTrigger>
                  <SelectContent>
                    {SECTOR_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="companyRole">Type de société</Label>
                <HelpTip term="Type de société">
                  <span className="block">
                    <strong className="text-foreground">Société opérationnelle&nbsp;:</strong> société avec une activité
                    opérationnelle. Si elle détient également des filiales, elle sera automatiquement détectée comme
                    holding hybride et valorisée uniquement sur son activité opérationnelle (CA et EBITDA).
                  </span>
                  <span className="mt-2 block">
                    <strong className="text-foreground">Holding pure&nbsp;:</strong> société sans activité
                    opérationnelle, uniquement des participations. Elle sera exclue du calcul de valorisation pour
                    éviter la double comptabilisation. Sa valeur sera uniquement basée sur ses participations dans les
                    filiales.
                  </span>
                </HelpTip>
              </div>
              <Select
                value={
                  watch('isHolding') === true 
                    ? 'holding' 
                    : watch('isHolding') === false || watch('isHolding') === undefined
                    ? 'operational' 
                    : ''
                }
                onValueChange={(value) => {
                  if (value === 'holding') {
                    setValue('isHolding', true, { shouldDirty: true })
                  } else {
                    setValue('isHolding', false, { shouldDirty: true })
                  }
                }}
              >
                <SelectTrigger id="companyRole" className="w-full">
                  <SelectValue placeholder="Sélectionner le type de société" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="operational">Société opérationnelle</SelectItem>
                  <SelectItem value="holding">Holding pure (sans activité opérationnelle)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Capital social</CardTitle>
            <CardDescription>
              Informations sur le capital social de la société
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="totalShares">Nombre total de parts</Label>
                <Input
                  id="totalShares"
                  type="number"
                  {...register('totalShares', { valueAsNumber: true })}
                  placeholder="1000"
                  min="1"
                />
                {errors.totalShares && (
                  <p className="text-sm text-destructive">{errors.totalShares.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="shareNominalValue">Valeur nominale d'une part (€)</Label>
                <Input
                  id="shareNominalValue"
                  type="number"
                  step="0.01"
                  {...register('shareNominalValue', { valueAsNumber: true })}
                  placeholder="10.00"
                  min="0.01"
                />
                {errors.shareNominalValue && (
                  <p className="text-sm text-destructive">{errors.shareNominalValue.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="shareCapital">Capital social total (€)</Label>
                <Input
                  id="shareCapital"
                  type="text"
                  value={shareCapitalCents !== null ? formatAmount(shareCapitalCents / 100) : ''}
                  readOnly
                  className="bg-muted cursor-not-allowed num"
                  placeholder="Calculé automatiquement"
                />
                <p className="text-xs text-muted-foreground">
                  {shareCapitalCents !== null
                    ? `Calculé automatiquement\u00a0: ${plural(totalShares!, 'part')} × ${formatAmount(shareNominalValue)} = ${formatAmount(shareCapitalCents / 100)}`
                    : 'Saisissez le nombre de parts et la valeur nominale pour calculer le capital social.'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Paramètres comptables</CardTitle>
            <CardDescription>
              Configuration des exercices comptables et régimes fiscaux
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="closingDay">Jour de clôture</Label>
                <Input
                  id="closingDay"
                  type="number"
                  {...register('closingDay', { valueAsNumber: true })}
                  placeholder="31"
                  min="1"
                  max="31"
                />
                {errors.closingDay && (
                  <p className="text-sm text-destructive">{errors.closingDay.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="closingMonth">Mois de clôture</Label>
                <Select
                  value={watch('closingMonth')?.toString() || ''}
                  onValueChange={(value) => setValue('closingMonth', parseInt(value, 10), { shouldDirty: true })}
                >
                  <SelectTrigger id="closingMonth">
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
                {errors.closingMonth && (
                  <p className="text-sm text-destructive">{errors.closingMonth.message}</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="defaultBankAccountCode">Compte bancaire par défaut</Label>
                <HelpTip term="Compte bancaire par défaut">
                  Ce compte est proposé par défaut pour les écritures créées lors du rapprochement bancaire. Il doit
                  être un compte de classe 5 (ex&nbsp;: 512000, 531000). Le compte sera résolu dynamiquement selon
                  l&apos;exercice actif.
                </HelpTip>
              </div>
              <AccountCombobox
                id="defaultBankAccountCode"
                accounts={accounts}
                value={(() => {
                  const code = watch('defaultBankAccountCode')
                  if (!code) return 'none'
                  // Find the account ID by code for display in AccountCombobox
                  const account = accounts.find(acc => acc.code === code)
                  return account?.id || 'none'
                })()}
                onValueChange={(value) => {
                  if (value === 'none') {
                    setValue('defaultBankAccountCode', undefined, { shouldDirty: true })
                  } else {
                    // Find the account code by ID
                    const account = accounts.find(acc => acc.id === value)
                    setValue('defaultBankAccountCode', account?.code || undefined, { shouldDirty: true })
                  }
                }}
                placeholder="Sélectionner un compte bancaire (classe 5)"
                showNoneOption
                noneOptionLabel="Aucun compte sélectionné"
                className="w-full"
                codePrefix="5"
              />
              {errors.defaultBankAccountCode && (
                <p className="text-sm text-destructive">{errors.defaultBankAccountCode.message}</p>
              )}
            </div>

          </CardContent>
        </Card>

        <EstablishmentsManagement companyId={companyId} />

        <ShareholdersManagement companyId={companyId} />

        <PersonsPrivacyCard companyId={companyId} canEdit={canEdit} />

        <div id="regimes-fiscaux" className="scroll-mt-20">
          <TaxRegimeHistory companyId={companyId} />
        </div>

        <DeadlineSettingsCard companyId={companyId} legalType={watch('legalType')} canEdit={canEdit} />
        </fieldset>
      </form>
      </FormProvider>

      {isDirty && (
        <div
          role="status"
          className="bg-popover sticky bottom-[max(1rem,calc(env(safe-area-inset-bottom)+0.5rem))] z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 shadow-lg"
        >
          <p className="text-sm">Modifications non enregistrées</p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => reset()} disabled={loading}>
              Annuler les modifications
            </Button>
            <Button type="submit" form="company-form" size="sm" loading={loading}>
              Enregistrer
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
