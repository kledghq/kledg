'use client'

import { Lock } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableSkeleton } from '@/components/ui/table'
import { Amount, EmptyState, HelpTip, PageHeader, StatusBadge } from '@/components/shared'
import { cn } from '@/lib/utils'
import { FIGURE_ROWS, FLOW_CATEGORY_LABELS, INDICATIVE_NOTICE } from '@/lib/group/labels'
import type { GroupView } from '@/lib/group/get-group-view.service'
import { ExportButtons, GroupFiscalYear, LoadError, Notice, PerimeterNotes, ownership, useGroupReport, useReportUrl } from './space'

const cents = (value: number | null | undefined, signed = false) =>
  value === null || value === undefined ? <span className="text-muted-foreground">-</span> : <Amount value={value / 100} className={cn(signed && value < 0 && 'text-destructive')} />

/**
 * Éliminations of the group space: the vue combinée (each company at 100 %,
 * the aggregate, the intragroup flows removed once, the figures after
 * eliminations) and the flows found in the books (docs/vue-groupe.md).
 */
export function GroupEliminationsPage() {
  const url = useReportUrl('view')
  const view = useGroupReport<GroupView>(url, "La vue combinée ne s'est pas chargée. Réessayez dans un instant.")
  const data = view.data
  const loading = view.loading || !data
  return (
    <div className="space-y-6">
      <PageHeader
        title="Éliminations"
        description="Les chiffres de chaque société, leur total agrégé, les flux entre sociétés du groupe retirés une fois et les chiffres après éliminations."
        actions={<ExportButtons report="combined" disabled={!data} />}
      />
      <GroupFiscalYear hint="Écritures validées de chaque société, écriture de clôture exclue. Chaque filiale est lue avec vos droits dans cette filiale." />
      {view.error ? (
        <LoadError message={view.error} onRetry={view.retry} />
      ) : (
        <>
          <Notice>{INDICATIVE_NOTICE}</Notice>
          {data ? <PerimeterNotes warnings={data.warnings} unreachable={data.unreachable} /> : null}
          <CombinedTable view={data} loading={loading} />
          <FlowsTab view={data} loading={loading} />
        </>
      )}
    </div>
  )
}

function MemberHeading({ name, role, bp }: { name: string; role: 'holding' | 'subsidiary'; bp: number | null }) {
  return (
    <span className="block">
      <span className="block whitespace-normal">{name}</span>
      <span className="text-muted-foreground block text-xs font-normal">{role === 'holding' ? 'Holding' : `Détenue à ${ownership(bp) ?? '?'}`}</span>
    </span>
  )
}

