'use client'

import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { AmountInput } from '@/components/ui/amount-input'
import { DateInput } from '@/components/ui/date-input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Amount, Field, formatAmount, HelpTip } from '@/components/shared'
import {
  ALLOWANCE_ACCOUNTS,
  allowedNatures,
  CATEGORY_LABELS,
  defaultAllowanceAccount,
  defaultNature,
  defaultTaxDeductible,
  fixedAssetImpairmentCents,
  impairmentAccountOfAsset,
  NATURE_LABELS,
  type ProvisionCategory,
  type ProvisionNature,
} from '@/lib/provisions/rules'
import type { ProvisionView } from '@/lib/year-end/get-year-end-inventory.service'
import { euros, sendJson, useJson } from './shared'

export interface ProvisionDraft {
  category: ProvisionCategory
  label?: string
  justification?: string
  accountCode?: string
  tiersCode?: string | null
  openedOn?: string
}

interface AssetOption {
  id: string
  label: string
  assetAccount?: { code: string } | null
}

const IMPAIRMENT_CATEGORIES: ProvisionCategory[] = ['FIXED_ASSET', 'INVENTORY', 'RECEIVABLE', 'SECURITY']

/**
 * Creates or changes a provision for risks and charges or an impairment.
 * `provision`: the one to change; `draft`: the defaults of a new one.
 */
