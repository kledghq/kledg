'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Field, HelpTip, useConfirm } from '@/components/shared'
import { responseError } from '@/hooks/use-cursor-list'
import { FRENCH_VAT_RATES_BP, formatVatRate } from '@/lib/invoices/amounts'
import { checkIdentifiers } from '@/lib/tiers/identifiers'
import { accountCodeError, auxiliaryNumberError, DEFAULT_COLLECTIVE, normalizeAuxiliaryNumber, type TiersKindValue } from '@/lib/tiers/rules'

const NO_RATE = 'none'

const schema = z
  .object({
    kind: z.enum(['CUSTOMER', 'SUPPLIER']),
    name: z.string().trim().min(1, 'Le nom est requis').max(200),
    siren: z.string(),
    siret: z.string(),
    vatNumber: z.string(),
    email: z.string().trim().refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Adresse e-mail invalide'),
    auxiliaryAccountNumber: z.string(),
    collectiveAccountCode: z.string(),
    defaultAccountCode: z.string(),
    defaultVatRateBp: z.string(),
    ownTerms: z.boolean(),
    termsDays: z.string(),
    termsEndOfMonth: z.boolean(),
    street: z.string(),
    postalCode: z.string(),
    city: z.string(),
    country: z.string(),
    notes: z.string().max(2000),
  })
  .superRefine((values, ctx) => {
    const ids = checkIdentifiers(values)
    if (ids.errors.length) ctx.addIssue({ code: 'custom', path: ['siren'], message: ids.errors.join(' ') })
    if (values.auxiliaryAccountNumber.trim()) {
      const error = auxiliaryNumberError(normalizeAuxiliaryNumber(values.auxiliaryAccountNumber))
      if (error) ctx.addIssue({ code: 'custom', path: ['auxiliaryAccountNumber'], message: error })
    }
    if (values.collectiveAccountCode.trim()) {
      const error = accountCodeError(values.kind, 'collective', values.collectiveAccountCode.trim())
      if (error) ctx.addIssue({ code: 'custom', path: ['collectiveAccountCode'], message: error })
    }
    if (values.defaultAccountCode.trim()) {
      const error = accountCodeError(values.kind, 'line', values.defaultAccountCode.trim())
      if (error) ctx.addIssue({ code: 'custom', path: ['defaultAccountCode'], message: error })
    }
    if (values.ownTerms) {
      const days = Number(values.termsDays)
      const max = values.termsEndOfMonth ? 45 : 60
      if (!Number.isInteger(days) || days < 0 || days > max) {
        ctx.addIssue({ code: 'custom', path: ['termsDays'], message: `Entre 0 et ${max} jours (Code de commerce, art. L441-10).` })
      }
    }
    const address = [values.street, values.postalCode, values.city].map((v) => v.trim())
    if (address.some(Boolean) && !address.every(Boolean)) {
      ctx.addIssue({ code: 'custom', path: ['street'], message: 'Indiquez la rue, le code postal et la ville, ou laissez l’adresse vide.' })
    }
  })

export type TiersFormValues = z.infer<typeof schema>

const EMPTY_TIERS: TiersFormValues = {
  kind: 'SUPPLIER',
  name: '',
  siren: '',
  siret: '',
  vatNumber: '',
  email: '',
  auxiliaryAccountNumber: '',
  collectiveAccountCode: '',
  defaultAccountCode: '',
  defaultVatRateBp: NO_RATE,
  ownTerms: false,
  termsDays: '30',
  termsEndOfMonth: false,
  street: '',
  postalCode: '',
  city: '',
  country: 'FR',
  notes: '',
}

interface TiersFormProps {
  companyId: string
  tiersId?: string
  initial?: TiersFormValues
  /** The tiers has invoices: its auxiliary number no longer changes. */
  locked?: boolean
  canWrite: boolean
  canDelete?: boolean
}

const text = (value: string) => (value.trim() ? value.trim() : null)

