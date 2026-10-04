'use client'

/**
 * What the user tells Kledg about the approval of the accounts: the
 * decision (date, place, chair), the officers, attendance and votes, the
 * choices on the result, the size category, the management report texts
 * and the filing. Validated by the same schema as the API
 * (lib/approval/schemas.ts); nothing is prefilled with a guess, the pack
 * lists what each document still misses.
 */

import * as React from 'react'
import { Controller, useFieldArray, useForm, useWatch, type Control } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { AmountInput } from '@/components/ui/amount-input'
import { DateInput } from '@/components/ui/date-input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Amount, Field, HelpTip } from '@/components/shared'
import { ApprovalDetailsSchema, RESOLUTION_IDS, type ApprovalDetails } from '@/lib/approval/schemas'
import type { ApprovalView } from '@/lib/approval/get-approval.service'
import { SIZE_LABELS } from '@/lib/approval/size'

type FormInput = z.input<typeof ApprovalDetailsSchema>
type FormOutput = z.output<typeof ApprovalDetailsSchema>

const euros = (cents: number) => cents / 100

const STATUS_LABELS = { present: 'Présent', represented: 'Représenté', remote: 'À distance', absent: 'Absent' } as const
const YES_NO = [
  { value: 'yes', label: 'Oui' },
  { value: 'no', label: 'Non' },
]

/** A select bound to a string value; '' shows the placeholder. */
function Choice({
  id,
  value,
  onChange,
  options,
  placeholder = 'Choisir',
}: {
  id: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string; disabled?: boolean }>
  placeholder?: string
}) {
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** A boolean asked as Oui / Non, null until answered. */
function YesNo({ control, name, id }: { control: Control<FormInput>; name: 'hasAuditor' | 'groupMember' | 'filedOnline'; id: string }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Choice
          id={id}
          value={field.value === true ? 'yes' : field.value === false ? 'no' : ''}
          onChange={(v) => field.onChange(v === 'yes')}
          options={YES_NO}
        />
      )}
    />
  )
}

function NumberInput({ value, onChange, id, placeholder }: { value: number | null | undefined; onChange: (value: number | null) => void; id: string; placeholder?: string }) {
  return (
    <Input
      id={id}
      inputMode="numeric"
      autoComplete="off"
      placeholder={placeholder}
      value={value === null || value === undefined ? '' : String(value)}
      onChange={(e) => {
        const text = e.target.value.replace(/\s/g, '')
        if (text === '') return onChange(null)
        if (/^\d+$/.test(text)) onChange(Number(text))
      }}
    />
  )
}

const RESOLUTION_TITLES: Record<(typeof RESOLUTION_IDS)[number], string> = {
  approval: 'Approbation des comptes',
  agreements: 'Conventions réglementées',
  allocation: 'Affectation du résultat',
  powers: 'Pouvoirs pour les formalités',
}

const NO_VOTE = { unanimous: false, for: 0, against: 0, abstain: 0 }

/**
 * The saved details with every field the form shows present: react-hook-form
 * compares values and defaults key by key, so a field missing from the
 * defaults would read as an edit once its control registers it. The decision
 * mode shown is the regime's default until the user picks one.
 */
function formDefaults(view: ApprovalView): FormInput {
  const d = view.details
  return {
    ...d,
    decisionMode: d.decisionMode ?? view.pack.decisionMode,
    meeting: { ...d.meeting, date: d.meeting.date ?? null, convocationDate: d.meeting.convocationDate ?? null },
    chair: { name: d.chair?.name ?? null, title: d.chair?.title ?? null },
    statutoryRule: d.statutoryRule ?? null,
    votes: Object.fromEntries(view.pack.resolutions.map((r) => [r.id, d.votes[r.id] ?? NO_VOTE])),
    priorDividends: d.priorDividends ?? null,
    nonDeductibleExpensesCents: d.nonDeductibleExpensesCents ?? null,
    regulatedAgreements: d.regulatedAgreements ?? null,
    hasAuditor: d.hasAuditor ?? null,
    groupMember: d.groupMember ?? null,
    filedOnline: d.filedOnline ?? null,
    approvedOn: d.approvedOn ?? null,
    filedOn: d.filedOn ?? null,
  }
}

