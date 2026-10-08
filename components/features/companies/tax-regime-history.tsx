'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { formatDisplayDate, useConfirm } from '@/components/shared'
import { calendarDayOf, isoDateToLocal, localDateToIso } from '@/lib/utils/date'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { DatePicker } from '@/components/ui/date-picker'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { Plus, Trash2, Edit, Loader2 } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'

interface TaxRegimeHistoryItem {
  id: string
  regimeType: 'vat' | 'corporateTax'
  regime: string
  startDate: string
  endDate: string | null
  notes: string | null
  isVatExempt?: boolean
  vatExemptReason?: string | null
  establishmentId?: string | null
  establishment?: {
    id: string
    siret: string
    name: string | null
  } | null
}

interface TaxRegimeHistoryProps {
  companyId: string
}

const vatRegimes = [
  { value: 'normal', label: 'Régime normal' },
  { value: 'simplified', label: 'Régime simplifié' },
  { value: 'mini_real', label: 'Régime mini-réel' },
  { value: 'franchise', label: 'Franchise en base' },
  { value: 'real', label: 'Régime réel' },
]

const corporateTaxRegimes = [
  { value: 'normal', label: 'Régime normal' },
  { value: 'simplified', label: 'Régime simplifié' },
  { value: 'micro', label: 'Micro-société' },
  // Bénéfice imposé à l'impôt sur le revenu (EURL d'une personne physique, SNC, SARL de famille...): lib/companies/profit-taxation.ts
  { value: 'income_tax', label: 'Impôt sur le revenu (pas d’IS)' },
]

const vatExemptReasons = [
  // Enseignement et formation (art. 261 CGI, 4°-4°)
  { value: 'Enseignement scolaire, universitaire ou technique', label: 'Enseignement scolaire, universitaire ou technique' },
  { value: 'Formation professionnelle continue', label: 'Formation professionnelle continue' },
  { value: 'Organisme de formation (avec attestation)', label: 'Organisme de formation (avec attestation)' },
  { value: 'Enseignement à distance', label: 'Enseignement à distance' },
  { value: 'Cours ou leçons particuliers', label: 'Cours ou leçons particuliers' },
  { value: 'Formation agricole', label: 'Formation agricole' },
  // Activités médicales et de santé
  { value: 'Activités médicales et paramédicales', label: 'Activités médicales et paramédicales' },
  { value: 'Établissement de santé / Hospitalisation', label: 'Établissement de santé / Hospitalisation' },
  // Activités financières
  { value: 'Activités bancaires et financières', label: 'Activités bancaires et financières' },
  { value: 'Activités d\'assurance', label: 'Activités d\'assurance' },
  // Autres exonérations
  { value: 'Export / Opérations intracommunautaires', label: 'Export / Opérations intracommunautaires' },
  { value: 'Activités immobilières exonérées', label: 'Activités immobilières exonérées' },
  { value: 'Organisme à but non lucratif', label: 'Organisme à but non lucratif' },
  { value: 'Autre', label: 'Autre (à préciser)' },
]

/** A stored calendar day (midnight UTC), or "En cours" for an open period. */
function formatDate(dateString: string | null): string {
  if (!dateString) return 'En cours'
  return formatDisplayDate(dateString, 'long')
}

function getRegimeLabel(regimeType: string, regime: string): string {
  if (regimeType === 'vat') {
    return vatRegimes.find((r) => r.value === regime)?.label || regime
  }
  return corporateTaxRegimes.find((r) => r.value === regime)?.label || regime
}

