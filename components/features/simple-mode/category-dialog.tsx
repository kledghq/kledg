'use client'

import * as React from 'react'
import { Check } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FileInput } from '@/components/ui/file-input'
import { Textarea } from '@/components/ui/textarea'
import { Field, formatAmount } from '@/components/shared'
import { cn } from '@/lib/utils'
import { categoriesForSide, CATEGORY_GROUPS, findCategory, searchText } from '@/lib/simple/categories'
import { questionApplies, type Answers } from '@/lib/simple/posting'
import type { ExpenseToReview } from '@/lib/simple/expenses-to-review.service'

export interface CategoryChoice {
  categoryId: string
  answers: Answers
  note: string
}

interface CategoryDialogProps {
  expense: ExpenseToReview | null
  onOpenChange: (open: boolean) => void
  onConfirm: (expense: ExpenseToReview, choice: CategoryChoice) => Promise<void>
  onReceipt: (expense: ExpenseToReview, file: File) => Promise<void>
  initialNote: string
  busy: boolean
}

/**
 * "Modifier": the user picks another category of the catalogue (searchable
 * by its words, grouped; for money in, income, movements and the refunds of
 * expenses), answers its question when it has one, adds a note
 * for the accountant and, for a Qonto transaction, sends the receipt.
 */
export function CategoryDialog(props: CategoryDialogProps) {
  // Keyed by the line: the choice starts again from its suggestion each time the dialog opens.
  return props.expense ? <CategoryDialogBody key={props.expense.id} {...props} expense={props.expense} /> : null
}

function CategoryDialogBody({ expense, onOpenChange, onConfirm, onReceipt, initialNote, busy }: CategoryDialogProps & { expense: ExpenseToReview }) {
  const [categoryId, setCategoryId] = React.useState<string | null>(expense.suggestion.categoryId)
  const [answers, setAnswers] = React.useState<Answers>(expense.suggestion.answers)
  const [note, setNote] = React.useState(initialNote)
  const [sending, setSending] = React.useState(false)

  const categories = categoriesForSide(expense.side)
  const category = findCategory(categoryId)
  const question = category && questionApplies(category, expense.amountCents) ? category.question! : null
  const answer = question ? (answers[question.id] ?? question.defaultAnswerId) : undefined
  const ready = category !== null && (!question || Boolean(answer))

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Choisir la catégorie</DialogTitle>
          <DialogDescription>
            {expense.name}, {formatAmount(expense.amountCents / 100)}
          </DialogDescription>
        </DialogHeader>

        <Command
          className="rounded-lg border"
          filter={(value, search, keywords) => {
            const words = searchText(search).split(/\s+/).filter(Boolean)
            const haystack = searchText([value, ...(keywords ?? [])].join(' '))
            return words.every((w) => haystack.includes(w)) ? 1 : 0
          }}
        >
          <CommandInput
            placeholder={expense.side === 'credit' ? 'ex. vente, subvention, remboursement' : 'ex. téléphone, restaurant, logiciel'}
            aria-label="Rechercher une catégorie"
          />
          <CommandList className="max-h-64">
            <CommandEmpty>Aucune catégorie ne correspond.</CommandEmpty>
            {CATEGORY_GROUPS.map((group) => {
              const items = categories.filter((c) => c.group === group)
              if (items.length === 0) return null
              return (
                <CommandGroup key={group} heading={group}>
                  {items.map((c) => (
                    <CommandItem
                      key={c.id}
                      value={c.label}
                      keywords={[c.hint, ...c.keywords]}
                      onSelect={() => {
                        setCategoryId(c.id)
                        setAnswers({})
                      }}
                    >
                      <Check aria-hidden className={cn(c.id === categoryId ? 'opacity-100' : 'opacity-0')} />
                      <span className="min-w-0">
                        <span className="block">{c.label}</span>
                        <span className="text-muted-foreground block text-xs">{c.hint}</span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )
            })}
          </CommandList>
        </Command>

        {question ? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{question.text}</legend>
            <div className="flex flex-wrap gap-2">
              {question.answers.map((a) => (
                <Button
                  key={a.id}
                  type="button"
                  size="sm"
                  variant={answer === a.id ? 'default' : 'outline'}
                  aria-pressed={answer === a.id}
                  onClick={() => setAnswers({ ...answers, [question.id]: a.id })}
                >
                  {a.label}
                </Button>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">{question.help}</p>
          </fieldset>
        ) : null}

        <Field label="Note pour votre comptable" optional hint={category?.notePrompt}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2} placeholder="ex. déjeuner avec Studio Nord" />
        </Field>

        {expense.canUploadReceipt ? (
          <Field label="Justificatif" optional hint={expense.hasReceipt ? 'Un justificatif est déjà joint.' : 'Photo ou PDF de la facture, envoyé à votre banque.'}>
            <FileInput
              accept="image/jpeg,image/png,application/pdf"
              buttonLabel="Ajouter le justificatif"
              disabled={sending}
              onChange={async (event) => {
                const file = event.target.files?.[0]
                if (!file) return
                setSending(true)
                try {
                  await onReceipt(expense, file)
                } finally {
                  setSending(false)
                }
              }}
            />
          </Field>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            loading={busy}
            disabled={!ready || Boolean(expense.blockedReason)}
            onClick={() => category && onConfirm(expense, { categoryId: category.id, answers: question && answer ? { [question.id]: answer } : {}, note })}
          >
            {expense.side === 'credit' ? 'Classer la recette' : 'Classer la dépense'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