export function ApprovalForm({
  view,
  saving,
  onSave,
}: {
  view: ApprovalView
  saving: boolean
  onSave: (details: ApprovalDetails) => Promise<void>
}) {
  const { pack, context } = view
  const regime = pack.regime
  const defaults = React.useMemo(() => formDefaults(view), [view])
  const form = useForm<FormInput, unknown, FormOutput>({ resolver: zodResolver(ApprovalDetailsSchema), defaultValues: defaults })
  const { control, register, handleSubmit, reset, formState } = form
  const officers = useFieldArray({ control, name: 'officers' })
  const mode = useWatch({ control, name: 'decisionMode' }) ?? pack.decisionMode
  const produce = useWatch({ control, name: 'managementReport.produce' })
  const category = useWatch({ control, name: 'size.category' })

  React.useEffect(() => reset(defaults), [defaults, reset])

  React.useEffect(() => {
    if (!formState.isDirty || saving) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [formState.isDirty, saving])

  if (!regime) return null
  const sole = regime.sole
  const meetingWord = sole ? 'de la décision' : mode === 'written' ? 'limite de réponse' : "de l'assemblée"
  const suggestions = [...new Set([...view.persons.map((p) => p.name), ...pack.holders.filter((h) => h.kind === 'PHYSICAL').map((h) => h.name)])]
  const resolutionIds = pack.resolutions.map((r) => r.id)
  const previousYears = [context.fiscalYear.year - 1, context.fiscalYear.year - 2, context.fiscalYear.year - 3]
  const showReport = pack.managementReport.required === true || produce

  return (
    <form onSubmit={handleSubmit((values) => onSave(values))} className="space-y-6" noValidate>
      <datalist id="approval-people">
        {suggestions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      <Card>
        <CardHeader>
          <CardTitle>{sole ? "Décision de l'associé unique" : 'Décision des associés'}</CardTitle>
          <CardDescription>{regime.decidingBody.replace(/^./, (c) => c.toUpperCase())} approuve les comptes et décide de l&apos;affectation du résultat.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {regime.decisionModes.length > 1 ? (
            <Field label="Mode de décision" htmlFor="approval-mode" help="La consultation écrite n'est possible que si les statuts la prévoient.">
              <Controller
                control={control}
                name="decisionMode"
                render={({ field }) => (
                  <Choice
                    id="approval-mode"
                    value={field.value ?? pack.decisionMode ?? ''}
                    onChange={field.onChange}
                    options={regime.decisionModes.map((m) => ({ value: m, label: m === 'meeting' ? 'Assemblée' : 'Consultation écrite' }))}
                  />
                )}
              />
            </Field>
          ) : null}
          <Field label={`Date ${meetingWord}`} htmlFor="approval-date">
            <Controller control={control} name="meeting.date" render={({ field }) => <DateInput id="approval-date" value={field.value ?? ''} onValueChange={field.onChange} />} />
          </Field>
          {!sole && mode === 'meeting' ? (
            <>
              <Field label="Heure" htmlFor="approval-time">
                <Input id="approval-time" placeholder="ex. 10 h 00" {...register('meeting.time')} />
              </Field>
              <Field label="Lieu" htmlFor="approval-place">
                <Input id="approval-place" placeholder="ex. au siège social" {...register('meeting.place')} />
              </Field>
              <Field label="Président de séance" htmlFor="approval-chair">
                <Input id="approval-chair" list="approval-people" autoComplete="off" {...register('chair.name')} />
              </Field>
              <Field label="Secrétaire" htmlFor="approval-secretary" optional>
                <Input id="approval-secretary" list="approval-people" autoComplete="off" {...register('secretary')} />
              </Field>
            </>
          ) : null}
          {!sole ? (
            <Field
              label={mode === 'written' ? "Date d'envoi de la consultation" : "Date d'envoi de la convocation"}
              htmlFor="approval-convocation"
              hint={pack.deadlines.convocation ? `Au plus tard le ${pack.deadlines.convocation.split('-').reverse().join('/')}` : undefined}
            >
              <Controller
                control={control}
                name="meeting.convocationDate"
                render={({ field }) => <DateInput id="approval-convocation" value={field.value ?? ''} onValueChange={field.onChange} />}
              />
            </Field>
          ) : null}
          {regime.majority === 'sarl' || regime.majority === 'sa' ? (
            <div className="flex items-center gap-2 sm:col-span-2">
              <Controller
                control={control}
                name="meeting.secondCall"
                render={({ field }) => <Checkbox id="approval-second" checked={Boolean(field.value)} onCheckedChange={(c) => field.onChange(c === true)} />}
              />
              <Label htmlFor="approval-second">{regime.majority === 'sarl' ? 'Deuxième consultation' : 'Deuxième convocation'}</Label>
            </div>
          ) : null}
          <Field label="Ville du greffe (RCS)" htmlFor="approval-rcs" hint="Elle figure sur l'extrait Kbis.">
            <Input id="approval-rcs" placeholder="ex. Lyon" {...register('rcsCity')} />
          </Field>
          <Field label="Ville de signature" htmlFor="approval-city">
            <Input id="approval-city" placeholder="ex. Lyon" {...register('signatureCity')} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dirigeants</CardTitle>
          <CardDescription>
            Le {regime.officerTitle.singular} signe les documents.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {officers.fields.map((f, index) => (
            <div key={f.id} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <Field label="Nom" htmlFor={`officer-${index}`}>
                <Input id={`officer-${index}`} list="approval-people" autoComplete="off" {...register(`officers.${index}.name`)} />
              </Field>
              <Field label="Qualité" htmlFor={`officer-title-${index}`} optional>
                <Input id={`officer-title-${index}`} placeholder={regime.officerTitle.singular} {...register(`officers.${index}.title`)} />
              </Field>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Retirer ce dirigeant" title="Retirer" onClick={() => officers.remove(index)}>
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))}
          {officers.fields.length < 10 ? (
            <Button type="button" variant="outline" size="sm" onClick={() => officers.append({ name: '', title: '' })}>
              <Plus aria-hidden />
              Ajouter un dirigeant
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{sole ? 'Associé unique' : 'Présence et votes'}</CardTitle>
          <CardDescription>
            {sole
              ? 'Les associés viennent des informations de la société.'
              : `Une voix par ${regime.form === 'SA' || regime.form === 'SAS' ? 'action' : 'part'}. Les associés et leurs titres viennent des informations de la société.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Controller
            control={control}
            name="attendance"
            render={({ field }) => {
              const rows = field.value ?? []
              const set = (shareholderId: string, patch: { status?: 'present' | 'represented' | 'remote' | 'absent'; proxy?: string }) => {
                const current = rows.find((r) => r.shareholderId === shareholderId)
                const next = { shareholderId, status: current?.status ?? 'present', proxy: current?.proxy ?? null, ...patch }
                field.onChange([...rows.filter((r) => r.shareholderId !== shareholderId), next])
              }
              return (
                <ul className="divide-y rounded-md border">
                  {pack.holders.map((h) => {
                    const row = rows.find((r) => r.shareholderId === h.id)
                    return (
                      <li key={h.id} className="grid gap-3 px-3 py-3 sm:grid-cols-[1fr_10rem_1fr] sm:items-end">
                        <div className="text-sm">
                          <p className="font-medium">{h.name}</p>
                          <p className="text-muted-foreground num text-xs">{h.shares === null ? 'Nombre de titres non renseigné' : `${h.shares.toLocaleString('fr-FR')} titres`}</p>
                        </div>
                        {sole ? (
                          <span className="text-muted-foreground text-sm">Associé unique</span>
                        ) : (
                          <Field label="Présence" htmlFor={`presence-${h.id}`}>
                            <Choice
                              id={`presence-${h.id}`}
                              value={row?.status ?? ''}
                              onChange={(v) => set(h.id, { status: v as 'present' })}
                              options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))}
                            />
                          </Field>
                        )}
                        {sole && h.kind === 'PHYSICAL' ? null : (
                          <Field label={sole ? 'Représentant' : 'Représenté par'} htmlFor={`proxy-${h.id}`} optional={!sole}>
                            <Input
                              id={`proxy-${h.id}`}
                              list="approval-people"
                              autoComplete="off"
                              value={row?.proxy ?? ''}
                              onChange={(e) => set(h.id, { proxy: e.target.value, ...(sole ? { status: 'present' as const } : {}) })}
                            />
                          </Field>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )
            }}
          />

          {regime.majority === 'statutes' ? (
            <Controller
              control={control}
              name="statutoryRule"
              render={({ field }) => {
                const rule = field.value
                const set = (patch: Partial<NonNullable<typeof rule>>) =>
                  field.onChange({ kind: 'majority', base: 'cast', percent: 50, quorumPercent: null, article: null, ...(rule ?? {}), ...patch })
                return (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label="Règle des statuts"
                      htmlFor="rule-kind"
                      help={regime.form === 'SCI' ? "Sans clause des statuts, les décisions d'une société civile se prennent à l'unanimité (C. civ. art. 1852)." : 'Les statuts de la SAS fixent la majorité des décisions collectives (C. com. art. L. 227-9).'}
                    >
                      <Choice
                        id="rule-kind"
                        value={rule?.kind ?? ''}
                        onChange={(v) => set({ kind: v as 'majority' })}
                        options={[
                          { value: 'majority', label: 'Majorité' },
                          { value: 'unanimity', label: 'Unanimité des associés' },
                        ]}
                      />
                    </Field>
                    <Field label="Article des statuts" htmlFor="rule-article" optional>
                      <Input id="rule-article" placeholder="ex. 18" value={rule?.article ?? ''} onChange={(e) => set({ article: e.target.value })} />
                    </Field>
                    {rule?.kind === 'majority' ? (
                      <>
                        <Field label="Voix comptées" htmlFor="rule-base">
                          <Choice
                            id="rule-base"
                            value={rule.base ?? 'cast'}
                            onChange={(v) => set({ base: v as 'cast' })}
                            options={[
                              { value: 'cast', label: 'Voix exprimées' },
                              { value: 'present', label: 'Voix des présents et représentés' },
                              { value: 'all', label: 'Voix de tous les associés' },
                            ]}
                          />
                        </Field>
                        <Field label="Plus de (%)" htmlFor="rule-percent">
                          <NumberInput id="rule-percent" value={rule.percent ?? 50} onChange={(v) => set({ percent: v ?? 50 })} />
                        </Field>
                        <Field label="Quorum (%)" htmlFor="rule-quorum" optional>
                          <NumberInput id="rule-quorum" value={rule.quorumPercent ?? null} onChange={(v) => set({ quorumPercent: v })} />
                        </Field>
                      </>
                    ) : null}
                  </div>
                )
              }}
            />
          ) : null}

          {!sole ? (
            <div className="space-y-3">
              <h3 className="text-sm font-medium">Résultat des votes</h3>
              {resolutionIds.map((id) => (
                <Controller
                  key={id}
                  control={control}
                  name={`votes.${id}`}
                  render={({ field }) => {
                    const vote = field.value ?? { unanimous: false, for: 0, against: 0, abstain: 0 }
                    const set = (patch: Partial<typeof vote>) => field.onChange({ ...vote, ...patch })
                    return (
                      <fieldset className="grid gap-3 rounded-md border px-3 py-3 sm:grid-cols-4 sm:items-end">
                        <legend className="px-1 text-sm font-medium">{RESOLUTION_TITLES[id]}</legend>
                        <div className="flex items-center gap-2 sm:col-span-4">
                          <Checkbox id={`vote-unanimous-${id}`} checked={Boolean(vote.unanimous)} onCheckedChange={(c) => set({ unanimous: c === true })} />
                          <Label htmlFor={`vote-unanimous-${id}`}>Adoptée à l&apos;unanimité des présents et représentés</Label>
                        </div>
                        {!vote.unanimous ? (
                          <>
                            <Field label="Pour" htmlFor={`vote-for-${id}`}>
                              <NumberInput id={`vote-for-${id}`} value={vote.for ?? 0} onChange={(v) => set({ for: v ?? 0 })} />
                            </Field>
                            <Field label="Contre" htmlFor={`vote-against-${id}`}>
                              <NumberInput id={`vote-against-${id}`} value={vote.against ?? 0} onChange={(v) => set({ against: v ?? 0 })} />
                            </Field>
                            <Field label="Abstentions" htmlFor={`vote-abstain-${id}`}>
                              <NumberInput id={`vote-abstain-${id}`} value={vote.abstain ?? 0} onChange={(v) => set({ abstain: v ?? 0 })} />
                            </Field>
                          </>
                        ) : null}
                      </fieldset>
                    )
                  }}
                />
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Résultat et affectation</CardTitle>
          <CardDescription>
            Résultat de l&apos;exercice&nbsp;: <Amount value={euros(pack.resultCents)} tone="signed" />. La réserve légale est calculée par Kledg
            {pack.plan.legalReserveRequired ? ' (5 % du bénéfice, jusqu’au dixième du capital, C. com. art. L. 232-10)' : ' (non applicable à cette forme)'}.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Dividendes" htmlFor="alloc-dividends" hint={pack.resultCents > 0 ? <>Distribuable&nbsp;: <Amount value={euros(pack.plan.distributableCents)} /></> : undefined}>
            <Controller
              control={control}
              name="allocation.dividendsCents"
              render={({ field }) => <AmountInput id="alloc-dividends" value={field.value ?? 0} onValueChange={(c) => field.onChange(c ?? 0)} />}
            />
          </Field>
          <Field label="Autres réserves" htmlFor="alloc-reserves">
            <Controller
              control={control}
              name="allocation.otherReservesCents"
              render={({ field }) => <AmountInput id="alloc-reserves" value={field.value ?? 0} onValueChange={(c) => field.onChange(c ?? 0)} />}
            />
          </Field>
          {pack.plan.errors.length > 0 && pack.resultCents !== 0 ? <p className="text-destructive text-sm sm:col-span-2">{pack.plan.errors.join(' ')}</p> : null}
          {pack.resultCents > 0 ? (
            <p className="text-muted-foreground text-sm sm:col-span-2">
              Réserve légale <Amount value={euros(pack.plan.legalReserveCents)} />, report à nouveau <Amount value={euros(pack.plan.retainedEarningsCents)} />.
            </p>
          ) : null}

          {pack.priorDividendsRequired ? (
            <Controller
              control={control}
              name="priorDividends"
              render={({ field }) => {
                const rows = field.value ?? null
                const amountOf = (year: number) => rows?.find((r) => r.year === year)?.amountCents ?? 0
                return (
                  <fieldset className="space-y-3 sm:col-span-2">
                    <legend className="flex items-center gap-1 text-sm font-medium">
                      Dividendes des trois exercices précédents
                      <HelpTip term="Article 243 bis du CGI">Le procès-verbal rappelle les dividendes distribués au titre des trois exercices précédents.</HelpTip>
                    </legend>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="prior-answered"
                        checked={rows !== null}
                        onCheckedChange={(c) => field.onChange(c === true ? previousYears.map((year) => ({ year, amountCents: 0 })) : null)}
                      />
                      <Label htmlFor="prior-answered">Renseigner les montants (0 quand aucun dividende)</Label>
                    </div>
                    {rows !== null ? (
                      <div className="grid gap-3 sm:grid-cols-3">
                        {previousYears.map((year) => (
                          <Field key={year} label={`Exercice ${year}`} htmlFor={`prior-${year}`}>
                            <AmountInput
                              id={`prior-${year}`}
                              value={amountOf(year)}
                              onValueChange={(c) => field.onChange(previousYears.map((y) => ({ year: y, amountCents: y === year ? (c ?? 0) : amountOf(y) })))}
                            />
                          </Field>
                        ))}
                      </div>
                    ) : null}
                  </fieldset>
                )
              }}
            />
          ) : null}

          {pack.priorDividendsRequired ? (
            <Field label="Dépenses non déductibles (CGI art. 39, 4)" htmlFor="approval-nd" optional hint="Dépenses somptuaires à approuver ; 0 s'il n'y en a pas.">
              <Controller
                control={control}
                name="nonDeductibleExpensesCents"
                render={({ field }) => <AmountInput id="approval-nd" value={field.value ?? null} onValueChange={(c) => field.onChange(c)} />}
              />
            </Field>
          ) : null}
          {regime.regulatedAgreements ? (
            <Field label={`Conventions réglementées (art. ${regime.regulatedAgreements.article})`} htmlFor="approval-agreements">
              <Controller
                control={control}
                name="regulatedAgreements"
                render={({ field }) => (
                  <Choice
                    id="approval-agreements"
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    options={[
                      { value: 'none', label: 'Aucune convention conclue' },
                      { value: 'some', label: 'Des conventions ont été conclues' },
                    ]}
                  />
                )}
              />
            </Field>
          ) : null}
          <Field label="Commissaire aux comptes" htmlFor="approval-auditor">
            <YesNo control={control} name="hasAuditor" id="approval-auditor" />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Taille de la société et dépôt</CardTitle>
          <CardDescription>
            D&apos;après les écritures&nbsp;: chiffre d&apos;affaires <Amount value={euros(context.figures.revenueCents)} />, total du bilan <Amount value={euros(context.figures.totalAssetsCents)} />. Catégorie suggérée&nbsp;:{' '}
            {SIZE_LABELS[pack.size.proposed].toLowerCase()}
            {pack.size.certain ? '' : ', à confirmer'}.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Effectif moyen" htmlFor="approval-employees">
            <Controller control={control} name="size.employees" render={({ field }) => <NumberInput id="approval-employees" value={field.value ?? null} onChange={field.onChange} />} />
          </Field>
          <Field
            label="Catégorie retenue"
            htmlFor="approval-category"
            help="Deux des trois seuils (bilan, chiffre d'affaires, effectif) sur deux exercices consécutifs (C. com. art. L. 123-16, D. 123-200)."
          >
            <Controller
              control={control}
              name="size.category"
              render={({ field }) => (
                <Choice id="approval-category" value={field.value ?? ''} onChange={field.onChange} options={Object.entries(SIZE_LABELS).map(([value, label]) => ({ value, label }))} />
              )}
            />
          </Field>
          {regime.filing.required ? (
            <>
              <Field label="Société d'un groupe qui consolide ses comptes" htmlFor="approval-group">
                <YesNo control={control} name="groupMember" id="approval-group" />
              </Field>
              <Field label="Publication" htmlFor="approval-confidentiality" help="Option de confidentialité au dépôt (C. com. art. L. 232-25).">
                <Controller
                  control={control}
                  name="confidentiality"
                  render={({ field }) => (
                    <Choice
                      id="approval-confidentiality"
                      value={field.value ?? 'none'}
                      onChange={field.onChange}
                      options={pack.confidentiality.choices.map((c) => ({ value: c.value, label: c.label, disabled: !c.available && c.value !== field.value }))}
                    />
                  )}
                />
              </Field>
              <Field label="Dépôt en ligne" htmlFor="approval-online" hint="Deux mois au lieu d'un pour déposer.">
                <YesNo control={control} name="filedOnline" id="approval-online" />
              </Field>
            </>
          ) : null}
          <div className="flex items-center gap-2 sm:col-span-2">
            <Controller
              control={control}
              name="excludedEntity"
              render={({ field }) => <Checkbox id="approval-excluded" checked={Boolean(field.value)} onCheckedChange={(c) => field.onChange(c === true)} />}
            />
            <Label htmlFor="approval-excluded">Établissement de crédit, assurance, société cotée ou organisme faisant appel à la générosité publique</Label>
          </div>
          <Field label="Date d'approbation des comptes" htmlFor="approval-approved" hint="Elle fixe la date limite de dépôt dans les échéances.">
            <Controller control={control} name="approvedOn" render={({ field }) => <DateInput id="approval-approved" value={field.value ?? ''} onValueChange={field.onChange} />} />
          </Field>
          {regime.filing.required ? (
            <Field label="Date de dépôt au greffe" htmlFor="approval-filed">
              <Controller control={control} name="filedOn" render={({ field }) => <DateInput id="approval-filed" value={field.value ?? ''} onValueChange={field.onChange} />} />
            </Field>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{regime.form === 'SCI' ? 'Rapport écrit de la gérance' : 'Rapport de gestion'}</CardTitle>
          <CardDescription>{pack.managementReport.reason || 'Indiquez la catégorie de la société.'}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {pack.managementReport.required !== true ? (
            <div className="flex items-center gap-2">
              <Controller
                control={control}
                name="managementReport.produce"
                render={({ field }) => <Checkbox id="report-produce" checked={Boolean(field.value)} onCheckedChange={(c) => field.onChange(c === true)} />}
              />
              <Label htmlFor="report-produce">Établir le rapport quand même</Label>
            </div>
          ) : null}
          {showReport || category === 'medium' || category === 'large' ? (
            <>
              <Field label="Activité et situation de la société" htmlFor="report-activity">
                <Textarea id="report-activity" rows={5} {...register('managementReport.activity')} />
              </Field>
              {regime.form !== 'SCI' ? (
                <>
                  <Field label="Événements importants depuis la clôture" htmlFor="report-events" hint="Écrivez « Aucun » s'il n'y en a pas.">
                    <Textarea id="report-events" rows={3} {...register('managementReport.postClosingEvents')} />
                  </Field>
                  <Field label="Recherche et développement" htmlFor="report-research" hint="Écrivez « Aucune » s'il n'y en a pas.">
                    <Textarea id="report-research" rows={3} {...register('managementReport.research')} />
                  </Field>
                </>
              ) : null}
              <Field label="Évolution prévisible et perspectives" htmlFor="report-outlook">
                <Textarea id="report-outlook" rows={3} {...register('managementReport.outlook')} />
              </Field>
            </>
          ) : null}
        </CardContent>
      </Card>

      {formState.isDirty ? (
        <div className="bg-background sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-sm">
          <span className="text-sm">Modifications non enregistrées</span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => reset(defaults)}>
              Annuler les modifications
            </Button>
            <Button type="submit" loading={saving}>
              Enregistrer
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex justify-end">
          <Button type="submit" variant="outline" loading={saving}>
            Enregistrer
          </Button>
        </div>
      )}
    </form>
  )
}