export function TaxRegimeHistory({ companyId }: TaxRegimeHistoryProps) {
  const [vatHistory, setVatHistory] = useState<TaxRegimeHistoryItem[]>([])
  const [corporateTaxHistory, setCorporateTaxHistory] = useState<
    TaxRegimeHistoryItem[]
  >([])
  const [loading, setLoading] = useState(true)
  const { confirm, dialog: confirmDialog } = useConfirm()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingRegime, setEditingRegime] = useState<
    TaxRegimeHistoryItem | null
  >(null)
  const [formData, setFormData] = useState({
    regimeType: 'vat' as 'vat' | 'corporateTax',
    regime: '',
    startDate: undefined as Date | undefined,
    notes: '',
    isVatExempt: false,
    vatExemptReason: '',
    customVatExemptReason: '',
    establishmentId: undefined as string | undefined,
  })
  const [establishments, setEstablishments] = useState<Array<{ id: string; siret: string; name: string | null }>>([])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadHistory()
    loadEstablishments()
  }, [companyId])

  async function loadEstablishments() {
    try {
      const response = await fetch(`/api/companies/${companyId}/establishments`)
      if (response.ok) {
        const data = await response.json()
        setEstablishments(data)
      }
    } catch (error) {
      // Silently fail, establishments are optional
    }
  }

  async function loadHistory() {
    try {
      setLoading(true)
      const [vatResponse, corporateTaxResponse] = await Promise.all([
        fetch(`/api/companies/${companyId}/tax-regimes?regimeType=vat`),
        fetch(
          `/api/companies/${companyId}/tax-regimes?regimeType=corporateTax`
        ),
      ])

      if (vatResponse.ok) {
        const vatData = await vatResponse.json()
        setVatHistory(vatData)
      }

      if (corporateTaxResponse.ok) {
        const corporateTaxData = await corporateTaxResponse.json()
        setCorporateTaxHistory(corporateTaxData)
      }
    } catch (error) {
      toast.error('Erreur lors du chargement de l\'historique')
    } finally {
      setLoading(false)
    }
  }

  function openAddDialog(regimeType: 'vat' | 'corporateTax') {
    setEditingRegime(null)
    setFormData({
      regimeType,
      regime: '',
      startDate: undefined,
      notes: '',
      isVatExempt: false,
      vatExemptReason: '',
      customVatExemptReason: '',
      establishmentId: undefined,
    })
    setDialogOpen(true)
  }

  function openEditDialog(regime: TaxRegimeHistoryItem) {
    setEditingRegime(regime)
    const reason = regime.vatExemptReason || ''
    const isStandardReason = vatExemptReasons.some(r => r.value === reason)
    setFormData({
      regimeType: regime.regimeType,
      regime: regime.regime,
      // The picker works in local time: local midnight of the stored day.
      startDate: isoDateToLocal(calendarDayOf(regime.startDate) ?? ''),
      notes: regime.notes || '',
      isVatExempt: regime.isVatExempt || false,
      vatExemptReason: isStandardReason ? reason : 'Autre',
      customVatExemptReason: isStandardReason ? '' : reason,
      establishmentId: regime.establishmentId || undefined,
    })
    setDialogOpen(true)
  }

  async function handleSubmit() {
    if (!formData.regime || !formData.startDate) {
      toast.error('Veuillez remplir tous les champs requis')
      return
    }

    if (formData.isVatExempt && formData.regimeType === 'vat') {
      if (!formData.vatExemptReason) {
        toast.error('Veuillez sélectionner une raison d\'exonération')
        return
      }
      if (formData.vatExemptReason === 'Autre' && !formData.customVatExemptReason.trim()) {
        toast.error('Veuillez préciser la raison de l\'exonération')
        return
      }
    }

    setSubmitting(true)
    try {
      if (editingRegime) {
        // Mise à jour
        const response = await fetch(`/api/companies/${companyId}/tax-regimes`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editingRegime.id,
            regime: formData.regime,
            startDate: localDateToIso(formData.startDate),
            notes: formData.notes || null,
            isVatExempt: formData.regimeType === 'vat' ? formData.isVatExempt : false,
            vatExemptReason: formData.regimeType === 'vat' && formData.isVatExempt 
              ? (formData.vatExemptReason === 'Autre' ? formData.customVatExemptReason : formData.vatExemptReason)
              : null,
            establishmentId: formData.regimeType === 'vat' && formData.isVatExempt ? formData.establishmentId || null : null,
          }),
        })

        if (response.ok) {
          toast.success('Régime mis à jour avec succès')
          setDialogOpen(false)
          loadHistory()
        } else {
          const error = await response.json()
          toast.error(error.error || 'Erreur lors de la mise à jour')
        }
      } else {
        // Création
        const response = await fetch(
          `/api/companies/${companyId}/tax-regimes`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              regimeType: formData.regimeType,
              regime: formData.regime,
              startDate: localDateToIso(formData.startDate),
              notes: formData.notes || null,
              isVatExempt: formData.regimeType === 'vat' ? formData.isVatExempt : false,
              vatExemptReason: formData.regimeType === 'vat' && formData.isVatExempt 
                ? (formData.vatExemptReason === 'Autre' ? formData.customVatExemptReason : formData.vatExemptReason)
                : null,
              establishmentId: formData.regimeType === 'vat' && formData.isVatExempt ? formData.establishmentId || null : null,
            }),
          }
        )

        if (response.ok) {
          toast.success('Régime ajouté avec succès')
          setDialogOpen(false)
          loadHistory()
        } else {
          const error = await response.json()
          toast.error(error.error || 'Erreur lors de l\'ajout')
        }
      }
    } catch (error) {
      toast.error('Erreur lors de l\'enregistrement')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: 'Supprimer ce régime ?',
      description: "La période correspondante n'aura plus de régime enregistré dans l'historique.",
      confirmLabel: 'Supprimer',
    })
    if (!ok) return

    try {
      const response = await fetch(
        `/api/companies/${companyId}/tax-regimes?id=${id}`,
        {
          method: 'DELETE',
        }
      )

      if (response.ok) {
        toast.success('Régime supprimé avec succès')
        loadHistory()
      } else {
        const error = await response.json()
        toast.error(error.error || 'Erreur lors de la suppression')
      }
    } catch (error) {
      toast.error('Erreur lors de la suppression')
    }
  }

  const currentRegimes = formData.regimeType === 'vat' ? vatRegimes : corporateTaxRegimes

  return (
    <div className="space-y-8">
      {/* Historique TVA */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1 basis-64">
              <CardTitle>Historique des régimes de TVA</CardTitle>
              <CardDescription>
                Gérez l'historique des régimes de TVA de la société
              </CardDescription>
            </div>
            <Button
              size="sm"
              onClick={() => openAddDialog('vat')}
            >
              <Plus className="mr-2 h-4 w-4" />
              Ajouter un régime
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : vatHistory.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              Aucun régime de TVA enregistré
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Régime</TableHead>
                  <TableHead>Date de début</TableHead>
                  <TableHead>Date de fin</TableHead>
                  <TableHead>Exonération TVA</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vatHistory.map((regime) => (
                  <TableRow key={regime.id}>
                    <TableCell className="font-medium">
                      {getRegimeLabel('vat', regime.regime)}
                    </TableCell>
                    <TableCell>{formatDate(regime.startDate)}</TableCell>
                    <TableCell>{formatDate(regime.endDate)}</TableCell>
                    <TableCell>
                      {regime.isVatExempt ? (
                        <div className="space-y-1">
                          <div className="text-sm font-medium">Oui</div>
                          {regime.vatExemptReason && (
                            <div className="text-xs text-muted-foreground">{regime.vatExemptReason}</div>
                          )}
                          {regime.establishment && (
                            <div className="text-xs text-muted-foreground">
                              Établissement&nbsp;: {regime.establishment.name || regime.establishment.siret}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Non</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-xs truncate">
                      {regime.notes || '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => openEditDialog(regime)}
                          aria-label="Modifier"
                          title="Modifier"
                        >
                          <Edit aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleDelete(regime.id)}
                          aria-label="Supprimer"
                          title="Supprimer"
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Historique IS */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1 basis-64">
              <CardTitle>Historique des régimes d'IS</CardTitle>
              <CardDescription>
                Gérez l'historique des régimes d'impôt sur les sociétés
              </CardDescription>
            </div>
            <Button
              size="sm"
              onClick={() => openAddDialog('corporateTax')}
            >
              <Plus className="mr-2 h-4 w-4" />
              Ajouter un régime
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : corporateTaxHistory.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              Aucun régime d'IS enregistré
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Régime</TableHead>
                  <TableHead>Date de début</TableHead>
                  <TableHead>Date de fin</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {corporateTaxHistory.map((regime) => (
                  <TableRow key={regime.id}>
                    <TableCell className="font-medium">
                      {getRegimeLabel('corporateTax', regime.regime)}
                    </TableCell>
                    <TableCell>{formatDate(regime.startDate)}</TableCell>
                    <TableCell>{formatDate(regime.endDate)}</TableCell>
                    <TableCell className="max-w-xs truncate">
                      {regime.notes || '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => openEditDialog(regime)}
                          aria-label="Modifier"
                          title="Modifier"
                        >
                          <Edit aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleDelete(regime.id)}
                          aria-label="Supprimer"
                          title="Supprimer"
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Dialog pour ajouter/modifier */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingRegime ? 'Modifier le régime' : 'Ajouter un régime'}
            </DialogTitle>
            <DialogDescription>
              {editingRegime
                ? 'Modifiez les informations du régime'
                : 'Ajoutez un nouveau régime fiscal'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Type de régime</Label>
              <Select
                value={formData.regimeType}
                onValueChange={(value) =>
                  setFormData({
                    ...formData,
                    regimeType: value as 'vat' | 'corporateTax',
                    regime: '',
                  })
                }
                disabled={!!editingRegime}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vat">TVA</SelectItem>
                  <SelectItem value="corporateTax">Impôt sur les sociétés</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Régime *</Label>
              <Select
                value={formData.regime}
                onValueChange={(value) =>
                  setFormData({ ...formData, regime: value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner un régime" />
                </SelectTrigger>
                <SelectContent>
                  {currentRegimes.map((regime) => (
                    <SelectItem key={regime.value} value={regime.value}>
                      {regime.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Date de début *</Label>
              <DatePicker
                date={formData.startDate}
                onDateChange={(date) =>
                  setFormData({ ...formData, startDate: date })
                }
                placeholder="Sélectionner la date de début"
              />
            </div>

            {/* Exonération de TVA (uniquement pour les régimes TVA) */}
            {formData.regimeType === 'vat' && (
              <>
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="isVatExempt"
                      checked={formData.isVatExempt}
                      onCheckedChange={(checked) =>
                        setFormData({
                          ...formData,
                          isVatExempt: checked === true,
                          vatExemptReason: checked && !formData.vatExemptReason ? 'Organisme de formation (avec attestation)' : (checked ? formData.vatExemptReason : ''),
                          customVatExemptReason: checked ? formData.customVatExemptReason : '',
                          establishmentId: checked ? formData.establishmentId : undefined,
                        })
                      }
                    />
                    <Label htmlFor="isVatExempt" className="text-sm font-normal cursor-pointer">
                      Exonération de TVA
                    </Label>
                  </div>
                </div>

                {formData.isVatExempt && (
                  <div className="ml-6 space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="vatExemptReason">Raison de l'exonération *</Label>
                      <Select
                        value={formData.vatExemptReason}
                        onValueChange={(value) =>
                          setFormData({
                            ...formData,
                            vatExemptReason: value,
                            customVatExemptReason: value === 'Autre' ? formData.customVatExemptReason : '',
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Sélectionner une raison" />
                        </SelectTrigger>
                        <SelectContent>
                          {vatExemptReasons.map((reason) => (
                            <SelectItem key={reason.value} value={reason.value}>
                              {reason.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {formData.vatExemptReason === 'Autre' && (
                        <Input
                          id="customVatExemptReason"
                          value={formData.customVatExemptReason}
                          onChange={(e) =>
                            setFormData({ ...formData, customVatExemptReason: e.target.value })
                          }
                          placeholder="Précisez la raison de l'exonération"
                        />
                      )}
                    </div>

                    {establishments.length > 0 && (
                      <div className="space-y-2">
                        <Label htmlFor="establishmentId">Établissement concerné</Label>
                        <Select
                          value={formData.establishmentId || 'all'}
                          onValueChange={(value) =>
                            setFormData({
                              ...formData,
                              establishmentId: value === 'all' ? undefined : value,
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Sélectionner un établissement" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">Tous les établissements</SelectItem>
                            {establishments.map((est) => (
                              <SelectItem key={est.id} value={est.id}>
                                {est.name || est.siret}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          Si aucun établissement n'est sélectionné, l'exonération s'applique à tous les établissements.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={formData.notes}
                onChange={(e) =>
                  setFormData({ ...formData, notes: e.target.value })
                }
                placeholder="Notes optionnelles..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={submitting}
            >
              Annuler
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Enregistrement...
                </>
              ) : editingRegime ? (
                'Enregistrer'
              ) : (
                'Ajouter'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </div>
  )
}