function CombinedTable({ view, loading }: { view: GroupView | null; loading: boolean }) {
  return (
    <Card aria-busy={loading || undefined}>
        <CardHeader>
          <CardTitle>
            <h2>Chiffres par société</h2>
          </CardTitle>
          <CardDescription>
            Chaque société à 100 %, puis le total agrégé, les flux intragroupe retirés et le total après éliminations. Le pourcentage de détention est indiqué, jamais appliqué.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-48">Indicateur</TableHead>
                  {view?.members.map((m) => (
                    <TableHead key={m.id} numeric className="min-w-36 align-bottom">
                      <MemberHeading name={m.name} role={m.role} bp={m.ownershipBp} />
                    </TableHead>
                  ))}
                  <TableHead numeric className="min-w-36 align-bottom">
                    Total agrégé
                  </TableHead>
                  <TableHead numeric className="min-w-36 align-bottom">
                    <span className="inline-flex items-center gap-1">
                      Éliminations
                      <HelpTip term="Éliminations">
                        Les produits et les charges entre deux sociétés lisibles du groupe, les dividendes reçus d&apos;une filiale et les créances et dettes réciproques,
                        retirés une fois du total.
                      </HelpTip>
                    </span>
                  </TableHead>
                  <TableHead numeric className="min-w-36 align-bottom">
                    Après éliminations
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && !view ? (
                  <TableSkeleton columns={5} />
                ) : view ? (
                  FIGURE_ROWS.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell>
                        <span className="block">{row.label}</span>
                        <span className="text-muted-foreground block text-xs">{row.hint}</span>
                      </TableCell>
                      {view.members.map((m) => (
                        <TableCell key={m.id} numeric>
                          {m.figures ? cents(m.figures[row.key], row.key === 'resultatCents') : <span className="text-muted-foreground">Aucun exercice</span>}
                        </TableCell>
                      ))}
                      <TableCell numeric>{cents(view.combined[row.key], row.key === 'resultatCents')}</TableCell>
                      <TableCell numeric className="font-normal">
                        {view.eliminations.effect[row.key] === 0 ? <span className="text-muted-foreground">-</span> : cents(view.eliminations.effect[row.key])}
                      </TableCell>
                      <TableCell numeric className="font-semibold">
                        {cents(view.afterEliminations[row.key], row.key === 'resultatCents')}
                      </TableCell>
                    </TableRow>
                  ))
                ) : null}
              </TableBody>
            </Table>
          </div>
          {view && view.unreachable.length > 0 ? (
            <ul className="mt-4 space-y-1 text-sm">
              {view.unreachable.map((u, i) => (
                <li key={`${u.name ?? 'hidden'}-${i}`} className="text-muted-foreground flex items-start gap-2">
                  <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <span>
                    {u.name
                      ? `${u.name} : votre rôle dans cette filiale ne permet pas de lire ses états.`
                      : 'Une filiale du groupe n’est pas accessible avec votre compte : demandez à en être membre pour la voir ici.'}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

  )
}

function FlowsTab({ view, loading }: { view: GroupView | null; loading: boolean }) {
  if (loading && !view) {
    return (
      <Card aria-busy>
        <CardContent>
          <Table>
            <TableBody>
              <TableSkeleton columns={5} />
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    )
  }
  if (!view) return null
  const names = new Map(view.members.map((m) => [m.id, m.name]))
  const nameOf = (id: string) => names.get(id) ?? 'Société du groupe'
  const perimeter = new Set(view.members.filter((m) => m.figures).map((m) => m.id))
  const { operations, dividends, balances } = view.eliminations
  if (view.flows.length === 0) {
    return (
      <EmptyState
        bordered
        title="Aucun flux intragroupe trouvé"
        description="Kledg cherche les factures entre sociétés du groupe (par SIREN), les frais de gestion, les comptes courants 451 et 455, les prêts 267 et 168 et les dividendes 761 dont le tiers ou le libellé nomme une société du groupe."
      />
    )
  }
  return (
    <>
      {operations.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Opérations entre sociétés</h2>
            </CardTitle>
            <CardDescription>Produits enregistrés par la société qui facture, charges enregistrées par celle qui reçoit la facture. Un écart signale un côté manquant ou différent.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Société qui facture</TableHead>
                    <TableHead>Société facturée</TableHead>
                    <TableHead className="hidden md:table-cell">Nature</TableHead>
                    <TableHead numeric>Produits</TableHead>
                    <TableHead numeric>Charges</TableHead>
                    <TableHead numeric>Écart</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {operations.map((p) => (
                    <TableRow key={`${p.sellerId}-${p.buyerId}`}>
                      <TableCell className="whitespace-normal">{nameOf(p.sellerId)}</TableCell>
                      <TableCell className="whitespace-normal">{nameOf(p.buyerId)}</TableCell>
                      <TableCell className="hidden whitespace-normal md:table-cell">{p.categories.map((c) => FLOW_CATEGORY_LABELS[c]).join(', ')}</TableCell>
                      <TableCell numeric>{cents(p.revenueCents)}</TableCell>
                      <TableCell numeric>{cents(p.chargeCents)}</TableCell>
                      <TableCell numeric className={cn(p.gapCents !== 0 && 'text-warning')}>
                        {p.gapCents === 0 ? <span className="text-muted-foreground">-</span> : <Amount value={p.gapCents / 100} />}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {dividends.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Dividendes reçus d&apos;une société du groupe</h2>
            </CardTitle>
            <CardDescription>Retirés du résultat combiné&nbsp;: le résultat de la filiale qui les verse y est déjà.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Société qui reçoit</TableHead>
                    <TableHead>Société qui verse</TableHead>
                    <TableHead numeric>Montant</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dividends.map((d) => (
                    <TableRow key={`${d.receiverId}-${d.payerId}`}>
                      <TableCell className="whitespace-normal">{nameOf(d.receiverId)}</TableCell>
                      <TableCell className="whitespace-normal">{nameOf(d.payerId)}</TableCell>
                      <TableCell numeric>{cents(d.cents)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {balances.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Créances et dettes réciproques</h2>
            </CardTitle>
            <CardDescription>En fin d&apos;exercice. Le plus petit des deux montants est retiré de l&apos;actif et du passif combinés&nbsp;; la différence est un écart à justifier.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Créancier</TableHead>
                    <TableHead>Débiteur</TableHead>
                    <TableHead className="hidden md:table-cell">Nature</TableHead>
                    <TableHead numeric>Créance</TableHead>
                    <TableHead numeric>Dette</TableHead>
                    <TableHead numeric>Éliminé</TableHead>
                    <TableHead numeric>Écart</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {balances.map((b) => (
                    <TableRow key={`${b.creditorId}-${b.debtorId}`}>
                      <TableCell className="whitespace-normal">{nameOf(b.creditorId)}</TableCell>
                      <TableCell className="whitespace-normal">{nameOf(b.debtorId)}</TableCell>
                      <TableCell className="hidden whitespace-normal md:table-cell">{b.categories.map((c) => FLOW_CATEGORY_LABELS[c]).join(', ')}</TableCell>
                      <TableCell numeric>{cents(b.receivableCents)}</TableCell>
                      <TableCell numeric>{cents(b.payableCents)}</TableCell>
                      <TableCell numeric>{cents(b.eliminatedCents)}</TableCell>
                      <TableCell numeric className={cn(b.gapCents !== 0 && 'text-warning')}>
                        {b.gapCents === 0 ? <span className="text-muted-foreground">-</span> : <Amount value={b.gapCents / 100} />}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Lignes trouvées dans les livres</h2>
          </CardTitle>
          <CardDescription>Chaque ligne d&apos;une société sur une autre société du groupe, et comment Kledg l&apos;a reconnue.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dans les livres de</TableHead>
                  <TableHead>Avec</TableHead>
                  <TableHead className="hidden lg:table-cell">Nature</TableHead>
                  <TableHead className="hidden md:table-cell">Référence</TableHead>
                  <TableHead numeric>Montant</TableHead>
                  <TableHead>Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.flows.map((f, i) => (
                  <TableRow key={`${f.companyId}-${f.counterpartyId}-${f.accountCode}-${f.reference}-${i}`}>
                    <TableCell className="whitespace-normal">{nameOf(f.companyId)}</TableCell>
                    <TableCell className="whitespace-normal">{nameOf(f.counterpartyId)}</TableCell>
                    <TableCell className="hidden whitespace-normal lg:table-cell">{FLOW_CATEGORY_LABELS[f.category]}</TableCell>
                    <TableCell className="hidden whitespace-normal md:table-cell">
                      <span className="font-mono text-xs">{f.accountCode}</span> {f.reference}
                      <span className="text-muted-foreground block text-xs">
                        {f.source === 'tiers' ? 'Reconnu au SIREN du tiers' : f.source === 'invoice' ? 'Facture, SIREN de la société' : 'Reconnu au libellé'}
                      </span>
                    </TableCell>
                    <TableCell numeric>{cents(f.cents)}</TableCell>
                    <TableCell>
                      {!f.inBooks ? (
                        <StatusBadge tone="warning">Non comptabilisé</StatusBadge>
                      ) : perimeter.has(f.companyId) && perimeter.has(f.counterpartyId) ? (
                        <StatusBadge tone="success">Éliminé</StatusBadge>
                      ) : (
                        <StatusBadge tone="neutral">Hors périmètre</StatusBadge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  )
}

