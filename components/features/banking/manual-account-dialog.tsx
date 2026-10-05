'use client'

import { useEffect, useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Field } from '@/components/shared'
import { isValidIban } from '@/lib/banking/iban'
import { pickLedgerCodeForBankAccount } from '@/lib/banking/ledger-code'
import { useLedgerBankAccounts } from './use-ledger-bank-accounts'
import { responseError } from './types'
import { useCompanyAccess } from '@/components/features/companies/company-access'

const schema = z.object({
  name: z.string().trim().min(1, 'Donnez un nom au compte.').max(100),
  iban: z
    .string()
    .trim()
    .max(42)
    .refine((value) => value === '' || isValidIban(value), "Cet IBAN n'est pas valide : vérifiez-le sur votre relevé."),
  ledgerAccountCode: z.string().min(1, 'Choisissez le compte comptable 512 de ce compte bancaire.'),
})
type FormValues = z.infer<typeof schema>

interface ManualAccountDialogProps {
  companyId: string
  onCreated?: () => void
  /** Trigger button variant (outline next to a primary action). */
  variant?: 'default' | 'outline'
  /** Trigger button size: "sm" inside an empty state. */
  size?: 'default' | 'sm'
}

/**
 * "Ajouter un compte bancaire": an account without API connection (any
 * bank, fed by statement files), with its 512 ledger account.
 */
export function ManualAccountDialog({ companyId, onCreated, variant = 'outline', size = 'default' }: ManualAccountDialogProps) {
  const [open, setOpen] = useState(false)
  const { can, denied } = useCompanyAccess()
  const allowed = can({ banking: ['manage'] })
  const { accounts: ledgerAccounts, loading } = useLedgerBankAccounts(open ? companyId : undefined)
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', iban: '', ledgerAccountCode: '' },
  })
  const { errors, isSubmitting } = form.formState

  // A new company has one fitting bank ledger account (5121, the parent 512 holds no entry):
  // choose it as a sync would, rather than ask
  useEffect(() => {
    if (form.getValues('ledgerAccountCode')) return
    const code = pickLedgerCodeForBankAccount(ledgerAccounts.map((account) => account.code), null, 'EUR')
    if (code) form.setValue('ledgerAccountCode', code, { shouldDirty: true })
  }, [ledgerAccounts, form])

  const submit = form.handleSubmit(async (values) => {
    const response = await fetch('/api/banking/manual-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId, name: values.name, iban: values.iban || null, ledgerAccountCode: values.ledgerAccountCode }),
    })
    if (!response.ok) {
      toast.error(await responseError(response, "Le compte n'a pas pu être ajouté. Réessayez."))
      return
    }
    toast.success('Compte bancaire ajouté')
    form.reset()
    setOpen(false)
    onCreated?.()
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size} disabled={!allowed} title={allowed ? undefined : denied('ajouter un compte bancaire')}>
          <Plus aria-hidden />
          Ajouter un compte bancaire
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ajouter un compte bancaire</DialogTitle>
          <DialogDescription>
            Pour une banque sans connexion (BoursoBank, Shine...)&nbsp;: ses opérations viendront des relevés que vous importez.
          </DialogDescription>
        </DialogHeader>
        <form id="manual-account-form" onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Nom du compte" required error={errors.name?.message}>
            <Input placeholder="ex. Compte courant BoursoBank" {...form.register('name')} />
          </Field>
          <Field label="IBAN" optional error={errors.iban?.message} hint="Permet de reconnaître les relevés de ce compte.">
            <Input placeholder="ex. FR76 3000 4000 0312 3456 7890 143" className="font-mono" {...form.register('iban')} />
          </Field>
          <Field label="Devise" hint="Kledg tient les comptes bancaires en euros.">
            <Input value="EUR" disabled readOnly />
          </Field>
          <Field
            label="Compte comptable"
            required
            error={errors.ledgerAccountCode?.message}
            hint={ledgerAccounts.length === 0 && !loading ? "Créez d'abord un compte 512 dans le plan comptable." : 'Compte de banque (512) où ses opérations sont enregistrées.'}
          >
            <Controller
              control={form.control}
              name="ledgerAccountCode"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={loading}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choisir un compte 512" />
                  </SelectTrigger>
                  <SelectContent>
                    {ledgerAccounts.map((account) => (
                      <SelectItem key={account.id} value={account.code}>
                        <span className="font-mono text-xs">{account.code}</span> {account.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isSubmitting}>
            Annuler
          </Button>
          <Button type="submit" form="manual-account-form" loading={isSubmitting}>
            Ajouter le compte
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
