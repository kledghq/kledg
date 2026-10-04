"use client"

import * as React from "react"
import { Lock, Pencil, Scale, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { StatusBadge } from "@/components/shared"

interface FiscalYear {
  id: string
  year: number
  closingDay: number | null
  closingMonth: number | null
  startDate: string
  endDate: string
  isClosed: boolean
}

interface FiscalYearsTableProps {
  data: FiscalYear[]
  onClose?: (fiscalYearId: string) => void
  onEdit?: (fiscalYear: FiscalYear) => void
  onDelete?: (fiscalYear: FiscalYear) => void
  /** "Affecter le résultat" of the previous year, on an open year. */
  onAllocate?: (fiscalYear: FiscalYear) => void
  formatDateShort: (dateString: string) => string
}

/** Icon button with a visible tooltip and the same accessible name. */
function RowAction({
  label,
  shortLabel,
  onClick,
  destructive,
  children,
}: {
  label: string
  /** Shown next to the icon in the stacked layout, where tooltips need a hover. */
  shortLabel?: string
  onClick: () => void
  destructive?: boolean
  children: React.ReactNode
}) {
  if (shortLabel) {
    return (
      <Button
        variant="ghost"
        size="xs"
        onClick={onClick}
        aria-label={label}
        className={destructive ? "text-destructive hover:bg-destructive/10 hover:text-destructive" : undefined}
      >
        {children}
        {shortLabel}
      </Button>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClick}
          aria-label={label}
          className={destructive ? "text-destructive hover:bg-destructive/10 hover:text-destructive" : undefined}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function closingDateLabel(fiscalYear: FiscalYear): string | null {
  if (!fiscalYear.closingDay || !fiscalYear.closingMonth) return null
  const month = new Date(2000, fiscalYear.closingMonth - 1).toLocaleDateString("fr-FR", { month: "long" })
  return `${fiscalYear.closingDay} ${month}`
}

function FiscalYearStatus({ fiscalYear }: { fiscalYear: FiscalYear }) {
  return (
    <StatusBadge
      tone={fiscalYear.isClosed ? "neutral" : "success"}
      title={
        fiscalYear.isClosed
          ? "La clôture est définitive\u00a0: les écritures de l'exercice ne peuvent plus être modifiées."
          : undefined
      }
    >
      {fiscalYear.isClosed ? "Clôturé (définitif)" : "Ouvert"}
    </StatusBadge>
  )
}

/**
 * The company's fiscal years, most recent first. A company has a handful of
 * them, so there is no pagination. Below 1024px each year is a block with its
 * actions in reach; from 1024px a table.
 */
export function FiscalYearsTable({
  data,
  onClose,
  onEdit,
  onDelete,
  onAllocate,
  formatDateShort,
}: FiscalYearsTableProps) {
  const rows = React.useMemo(() => [...data].sort((a, b) => b.year - a.year), [data])

  const actionsOf = (fiscalYear: FiscalYear, labeled = false) => (
    <>
      {!fiscalYear.isClosed && onClose && (
        <Button variant="outline" size="xs" onClick={() => onClose(fiscalYear.id)}>
          <Lock aria-hidden />
          Clôturer
        </Button>
      )}
      {!fiscalYear.isClosed && onAllocate && (
        <RowAction
          label={`Affecter le résultat ${fiscalYear.year - 1}`}
          shortLabel={labeled ? `Résultat ${fiscalYear.year - 1}` : undefined}
          onClick={() => onAllocate(fiscalYear)}
        >
          <Scale aria-hidden />
        </RowAction>
      )}
      {!fiscalYear.isClosed && onEdit && (
        <RowAction label={`Modifier l'exercice ${fiscalYear.year}`} shortLabel={labeled ? 'Modifier' : undefined} onClick={() => onEdit(fiscalYear)}>
          <Pencil aria-hidden />
        </RowAction>
      )}
      {onDelete && !fiscalYear.isClosed && (
        <RowAction
          label={`Supprimer l'exercice ${fiscalYear.year}`}
          shortLabel={labeled ? 'Supprimer' : undefined}
          onClick={() => onDelete(fiscalYear)}
          destructive
        >
          <Trash2 aria-hidden />
        </RowAction>
      )}
    </>
  )

  return (
    <div className="bg-card overflow-hidden rounded-lg border">
      <ul className="divide-y lg:hidden" aria-label="Exercices">
        {rows.length === 0 ? (
          <li className="text-muted-foreground px-4 py-10 text-center text-sm">Aucun exercice pour cette société.</li>
        ) : (
          rows.map((fiscalYear) => {
            const closing = closingDateLabel(fiscalYear)
            return (
              <li key={fiscalYear.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">Exercice {fiscalYear.year}</span>
                  <FiscalYearStatus fiscalYear={fiscalYear} />
                </div>
                <div className="text-muted-foreground num text-sm">
                  Du {formatDateShort(fiscalYear.startDate)} au {formatDateShort(fiscalYear.endDate)}
                  {closing ? <span className="block text-xs">Clôture le {closing}</span> : null}
                </div>
                {fiscalYear.isClosed ? null : (
                  <div className="flex flex-wrap items-center gap-1">{actionsOf(fiscalYear, true)}</div>
                )}
              </li>
            )
          })
        )}
      </ul>
      <Table containerClassName="hidden lg:block">
        <TableHeader>
          <TableRow>
            <TableHead>Exercice</TableHead>
            <TableHead>Période</TableHead>
            <TableHead className="hidden xl:table-cell">Date de clôture</TableHead>
            <TableHead>Statut</TableHead>
            <TableHead className="text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableEmpty colSpan={5}>Aucun exercice pour cette société.</TableEmpty>
          ) : (
            rows.map((fiscalYear) => (
              <TableRow key={fiscalYear.id}>
                <TableCell className="font-medium">Exercice {fiscalYear.year}</TableCell>
                <TableCell className="num">
                  Du {formatDateShort(fiscalYear.startDate)} au {formatDateShort(fiscalYear.endDate)}
                </TableCell>
                <TableCell className="hidden xl:table-cell">
                  {closingDateLabel(fiscalYear) ?? <span className="text-muted-foreground">Non renseignée</span>}
                </TableCell>
                <TableCell>
                  <FiscalYearStatus fiscalYear={fiscalYear} />
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">{actionsOf(fiscalYear)}</div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