export function TiersForm({ companyId, tiersId, initial, locked = false, canWrite, canDelete = false }: TiersFormProps) {
  const router = useRouter()
  const { confirm, dialog } = useConfirm()
  const [submitting, setSubmitting] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const form = useForm<TiersFormValues>({ resolver: zodResolver(schema), defaultValues: initial ?? EMPTY_TIERS })
  const { control, register, handleSubmit, formState } = form
  const kind = useWatch({ control, name: 'kind' }) as TiersKindValue
  const ownTerms = useWatch({ control, name: 'ownTerms' })

  React.useEffect(() => {
    if (!formState.isDirty || submitting) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [formState.isDirty, submitting])

  const onSubmit = async (values: TiersFormValues) => {
    setSubmitting(true)
    setFormError(null)
    const body = {
      companyId,
      ...(tiersId ? {} : { kind: values.kind }),
      name: values.name,
      siren: text(values.siren),
      siret: text(values.siret),
      vatNumber: text(values.vatNumber),
      email: text(values.email),
      ...(locked ? {} : { auxiliaryAccountNumber: text(values.auxiliaryAccountNumber) }),
      collectiveAccountCode: text(values.collectiveAccountCode),
      defaultAccountCode: text(values.defaultAccountCode),
      defaultVatRateBp: values.defaultVatRateBp === NO_RATE ? null : Number(values.defaultVatRateBp),
      paymentTerms: values.ownTerms ? { days: Number(values.termsDays), endOfMonth: values.termsEndOfMonth } : null,
      address: values.street.trim()
        ? { street: values.street.trim(), postalCode: values.postalCode.trim(), city: values.city.trim(), country: values.country.trim().toUpperCase() || 'FR' }
        : null,
      notes: text(values.notes),
    }
    try {
      const response = await fetch(tiersId ? `/api/tiers/${tiersId}` : '/api/tiers', {
        method: tiersId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(await responseError(response, 'Le tiers n’a pas été enregistré. Réessayez.'))
      toast.success(tiersId ? 'Tiers modifié' : 'Tiers créé')
      form.reset(values)
      router.push(`/${companyId}/tiers`)
    } catch (e) {
      setFormError((e as Error).message)
      setSubmitting(false)
    }
  }

  const remove = async () => {
    if (!tiersId) return
    const ok = await confirm({
      title: `Supprimer ${form.getValues('name')} ?`,
      description: 'Le tiers est supprimé. Les écritures qui portent son compte auxiliaire ne changent pas.',
      confirmLabel: 'Supprimer le tiers',
    })
    if (!ok) return
    setSubmitting(true)
    try {
      const response = await fetch(`/api/tiers/${tiersId}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await responseError(response, 'Le tiers n’a pas été supprimé.'))
      toast.success('Tiers supprimé')
      router.push(`/${companyId}/tiers`)
    } catch (e) {
      toast.error((e as Error).message)
      setSubmitting(false)
    }
  }

  const errors = formState.errors
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
      <fieldset disabled={!canWrite} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Identité</CardTitle>
            <CardDescription>Le nom et les identifiants qui figurent sur les factures.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {!tiersId ? (
              <div className="space-y-2 sm:col-span-2">
                <p className="text-sm font-medium">Type</p>
                <Controller
                  control={control}
                  name="kind"
                  render={({ field }) => (
                    <ToggleGroup type="single" variant="outline" size="sm" value={field.value} onValueChange={(v) => v && field.onChange(v)} aria-label="Type de tiers">
                      <ToggleGroupItem value="SUPPLIER">Fournisseur</ToggleGroupItem>
                      <ToggleGroupItem value="CUSTOMER">Client</ToggleGroupItem>
                    </ToggleGroup>
                  )}
                />
              </div>
            ) : null}
            <Field label="Nom" required error={errors.name?.message} className="sm:col-span-2">
              <Input {...register('name')} placeholder="ex. Atelier Lumen" autoComplete="organization" />
            </Field>
            <Field label="SIREN" optional error={errors.siren?.message}>
              <Input {...register('siren')} inputMode="numeric" autoComplete="off" placeholder="9 chiffres" className="font-mono" />
            </Field>
            <Field label="SIRET" optional>
              <Input {...register('siret')} inputMode="numeric" autoComplete="off" placeholder="14 chiffres" className="font-mono" />
            </Field>
            <Field label="Numéro de TVA intracommunautaire" optional>
              <Input {...register('vatNumber')} autoComplete="off" placeholder="ex. FR40303265045" className="font-mono" />
            </Field>
            <Field label="E-mail" optional error={errors.email?.message}>
              <Input {...register('email')} type="email" autoComplete="email" />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              Comptabilité
              <HelpTip term="Compte auxiliaire">
                Le compte auxiliaire identifie le tiers sur les lignes du compte collectif ({DEFAULT_COLLECTIVE[kind]})&nbsp;: il sert au lettrage, à la balance auxiliaire et à la balance âgée, et figure dans le FEC (CompAuxNum).
              </HelpTip>
            </CardTitle>
            <CardDescription>Comptes proposés sur ses factures et délai de paiement.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Compte auxiliaire"
              optional={!tiersId}
              error={errors.auxiliaryAccountNumber?.message}
              hint={locked ? 'Ce tiers a des factures\u00a0: son compte auxiliaire ne change plus.' : !tiersId ? 'Vide\u00a0: le suivant, C00001 pour un client, F00001 pour un fournisseur.' : undefined}
            >
              <Input {...register('auxiliaryAccountNumber')} disabled={locked} autoComplete="off" className="font-mono uppercase" placeholder="ex. F00012" />
            </Field>
            <Field label="Compte collectif" optional error={errors.collectiveAccountCode?.message} hint={`Vide\u00a0: ${DEFAULT_COLLECTIVE[kind]}.`}>
              <Input {...register('collectiveAccountCode')} autoComplete="off" className="font-mono" placeholder={DEFAULT_COLLECTIVE[kind]} />
            </Field>
            <Field label={kind === 'CUSTOMER' ? 'Compte de vente par défaut' : 'Compte d’achat par défaut'} optional error={errors.defaultAccountCode?.message}>
              <Input {...register('defaultAccountCode')} autoComplete="off" className="font-mono" placeholder={kind === 'CUSTOMER' ? 'ex. 706' : 'ex. 6064'} />
            </Field>
            <Field label="Taux de TVA par défaut" htmlFor="tiers-default-rate" optional>
              <Controller
                control={control}
                name="defaultVatRateBp"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="tiers-default-rate" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_RATE}>Aucun</SelectItem>
                      {FRENCH_VAT_RATES_BP.map((rate) => (
                        <SelectItem key={rate} value={String(rate)}>
                          {formatVatRate(rate)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <div className="space-y-3 sm:col-span-2">
              <Controller
                control={control}
                name="ownTerms"
                render={({ field }) => (
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={field.value} onCheckedChange={(c) => field.onChange(c === true)} />
                    Délai de paiement propre à ce tiers (sinon celui de la société)
                  </label>
                )}
              />
              {ownTerms ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Délai en jours" error={errors.termsDays?.message}>
                    <Input {...register('termsDays')} inputMode="numeric" />
                  </Field>
                  <Controller
                    control={control}
                    name="termsEndOfMonth"
                    render={({ field }) => (
                      <label className="flex items-center gap-2 self-end pb-2 text-sm">
                        <Checkbox checked={field.value} onCheckedChange={(c) => field.onChange(c === true)} />
                        Fin de mois (45 jours au plus)
                      </label>
                    )}
                  />
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Adresse</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Rue" optional error={errors.street?.message} className="sm:col-span-2">
              <Input {...register('street')} autoComplete="street-address" />
            </Field>
            <Field label="Code postal" optional>
              <Input {...register('postalCode')} autoComplete="postal-code" inputMode="numeric" />
            </Field>
            <Field label="Ville" optional>
              <Input {...register('city')} autoComplete="address-level2" />
            </Field>
            <Field label="Pays" hint="Code ISO à deux lettres (FR, BE...).">
              <Input {...register('country')} autoComplete="country" className="uppercase" maxLength={2} />
            </Field>
            <Field label="Notes" optional className="sm:col-span-2">
              <Textarea {...register('notes')} rows={3} />
            </Field>
          </CardContent>
        </Card>
      </fieldset>

      {formError ? (
        <p role="alert" className="text-destructive text-sm">
          {formError}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {tiersId && canDelete ? (
          <Button type="button" variant="ghost" className="hover:text-destructive" onClick={remove} disabled={submitting || locked} title={locked ? 'Un tiers qui porte des factures ne se supprime pas.' : undefined}>
            <Trash2 aria-hidden />
            Supprimer
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Annuler
          </Button>
          <Button type="submit" loading={submitting} disabled={!canWrite}>
            {tiersId ? 'Enregistrer' : 'Créer le tiers'}
          </Button>
        </div>
      </div>
      {dialog}
    </form>
  )
}