export function ProvisionDialog({
  companyId,
  open,
  provision,
  draft,
  onOpenChange,
  onSaved,
}: {
  companyId: string
  open: boolean
  provision: ProvisionView | null
  draft: ProvisionDraft
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {open ? <ProvisionForm key={provision?.id ?? 'new'} companyId={companyId} provision={provision} draft={draft} onOpenChange={onOpenChange} onSaved={onSaved} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function ProvisionForm({
  companyId,
  provision,
  draft,
  onOpenChange,
  onSaved,
}: {
  companyId: string
  provision: ProvisionView | null
  draft: ProvisionDraft
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const initialCategory = provision?.category ?? draft.category
  const initialAccount = provision?.accountCode ?? draft.accountCode ?? defaultAllowanceAccount(initialCategory)
  const [category, setCategory] = React.useState<ProvisionCategory>(initialCategory)
  const [accountCode, setAccountCode] = React.useState(initialAccount)
  const [nature, setNature] = React.useState<ProvisionNature>(provision?.nature ?? defaultNature(initialCategory, initialAccount))
  const [label, setLabel] = React.useState(provision?.label ?? draft.label ?? '')
  const [justification, setJustification] = React.useState(provision?.justification ?? draft.justification ?? '')
  const [fixedAssetId, setFixedAssetId] = React.useState(provision?.fixedAsset?.id ?? '')
  const [tiersCode, setTiersCode] = React.useState(provision?.tiersCode ?? draft.tiersCode ?? '')
  const [openedOn, setOpenedOn] = React.useState(provision?.openedOn ?? draft.openedOn ?? '')
  const [closedOn, setClosedOn] = React.useState(provision?.closedOn ?? '')
  const [taxDeductible, setTaxDeductible] = React.useState(provision?.taxDeductible ?? defaultTaxDeductible(initialAccount))
  const [carriedCents, setCarriedCents] = React.useState<number | null>(provision ? provision.carriedCents || null : null)
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const assets = useJson<AssetOption[]>(category === 'FIXED_ASSET' ? `/api/fixed-assets?${new URLSearchParams({ companyId })}` : null, 'Les immobilisations ne se sont pas chargées.')

  const isRisk = category === 'RISK_CHARGE'
  const accounts = ALLOWANCE_ACCOUNTS[category]
  const natures = allowedNatures(category, accountCode)

  const chooseCategory = (next: ProvisionCategory) => {
    const account = defaultAllowanceAccount(next)
    setCategory(next)
    setAccountCode(account)
    setNature(defaultNature(next, account))
    setTaxDeductible(next === 'RISK_CHARGE' ? defaultTaxDeductible(account) : true)
  }
  const chooseAccount = (code: string) => {
    setAccountCode(code)
    setNature(defaultNature(category, code))
    if (isRisk) setTaxDeductible(defaultTaxDeductible(code))
  }
  const chooseAsset = (id: string) => {
    setFixedAssetId(id)
    const asset = assets.data?.find((a) => a.id === id)
    const derived = asset?.assetAccount ? impairmentAccountOfAsset(asset.assetAccount.code) : null
    if (derived && accounts.some((a) => a.code === derived)) chooseAccount(derived)
    if (asset && !label) setLabel(`Dépréciation ${asset.label}`)
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!label.trim() || !justification.trim() || !openedOn) {
      setError("Indiquez le libellé, l'objet et l'estimation, et la date d'origine.")
      return
    }
    setError(null)
    setSaving(true)
    const body = {
      category,
      label: label.trim(),
      justification: justification.trim(),
      accountCode,
      nature,
      taxDeductible,
      fixedAssetId: category === 'FIXED_ASSET' && fixedAssetId ? fixedAssetId : null,
      tiersCode: category === 'RECEIVABLE' ? tiersCode.trim() || null : null,
      openedOn,
      closedOn: closedOn || null,
      carriedCents: carriedCents ?? 0,
    }
    try {
      if (provision) await sendJson(`/api/provisions/${provision.id}`, 'PATCH', body, "Les modifications n'ont pas été enregistrées. Réessayez dans un instant.")
      else await sendJson('/api/provisions', 'POST', { companyId, ...body }, "La provision n'a pas été créée. Réessayez dans un instant.")
      toast.success(provision ? 'Modifications enregistrées' : isRisk ? 'Provision créée' : 'Dépréciation créée')
      onSaved()
      onOpenChange(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{provision ? `Modifier ${provision.label}` : isRisk ? 'Nouvelle provision' : 'Nouvelle dépréciation'}</DialogTitle>
        <DialogDescription>
          {isRisk
            ? 'Un risque ou une charge probable à la clôture, dont le montant ou l’échéance reste incertain (litige, garantie, remise en état).'
            : 'La perte de valeur d’un actif à la clôture\u00a0: immobilisation, stock, créance ou valeur mobilière.'}
        </DialogDescription>
      </DialogHeader>
      <form id="provision-form" onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" htmlFor="provision-category" required>
            <Select value={category} onValueChange={(v) => chooseCategory(v as ProvisionCategory)} disabled={provision !== null}>
              <SelectTrigger id="provision-category" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(isRisk ? (['RISK_CHARGE'] as ProvisionCategory[]) : IMPAIRMENT_CATEGORIES).map((c) => (
                  <SelectItem key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Compte" htmlFor="provision-account" required>
            <Select value={accountCode} onValueChange={chooseAccount}>
              <SelectTrigger id="provision-account" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(accounts.some((a) => a.code === accountCode) ? accounts : [{ code: accountCode, label: `Compte ${accountCode}` }, ...accounts]).map((a) => (
                  <SelectItem key={a.code} value={a.code}>
                    <span className="font-mono text-xs">{a.code}</span> {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        {category === 'FIXED_ASSET' ? (
          <Field label="Immobilisation" htmlFor="provision-asset" optional hint="Rattachée, sa dépréciation se calcule depuis sa valeur actuelle et sa valeur nette comptable.">
            <Select value={fixedAssetId || 'none'} onValueChange={(v) => chooseAsset(v === 'none' ? '' : v)}>
              <SelectTrigger id="provision-asset" className="w-full">
                <SelectValue placeholder="Choisissez une immobilisation" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Aucune (montant saisi à chaque clôture)</SelectItem>
                {(assets.data ?? []).map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}
        {category === 'RECEIVABLE' ? (
          <Field label="Client" htmlFor="provision-tiers" optional hint="Son compte auxiliaire (ex. C00012), pour le retrouver dans la balance âgée.">
            <Input id="provision-tiers" autoComplete="off" maxLength={40} value={tiersCode} onChange={(e) => setTiersCode(e.target.value)} />
          </Field>
        ) : null}
        <Field label="Libellé" htmlFor="provision-label" required>
          <Input id="provision-label" autoComplete="off" maxLength={200} placeholder={isRisk ? 'ex. Litige avec un fournisseur' : 'ex. Stock de marchandises démodées'} value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field
          label="Objet et estimation"
          htmlFor="provision-justification"
          required
          hint="Ce qui la justifie à la clôture et comment le montant est estimé : c'est la pièce justificative de l'écriture."
        >
          <Textarea id="provision-justification" rows={3} maxLength={4000} value={justification} onChange={(e) => setJustification(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date d'origine" htmlFor="provision-opened" required hint="L'événement qui l'a fait naître.">
            <DateInput id="provision-opened" value={openedOn} onValueChange={setOpenedOn} />
          </Field>
          <Field label="Date de fin" htmlFor="provision-closed" optional hint="Risque éteint ou actif sorti : le solde sera repris.">
            <DateInput id="provision-closed" value={closedOn} onValueChange={setClosedOn} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Résultat"
            htmlFor="provision-nature"
            help={<HelpTip term="Résultat">Où la dotation et la reprise apparaissent au compte de résultat&nbsp;: exploitation, financier ou exceptionnel.</HelpTip>}
          >
            <Select value={nature} onValueChange={(v) => setNature(v as ProvisionNature)}>
              <SelectTrigger id="provision-nature" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {natures.map((n) => (
                  <SelectItem key={n} value={n}>
                    {NATURE_LABELS[n]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Déjà comptabilisé" htmlFor="provision-carried" optional hint="Solde repris des exercices tenus avant Kledg.">
            <AmountInput id="provision-carried" value={carriedCents} onValueChange={setCarriedCents} />
          </Field>
        </div>
        <div className="flex items-start gap-3">
          <Switch id="provision-deductible" checked={taxDeductible} onCheckedChange={setTaxDeductible} />
          <label htmlFor="provision-deductible" className="text-sm">
            Déductible fiscalement
            <span className="text-muted-foreground block text-xs">
              Non déductibles&nbsp;: amendes et pénalités, indemnités de départ à la retraite, impôt sur les sociétés. Une provision non déductible se réintègre
              sur la déclaration de résultat.
            </span>
          </label>
        </div>
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
      </form>
      <DialogFooter className="max-sm:bg-background max-sm:sticky max-sm:-bottom-6 max-sm:z-10 max-sm:-mx-6 max-sm:border-t max-sm:px-6 max-sm:py-3">
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Annuler
        </Button>
        <Button type="submit" form="provision-form" loading={saving}>
          {provision ? 'Enregistrer' : isRisk ? 'Créer la provision' : 'Créer la dépréciation'}
        </Button>
      </DialogFooter>
    </>
  )
}

/**
 * The balance a provision requires at the closing of the fiscal year; for
 * a fixed asset followed in Kledg, from its current value.
 */
export function AssessmentDialog({
  provision,
  fiscalYear,
  onOpenChange,
  onSaved,
}: {
  provision: ProvisionView | null
  fiscalYear: { id: string; year: number }
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  return (
    <Dialog open={provision !== null} onOpenChange={onOpenChange}>
      <DialogContent>{provision ? <AssessmentForm key={provision.id} provision={provision} fiscalYear={fiscalYear} onOpenChange={onOpenChange} onSaved={onSaved} /> : null}</DialogContent>
    </Dialog>
  )
}

function AssessmentForm({
  provision,
  fiscalYear,
  onOpenChange,
  onSaved,
}: {
  provision: ProvisionView
  fiscalYear: { id: string; year: number }
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const fromValue = provision.category === 'FIXED_ASSET' && provision.fixedAsset !== null
  const [useCurrentValue, setUseCurrentValue] = React.useState(fromValue && (provision.assessment === null || provision.assessment.currentValueCents !== null))
  const [amountCents, setAmountCents] = React.useState<number | null>(provision.assessment?.amountCents ?? null)
  const [currentValueCents, setCurrentValueCents] = React.useState<number | null>(provision.assessment?.currentValueCents ?? null)
  const [basis, setBasis] = React.useState(provision.assessment?.basis ?? '')
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const netBookValue = provision.fixedAsset?.netBookValueCents ?? 0
  const computed = useCurrentValue && currentValueCents !== null ? fixedAssetImpairmentCents(netBookValue, currentValueCents) : null

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    const value = useCurrentValue ? currentValueCents : amountCents
    if (value === null) {
      setError(useCurrentValue ? "Indiquez la valeur actuelle de l'immobilisation." : 'Indiquez le montant requis à la clôture (0 si plus rien).')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await sendJson(
        `/api/provisions/${provision.id}/assessment`,
        'PUT',
        { fiscalYearId: fiscalYear.id, ...(useCurrentValue ? { currentValueCents: value } : { amountCents: value }), basis: basis.trim() || null },
        "L'évaluation n'a pas été enregistrée. Réessayez dans un instant.",
      )
      toast.success('Évaluation enregistrée')
      onSaved()
      onOpenChange(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Évaluer à la clôture {fiscalYear.year}</DialogTitle>
        <DialogDescription>
          {provision.label}. Solde à l&apos;ouverture&nbsp;: <Amount value={euros(provision.openingCents)} />. Kledg propose la dotation ou la reprise qui amène le
          compte {provision.accountCode} au montant requis.
        </DialogDescription>
      </DialogHeader>
      <form id="assessment-form" onSubmit={save} className="space-y-4" noValidate>
        {fromValue ? (
          <div className="flex items-start gap-3">
            <Switch id="assessment-mode" checked={useCurrentValue} onCheckedChange={setUseCurrentValue} />
            <label htmlFor="assessment-mode" className="text-sm">
              Calculer depuis la valeur actuelle
              <span className="text-muted-foreground block text-xs">
                Valeur nette comptable à la clôture {fiscalYear.year}&nbsp;: <Amount value={euros(netBookValue)} />. La dépréciation est l&apos;écart quand la valeur actuelle
                (valeur vénale ou valeur d&apos;usage, la plus élevée) est inférieure.
              </span>
            </label>
          </div>
        ) : null}
        {useCurrentValue ? (
          <Field label="Valeur actuelle" htmlFor="assessment-value" required hint={computed !== null ? `Dépréciation requise\u00a0: ${formatAmount(computed / 100)}` : undefined}>
            <AmountInput id="assessment-value" value={currentValueCents} onValueChange={setCurrentValueCents} />
          </Field>
        ) : (
          <Field label="Montant requis à la clôture" htmlFor="assessment-amount" required hint="Le solde que le compte doit avoir au dernier jour de l'exercice. 0 si le risque a disparu.">
            <AmountInput id="assessment-amount" value={amountCents} onValueChange={setAmountCents} />
          </Field>
        )}
        <Field label="Base de l'estimation" htmlFor="assessment-basis" optional hint="ex. courrier de l'avocat, devis, valeur de marché, relances restées sans réponse.">
          <Textarea id="assessment-basis" rows={2} maxLength={2000} value={basis} onChange={(e) => setBasis(e.target.value)} />
        </Field>
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
      </form>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Annuler
        </Button>
        <Button type="submit" form="assessment-form" loading={saving}>
          Enregistrer l&apos;évaluation
        </Button>
      </DialogFooter>
    </>
  )
}
