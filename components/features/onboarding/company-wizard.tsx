'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Controller, useFieldArray, useForm, type FieldPath } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft, ArrowRight, Check, ExternalLink, Plus, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AmountInput } from '@/components/ui/amount-input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { DateInput } from '@/components/ui/date-input'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Amount, Field, HelpTip, formatAmount } from '@/components/shared'
import { CompanyNameWithForm } from '@/components/features/companies/legal-form-tag'
import { cn } from '@/lib/utils'
import { docsUrl } from '@/lib/docs-links'
import { formatIsoDateFr, localDateToIso } from '@/lib/utils/date'
import { LEGAL_FORMS, isLegalType, legalFormName, type LegalType } from '@/lib/companies/legal-forms'
import { sirenChecksumValid, type SirenLookupResult } from '@/lib/companies/siren-lookup'
import {
  CreateCompanySchema,
  checkFirstFiscalYear,
  shareCapitalCents,
  suggestFirstFiscalYear,
  type CreateCompanyData,
  type CreateCompanyInput,
} from '@/lib/companies/company-wizard'

const STEPS = ['Identité', 'Exercice et impôts', 'Capital et associés', 'Vérifier'] as const

/** Forms taxed at the income tax of their partners by default (no corporate tax). */
const INCOME_TAX_FORMS: ReadonlySet<string> = new Set(['SCI', 'SNC', 'EI'])

const STEP_FIELDS: Array<Array<FieldPath<CreateCompanyInput>>> = [
  ['name', 'siren', 'legalType', 'activityCode', 'foundationDate', 'email', 'phone', 'headOffice'],
  ['firstFiscalYear', 'vatRegime', 'corporateTaxRegime', 'includeOptionalAccounts'],
  ['totalShares', 'shareNominalValueCents', 'shareholders'],
  [],
]

const VAT_OPTIONS = [
  {
    value: 'simplified',
    label: 'Réel simplifié',
    help: "Une déclaration annuelle (CA12) et deux acomptes dans l'année. Le cas le plus courant d'une petite société.",
  },
  {
    value: 'normal',
    label: 'Réel normal',
    help: "Une déclaration chaque mois (CA3). Obligatoire au-delà des seuils du réel simplifié, possible sur option.",
  },
  {
    value: 'franchise',
    label: 'Franchise en base',
    help: 'Pas de TVA facturée ni récupérée, sous un plafond de chiffre d\'affaires. Les factures portent la mention "TVA non applicable, art. 293 B du CGI".',
  },
] as const

const IS_OPTIONS = [
  {
    value: 'simplified',
    label: "Régime simplifié d'imposition",
    help: 'Liasse simplifiée (2033), pour les sociétés sous les seuils du réel normal. Le cas le plus courant.',
  },
  {
    value: 'normal',
    label: 'Régime réel normal',
    help: 'Liasse complète (2050 à 2059), au-delà des seuils ou sur option.',
  },
  {
    value: 'none',
    label: "Pas d'impôt sur les sociétés",
    help: "Le résultat est imposé chez les associés à l'impôt sur le revenu\u00a0: cas habituel d'une SCI, d'une SNC ou d'un entrepreneur individuel.",
  },
] as const

type LookupState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'found'; company: SirenLookupResult }
  | { status: 'not_found' }
  | { status: 'unavailable'; message?: string }

/** The user's own calendar day (the browser's local date). */
function todayIso(): string {
  return localDateToIso(new Date())
}

function ChoiceCard({ value, label, help, id }: { value: string; label: string; help: string; id: string }) {
  return (
    <Label
      htmlFor={id}
      className="has-[[data-state=checked]]:border-foreground hover:bg-muted/40 flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal"
    >
      <RadioGroupItem value={value} id={id} className="mt-0.5" />
      <span className="space-y-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="text-muted-foreground block text-sm leading-snug">{help}</span>
      </span>
    </Label>
  )
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-[12rem_1fr] sm:gap-4">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

/**
 * Company creation in four steps: identity (prefilled from the public
 * company directory by SIREN), first fiscal year and tax regimes, capital
 * and shareholders, then a summary. One schema validates every step here
 * and again on the server (lib/companies/company-wizard.ts); nothing is
 * written before the last step.
 */
export function CompanyWizard() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [lookup, setLookup] = useState<LookupState>({ status: 'idle' })
  const [fiscalTouched, setFiscalTouched] = useState(false)
  const [taxTouched, setTaxTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const today = useMemo(todayIso, [])

  const form = useForm<CreateCompanyInput, unknown, CreateCompanyData>({
    resolver: zodResolver(CreateCompanySchema),
    defaultValues: {
      name: '',
      siren: '',
      legalType: null,
      activityCode: '',
      foundationDate: null,
      email: '',
      phone: '',
      headOffice: { siret: '', street: '', street2: '', postalCode: '', city: '' },
      firstFiscalYear: suggestFirstFiscalYear({ today }),
      includeOptionalAccounts: false,
      totalShares: null,
      shareNominalValueCents: null,
      shareholders: [],
    },
  })
  const { register, control, watch, setValue, getValues, trigger, formState } = form
  const { errors, isDirty } = formState
  const shareholders = useFieldArray({ control, name: 'shareholders' })

  // Never lose what was typed: warn before leaving with unsaved input.
  useEffect(() => {
    if (!isDirty || submitting) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [isDirty, submitting])

  const values = watch()
  const legalType = values.legalType ?? null
  const isIndividual = legalType === 'EI'
  const fiscalYear = values.firstFiscalYear
  const fiscalCheck = checkFirstFiscalYear({
    startDate: fiscalYear.startDate,
    endDate: fiscalYear.endDate,
    isFirst: fiscalYear.isFirst,
    subjectToCorporateTax: values.corporateTaxRegime !== null,
    foundationDate: values.foundationDate,
  })
  const capitalCents = shareCapitalCents(values.totalShares, values.shareNominalValueCents)
  const heldShares = (values.shareholders ?? []).reduce((sum, s) => sum + (Number(s.numberOfShares) || 0), 0)

  /** Proposes the first fiscal year again while the user has not chosen one. */
  const refreshFiscalSuggestion = (foundationDate: string | null | undefined) => {
    if (fiscalTouched) return
    setValue('firstFiscalYear', suggestFirstFiscalYear({ today, foundationDate }), { shouldDirty: true })
  }

  const setLegalType = (value: LegalType | null) => {
    setValue('legalType', value, { shouldDirty: true })
    // Usual tax regime of the form, until the user chooses one in step 2.
    if (!taxTouched) setValue('corporateTaxRegime', value && INCOME_TAX_FORMS.has(value) ? null : 'simplified')
  }

  const runLookup = async () => {
    const siren = getValues('siren').replace(/\s+/g, '')
    if (!/^\d{9}$/.test(siren)) {
      await trigger('siren')
      return
    }
    setLookup({ status: 'loading' })
    try {
      const response = await fetch(`/api/companies/lookup?siren=${siren}`)
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        setLookup({ status: 'unavailable', message: body.error })
        return
      }
      const outcome = (await response.json()) as
        | { status: 'found'; company: SirenLookupResult }
        | { status: 'not_found' }
        | { status: 'unavailable' }
      if (outcome.status !== 'found') {
        setLookup(outcome)
        return
      }
      const company = outcome.company
      const dirty = { shouldDirty: true }
      setValue('name', company.name, dirty)
      if (company.legalType) setLegalType(company.legalType)
      setValue('activityCode', company.activityCode ?? '', dirty)
      if (company.creationDate) {
        setValue('foundationDate', company.creationDate, dirty)
        refreshFiscalSuggestion(company.creationDate)
      }
      if (company.headOffice) {
        setValue(
          'headOffice',
          {
            siret: company.headOffice.siret ?? '',
            street: company.headOffice.street ?? '',
            street2: company.headOffice.street2 ?? '',
            postalCode: company.headOffice.postalCode ?? '',
            city: company.headOffice.city ?? '',
          },
          dirty,
        )
      }
      setLookup({ status: 'found', company })
      void trigger(['name', 'siren'])
    } catch {
      setLookup({ status: 'unavailable' })
    }
  }

  const next = async () => {
    const fields = STEP_FIELDS[step]
    const ok = fields.length === 0 || (await trigger(fields, { shouldFocus: true }))
    if (!ok) return
    if (step === 1 && fiscalCheck.errors.length > 0) return
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
    window.scrollTo({ top: 0 })
  }

  const back = () => {
    setStep((s) => Math.max(s - 1, 0))
    window.scrollTo({ top: 0 })
  }

  const submit = form.handleSubmit(
    async (data) => {
      setSubmitting(true)
      try {
        const response = await fetch('/api/companies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(isIndividual ? { ...data, totalShares: null, shareNominalValueCents: null, shareholders: [] } : data),
        })
        const body = (await response.json().catch(() => ({}))) as { error?: string; slug?: string; name?: string }
        if (!response.ok || !body.slug) {
          toast.error(body.error || "La société n'a pas pu être créée. Réessayez.")
          setSubmitting(false)
          return
        }
        toast.success(`Société « ${body.name} » créée`)
        window.dispatchEvent(new Event('companies:refresh'))
        router.push(`/${body.slug}`)
        router.refresh()
      } catch {
        toast.error("La société n'a pas pu être créée. Vérifiez votre connexion et réessayez.")
        setSubmitting(false)
      }
    },
    () => {
      toast.error('Certaines informations sont à corriger\u00a0: revenez aux étapes signalées.')
      // Back to the first step with an error
      const failing = STEP_FIELDS.findIndex((fields) => fields.some((f) => f.split('.')[0] in errors))
      if (failing >= 0) setStep(failing)
    },
  )

  const sirenValue = (values.siren ?? '').replace(/\s+/g, '')

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        if (step < STEPS.length - 1) void next()
        else void submit(event)
      }}
      className="max-w-3xl space-y-6"
    >
      <nav aria-label="Étapes de la création">
        <p className="text-muted-foreground mb-2 text-sm sm:hidden">
          Étape {step + 1} sur {STEPS.length} : {STEPS[step]}
        </p>
        <ol className="hidden gap-2 sm:flex">
          {STEPS.map((label, index) => (
            <li
              key={label}
              aria-current={index === step ? 'step' : undefined}
              className={cn(
                'flex flex-1 items-center gap-2 border-t-2 pt-2 text-sm',
                index < step ? 'border-foreground text-foreground' : index === step ? 'border-foreground font-medium' : 'text-muted-foreground border-border',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-full border text-xs num',
                  index <= step ? 'border-foreground' : 'border-border',
                )}
              >
                {index < step ? <Check className="size-3" /> : index + 1}
              </span>
              {label}
            </li>
          ))}
        </ol>
      </nav>

      {step === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Identité de la société</CardTitle>
            <CardDescription>
              Saisissez le SIREN&nbsp;: Kledg retrouve le nom, l&apos;adresse et la forme juridique dans l&apos;annuaire public
              des entreprises. Tout reste modifiable, et vous pouvez aussi tout saisir vous-même.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <Field
              label="SIREN"
              htmlFor="siren"
              required
              error={errors.siren?.message}
              hint={
                sirenValue.length === 9 && !sirenChecksumValid(sirenValue)
                  ? 'Ce numéro ne passe pas le contrôle du SIREN\u00a0: vérifiez-le.'
                  : 'Les 9 chiffres du numéro d’immatriculation, sur le Kbis ou l’avis de situation Insee.'
              }
            >
              {/* Own id: Field would otherwise give the wrapper the id of the input it labels */}
              <div id="siren-row" className="flex gap-2">
                <Input
                  id="siren"
                  inputMode="numeric"
                  autoComplete="off"
                  enterKeyHint="search"
                  spellCheck={false}
                  placeholder="ex. 912 345 675"
                  className="max-w-56"
                  // Field describes its child, here the wrapper: wire the hint and the error to the input itself
                  aria-describedby={errors.siren ? 'siren-hint siren-error' : 'siren-hint'}
                  aria-invalid={errors.siren ? true : undefined}
                  {...register('siren')}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void runLookup()
                    }
                  }}
                />
                <Button type="button" variant="outline" onClick={() => void runLookup()} loading={lookup.status === 'loading'}>
                  <Search aria-hidden />
                  Rechercher
                </Button>
              </div>
            </Field>

            <div aria-live="polite">
              {lookup.status === 'found' ? (
                <Alert>
                  <Check aria-hidden />
                  <AlertTitle className="line-clamp-none">Société trouvée dans l&apos;annuaire des entreprises</AlertTitle>
                  <AlertDescription>
                    <p>
                      Les informations ci-dessous sont préremplies&nbsp;: vérifiez-les.
                      {lookup.company.natureJuridique === '5710'
                        ? " L'Insee ne distingue pas SAS et SASU\u00a0: choisissez SASU si la société a un associé unique."
                        : null}
                      {lookup.company.natureJuridique === '5499'
                        ? " L'Insee ne distingue pas SARL et EURL\u00a0: choisissez EURL si la société a un associé unique."
                        : null}
                    </p>
                    {!lookup.company.active ? (
                      <p className="text-destructive">Attention&nbsp;: cette société est indiquée comme cessée.</p>
                    ) : null}
                    <a
                      href={`https://annuaire-entreprises.data.gouv.fr/entreprise/${lookup.company.siren}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-link inline-flex items-center gap-1 underline-offset-4 hover:underline"
                    >
                      Voir la fiche publique
                      <ExternalLink aria-hidden className="size-3.5" />
                    </a>
                  </AlertDescription>
                </Alert>
              ) : lookup.status === 'not_found' ? (
                <p className="text-muted-foreground text-sm">
                  Aucune société publique avec ce SIREN dans l&apos;annuaire (les sociétés non diffusibles n&apos;y figurent
                  pas). Saisissez les informations ci-dessous.
                </p>
              ) : lookup.status === 'unavailable' ? (
                <p className="text-muted-foreground text-sm">
                  {lookup.message ??
                    "L'annuaire des entreprises ne répond pas pour l'instant. Saisissez les informations ci-dessous, la création n'en dépend pas."}
                </p>
              ) : null}
            </div>

            <Field label="Nom de la société" required error={errors.name?.message} hint="La dénomination sociale, telle qu'elle figure sur le Kbis.">
              <Input id="name" placeholder="ex. Atelier Lumen" autoComplete="organization" {...register('name')} />
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                label="Forme juridique"
                htmlFor="legalType"
                optional
                help={
                  <HelpTip term="Forme juridique">
                    Le type de société (SAS, SARL, SCI...). Il détermine notamment la réserve légale et le régime
                    d&apos;imposition habituel.
                  </HelpTip>
                }
              >
                <Select value={legalType ?? ''} onValueChange={(value) => setLegalType(isLegalType(value) ? value : null)}>
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
              </Field>
              <Controller
                control={control}
                name="foundationDate"
                render={({ field }) => (
                  <Field label="Date de création" optional error={errors.foundationDate?.message} hint="Date d'immatriculation.">
                    <DateInput
                      id="foundationDate"
                      value={field.value ?? ''}
                      onValueChange={(iso) => {
                        field.onChange(iso || null)
                        refreshFiscalSuggestion(iso || null)
                      }}
                    />
                  </Field>
                )}
              />
            </div>

            <Field
              label="Code NAF (APE)"
              optional
              error={errors.activityCode?.message}
              hint="L'activité principale selon l'Insee, ex. 62.01Z."
            >
              <Input id="activityCode" className="max-w-40 font-mono" placeholder="ex. 62.01Z" {...register('activityCode')} />
            </Field>

            <fieldset className="space-y-4 rounded-lg border p-4">
              <legend className="px-1 text-sm font-medium">Siège social</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="SIRET du siège" optional error={errors.headOffice?.siret?.message} hint="14 chiffres&nbsp;: le SIREN suivi de 5 chiffres.">
                  <Input id="headOffice.siret" inputMode="numeric" autoComplete="off" className="font-mono" {...register('headOffice.siret')} />
                </Field>
              </div>
              <Field label="Adresse" optional>
                <Input id="headOffice.street" placeholder="ex. 12 rue des Artisans" autoComplete="address-line1" {...register('headOffice.street')} />
              </Field>
              <Field label="Complément d'adresse" optional>
                <Input id="headOffice.street2" autoComplete="address-line2" {...register('headOffice.street2')} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
                <Field label="Code postal" optional>
                  <Input id="headOffice.postalCode" inputMode="numeric" autoComplete="postal-code" {...register('headOffice.postalCode')} />
                </Field>
                <Field label="Ville" optional>
                  <Input id="headOffice.city" autoComplete="address-level2" {...register('headOffice.city')} />
                </Field>
              </div>
            </fieldset>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Email de la société" optional error={errors.email?.message}>
                <Input id="email" type="email" autoComplete="email" spellCheck={false} placeholder="ex. contact@atelier-lumen.fr" {...register('email')} />
              </Field>
              <Field label="Téléphone" optional>
                <Input id="phone" type="tel" autoComplete="tel" placeholder="ex. 04 78 00 00 00" {...register('phone')} />
              </Field>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 1 ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Premier exercice dans Kledg</CardTitle>
              <CardDescription>
                L&apos;exercice est la période couverte par les comptes annuels, en principe 12 mois. Kledg ouvre cet
                exercice et y prépare le plan comptable.{' '}
                <a href={docsUrl('fiscalYear')} target="_blank" rel="noreferrer" className="text-link underline-offset-4 hover:underline">
                  Comprendre l&apos;exercice
                </a>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <Controller
                control={control}
                name="firstFiscalYear.isFirst"
                render={({ field }) => (
                  <RadioGroup
                    aria-label="Situation de la société"
                    value={field.value ? 'first' : 'existing'}
                    onValueChange={(value) => {
                      setFiscalTouched(true)
                      field.onChange(value === 'first')
                    }}
                    className="gap-2"
                  >
                    <ChoiceCard
                      id="fy-first"
                      value="first"
                      label="La société vient d'être créée"
                      help="C'est son premier exercice&nbsp;: il commence à la création et peut durer de quelques mois à 24 mois."
                    />
                    <ChoiceCard
                      id="fy-existing"
                      value="existing"
                      label="La société existait déjà"
                      help="Kledg commence avec l'exercice en cours. Le guide Démarrer vous aidera ensuite à reprendre les soldes de l'exercice précédent."
                    />
                  </RadioGroup>
                )}
              />

              <div className="grid gap-5 sm:grid-cols-2">
                <Controller
                  control={control}
                  name="firstFiscalYear.startDate"
                  render={({ field }) => (
                    <Field label="Début de l'exercice" required error={errors.firstFiscalYear?.startDate?.message}>
                      <DateInput
                        id="fy-start"
                        value={field.value}
                        onValueChange={(iso) => {
                          setFiscalTouched(true)
                          field.onChange(iso)
                        }}
                      />
                    </Field>
                  )}
                />
                <Controller
                  control={control}
                  name="firstFiscalYear.endDate"
                  render={({ field }) => (
                    <Field
                      label="Date de clôture"
                      required
                      hint="Le dernier jour de l'exercice. Les exercices suivants clôtureront le même jour chaque année."
                    >
                      <DateInput
                        id="fy-end"
                        value={field.value}
                        onValueChange={(iso) => {
                          setFiscalTouched(true)
                          field.onChange(iso)
                        }}
                      />
                    </Field>
                  )}
                />
              </div>

              <div aria-live="polite" className="space-y-3">
                {fiscalCheck.errors.map((message) => (
                  <Alert key={message} variant="destructive">
                    <AlertDescription>{message}</AlertDescription>
                  </Alert>
                ))}
                {fiscalCheck.errors.length === 0 && fiscalCheck.months > 0 ? (
                  <p className="text-sm">
                    Exercice de <span className="num font-medium">{fiscalCheck.months} mois</span>, du{' '}
                    {formatIsoDateFr(fiscalYear.startDate)} au {formatIsoDateFr(fiscalYear.endDate)}.
                  </p>
                ) : null}
                {fiscalCheck.warnings.map((message) => (
                  <Alert key={message}>
                    <AlertDescription>{message}</AlertDescription>
                  </Alert>
                ))}
              </div>

              <details className="text-muted-foreground text-sm">
                <summary className="text-foreground cursor-pointer font-medium">Les règles de durée</summary>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>
                    Un exercice dure en principe 12 mois&nbsp;: les comptes sont arrêtés et l&apos;inventaire fait au moins une
                    fois tous les douze mois (Code de commerce, art. L123-12).
                  </li>
                  <li>
                    Le premier exercice peut être plus court ou plus long. Aucune durée minimale ; 24 mois au plus selon
                    l&apos;usage admis par les greffes.
                  </li>
                  <li>
                    Pour une société à l&apos;impôt sur les sociétés, la première période d&apos;imposition se termine au
                    plus tard le 31 décembre de l&apos;année qui suit la création (CGI, art. 209, I).
                  </li>
                </ul>
              </details>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>TVA</CardTitle>
              <CardDescription>
                Comment la société déclare la TVA. En cas de doute, reprenez le choix fait à la création (formulaire M0 ou
                guichet unique) ou demandez à votre expert-comptable.{' '}
                <a href={docsUrl('vat')} target="_blank" rel="noreferrer" className="text-link underline-offset-4 hover:underline">
                  La TVA expliquée
                </a>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Controller
                control={control}
                name="vatRegime"
                render={({ field }) => (
                  <RadioGroup aria-label="Régime de TVA" value={field.value ?? ''} onValueChange={field.onChange} className="gap-2">
                    {VAT_OPTIONS.map((option) => (
                      <ChoiceCard key={option.value} id={`vat-${option.value}`} {...option} />
                    ))}
                  </RadioGroup>
                )}
              />
              {errors.vatRegime?.message ? <p className="text-destructive text-sm">{errors.vatRegime.message}</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Impôt sur les sociétés</CardTitle>
              <CardDescription>
                Le régime d&apos;imposition du résultat. Il décide de la liasse fiscale à déposer chaque année.{' '}
                <a href={docsUrl('calendar')} target="_blank" rel="noreferrer" className="text-link underline-offset-4 hover:underline">
                  Le calendrier d&apos;une petite société
                </a>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Controller
                control={control}
                name="corporateTaxRegime"
                render={({ field }) => (
                  <RadioGroup
                    aria-label="Régime d'impôt sur les sociétés"
                    value={field.value === null ? 'none' : (field.value ?? '')}
                    onValueChange={(value) => {
                      setTaxTouched(true)
                      field.onChange(value === 'none' ? null : value)
                    }}
                    className="gap-2"
                  >
                    {IS_OPTIONS.map((option) => (
                      <ChoiceCard key={option.value} id={`is-${option.value}`} {...option} />
                    ))}
                  </RadioGroup>
                )}
              />
              {errors.corporateTaxRegime?.message ? <p className="text-destructive text-sm">{errors.corporateTaxRegime.message}</p> : null}
            </CardContent>
          </Card>

          <Controller
            control={control}
            name="includeOptionalAccounts"
            render={({ field }) => (
              <div className="flex items-start gap-3">
                <Checkbox id="includeOptionalAccounts" checked={field.value === true} onCheckedChange={(checked) => field.onChange(checked === true)} />
                <div className="space-y-1">
                  <Label htmlFor="includeOptionalAccounts" className="font-normal">
                    Ajouter aussi les sous-comptes facultatifs du plan comptable
                  </Label>
                  <p className="text-muted-foreground text-sm">
                    Inutile pour commencer&nbsp;: le plan comptable général suffit, vous pourrez créer des comptes plus tard.
                  </p>
                </div>
              </div>
            )}
          />
        </>
      ) : null}

      {step === 2 ? (
        <Card>
          <CardHeader>
            <CardTitle>Capital et associés</CardTitle>
            <CardDescription>
              Le capital social et sa répartition, tels qu&apos;indiqués dans les statuts. Facultatif&nbsp;: vous pourrez les
              compléter plus tard dans Informations.{' '}
              <a href={docsUrl('equity')} target="_blank" rel="noreferrer" className="text-link underline-offset-4 hover:underline">
                Capitaux propres et compte courant
              </a>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {isIndividual ? (
              <p className="text-muted-foreground text-sm">
                Un entrepreneur individuel n&apos;a pas de capital social ni d&apos;associés&nbsp;: passez à l&apos;étape suivante.
              </p>
            ) : (
              <>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Nombre de parts ou d'actions" optional error={errors.totalShares?.message}>
                    <Input
                      id="totalShares"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      placeholder="ex. 1000"
                      {...register('totalShares', { setValueAs: (v) => (v === '' || v === null ? null : Number(v)) })}
                    />
                  </Field>
                  <Controller
                    control={control}
                    name="shareNominalValueCents"
                    render={({ field }) => (
                      <Field label="Valeur nominale d'une part" optional error={errors.shareNominalValueCents?.message}>
                        <AmountInput id="shareNominalValueCents" value={field.value ?? null} onValueChange={field.onChange} placeholder="ex. 1,00" />
                      </Field>
                    )}
                  />
                  <div className="space-y-1 sm:col-span-2">
                    <p className="text-sm font-medium">Capital social</p>
                    <p className="text-sm">{capitalCents !== null ? <Amount value={capitalCents / 100} /> : <span className="text-muted-foreground">À calculer</span>}</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold">Associés</h3>
                      <p className="text-muted-foreground text-sm">
                        {legalType === 'SASU' || legalType === 'EURL'
                          ? 'Une SASU ou une EURL a un seul associé.'
                          : 'Les personnes ou sociétés qui détiennent le capital.'}
                        {values.totalShares ? (
                          <>
                            {' '}
                            <span className="num">{heldShares}</span> parts réparties sur <span className="num">{values.totalShares}</span>.
                          </>
                        ) : null}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => shareholders.append({ type: 'PHYSICAL', firstName: '', name: '', numberOfShares: Math.max(1, (values.totalShares ?? 0) - heldShares) })}
                    >
                      <Plus aria-hidden />
                      Ajouter un associé
                    </Button>
                  </div>
                  {errors.shareholders?.message || errors.shareholders?.root?.message ? (
                    <p className="text-destructive text-sm">{errors.shareholders?.message ?? errors.shareholders?.root?.message}</p>
                  ) : null}
                  {shareholders.fields.length === 0 ? (
                    <p className="text-muted-foreground text-sm">Aucun associé ajouté.</p>
                  ) : (
                    <ul className="divide-y rounded-lg border">
                      {shareholders.fields.map((item, index) => {
                        const type = values.shareholders?.[index]?.type ?? 'PHYSICAL'
                        const rowErrors = errors.shareholders?.[index]
                        return (
                          <li key={item.id} className="grid items-start gap-3 p-3 sm:grid-cols-2 lg:grid-cols-[9rem_1fr_1fr_6rem_auto]">
                            <Controller
                              control={control}
                              name={`shareholders.${index}.type`}
                              render={({ field }) => (
                                <Field label="Type" htmlFor={`shareholders-${index}-type`}>
                                  <Select value={field.value} onValueChange={field.onChange}>
                                    <SelectTrigger id={`shareholders-${index}-type`} className="w-full">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="PHYSICAL">Personne</SelectItem>
                                      <SelectItem value="LEGAL">Société</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </Field>
                              )}
                            />
                            {type === 'PHYSICAL' ? (
                              <Field label="Prénom" error={rowErrors?.firstName?.message}>
                                <Input id={`shareholders-${index}-firstName`} {...register(`shareholders.${index}.firstName`)} />
                              </Field>
                            ) : (
                              <div className="max-lg:hidden" />
                            )}
                            <Field label={type === 'PHYSICAL' ? 'Nom' : 'Dénomination'} error={rowErrors?.name?.message}>
                              <Input id={`shareholders-${index}-name`} {...register(`shareholders.${index}.name`)} />
                            </Field>
                            <Field label="Parts" error={rowErrors?.numberOfShares?.message}>
                              <Input
                                id={`shareholders-${index}-shares`}
                                type="number"
                                inputMode="numeric"
                                min={1}
                                {...register(`shareholders.${index}.numberOfShares`, { valueAsNumber: true })}
                              />
                            </Field>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="hover:text-destructive justify-self-end lg:mt-7"
                              aria-label={`Retirer l'associé ${index + 1}`}
                              title="Retirer"
                              onClick={() => shareholders.remove(index)}
                            >
                              <Trash2 aria-hidden />
                            </Button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      {step === 3 ? (
        <Card>
          <CardHeader>
            <CardTitle>Vérifier avant de créer</CardTitle>
            <CardDescription>
              Kledg crée la société, son premier exercice, le plan comptable général (PCG) et les journaux habituels (achats,
              ventes, banque, opérations diverses, à-nouveaux).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="divide-y">
              <SummaryRow label="Société">
                <CompanyNameWithForm name={values.name || 'Sans nom'} legalType={legalType} nameClassName="font-medium" />
                {legalType ? <span className="text-muted-foreground block text-xs">{legalFormName(legalType)}</span> : null}
              </SummaryRow>
              <SummaryRow label="SIREN">
                <span className="num font-mono">{sirenValue.replace(/(\d{3})(?=\d)/g, '$1 ')}</span>
              </SummaryRow>
              {values.headOffice?.street || values.headOffice?.city ? (
                <SummaryRow label="Siège social">
                  {[values.headOffice?.street, values.headOffice?.street2, [values.headOffice?.postalCode, values.headOffice?.city].filter(Boolean).join(' ')]
                    .filter(Boolean)
                    .join(', ')}
                </SummaryRow>
              ) : null}
              <SummaryRow label="Premier exercice">
                Du {formatIsoDateFr(fiscalYear.startDate)} au {formatIsoDateFr(fiscalYear.endDate)} ({fiscalCheck.months} mois)
                {fiscalYear.isFirst ? ', premier exercice de la société' : ''}
              </SummaryRow>
              <SummaryRow label="TVA">{VAT_OPTIONS.find((o) => o.value === values.vatRegime)?.label ?? 'À choisir'}</SummaryRow>
              <SummaryRow label="Impôt sur les sociétés">
                {values.corporateTaxRegime === null
                  ? "Pas d'impôt sur les sociétés"
                  : (IS_OPTIONS.find((o) => o.value === values.corporateTaxRegime)?.label ?? 'À choisir')}
              </SummaryRow>
              {!isIndividual && capitalCents !== null ? (
                <SummaryRow label="Capital">
                  {formatAmount(capitalCents / 100)} ({values.totalShares} parts de {formatAmount((values.shareNominalValueCents ?? 0) / 100)})
                </SummaryRow>
              ) : null}
              {!isIndividual && (values.shareholders?.length ?? 0) > 0 ? (
                <SummaryRow label="Associés">
                  <ul className="space-y-0.5">
                    {values.shareholders?.map((s, i) => (
                      <li key={i}>
                        {[s.firstName, s.name].filter(Boolean).join(' ')} : <span className="num">{s.numberOfShares}</span> parts
                      </li>
                    ))}
                  </ul>
                </SummaryRow>
              ) : null}
            </dl>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {step === 0 ? (
          <Button asChild variant="outline">
            <Link href="/companies">Annuler</Link>
          </Button>
        ) : (
          <Button type="button" variant="outline" onClick={back} disabled={submitting}>
            <ArrowLeft aria-hidden />
            Retour
          </Button>
        )}
        {step < STEPS.length - 1 ? (
          <Button type="submit" disabled={step === 1 && fiscalCheck.errors.length > 0}>
            Continuer
            <ArrowRight aria-hidden />
          </Button>
        ) : (
          <Button type="submit" loading={submitting}>
            <Check aria-hidden />
            Créer la société
          </Button>
        )}
      </div>
    </form>
  )
}
