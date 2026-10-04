'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { FECColumnMapping } from '@/lib/import/types'
import { detectColumnMapping, REQUIRED_FIELDS, OPTIONAL_FIELDS } from '@/components/features/import/column-detector'

export type { FECColumnMapping }

interface ColumnMappingProps {
  fileContent: string
  onMappingComplete: (mapping: FECColumnMapping) => void
  onCancel: () => void
  companyId: string
}


export function ColumnMapping({ fileContent, onMappingComplete, onCancel, companyId }: ColumnMappingProps) {
  const [columns, setColumns] = useState<string[]>([])
  const [mapping, setMapping] = useState<Partial<FECColumnMapping>>({})
  const [previewRows, setPreviewRows] = useState<Record<string, string>[]>([])

  useEffect(() => {
    // Parse file to extract columns
    const lines = fileContent.split('\n').filter((line) => line.trim())
    if (lines.length === 0) {
      return
    }

    // Detect separator (tab or semicolon)
    const firstLine = lines[0]
    const separator = firstLine.includes('\t') ? '\t' : ';'

    const header = firstLine.split(separator).map((col) => col.trim())
    setColumns(header)

    // Extract a few lines for preview
    const preview: Record<string, string>[] = []
    for (let i = 1; i < Math.min(6, lines.length); i++) {
      const values = lines[i].split(separator)
      const row: Record<string, string> = {}
      header.forEach((col, index) => {
        row[col] = values[index]?.trim() || ''
      })
      preview.push(row)
    }
    setPreviewRows(preview)

    // Auto-detect columns
    const autoMapping = detectColumnMapping(header)
    setMapping(autoMapping)
  }, [fileContent])


  /** Select value must not be empty string (Radix). Use __empty_${index} for empty headers. */
  const getSelectValue = (col: string, index: number) =>
    col === '' ? `__empty_${index}` : col

  const getColumnNameFromSelectValue = (selectValue: string): string | undefined => {
    if (selectValue === '__none__') return undefined
    if (selectValue.startsWith('__empty_')) {
      const index = parseInt(selectValue.replace('__empty_', ''), 10)
      return columns[index] ?? ''
    }
    return selectValue
  }

  const getSelectValueFromStored = (stored: string | undefined): string => {
    // '' is a column without a header (mapped), undefined is no column
    if (stored === undefined) return '__none__'
    if (stored === '') return `__empty_${columns.indexOf('')}`
    return stored
  }

  const handleMappingChange = (fieldKey: string, selectValue: string) => {
    const columnName = getColumnNameFromSelectValue(selectValue)
    setMapping((prev) => ({
      ...prev,
      [fieldKey]: columnName,
    }))
  }

  const handleConfirm = () => {
    // Vérifier que tous les champs requis sont mappés ('' = colonne sans en-tête, valide)
    const missingFields = REQUIRED_FIELDS.filter(
      (field) => mapping[field.key as keyof FECColumnMapping] === undefined
    )

    if (missingFields.length > 0) {
      toast.error(`Associez une colonne à chaque champ obligatoire\u00a0: ${missingFields.map((f) => f.label).join(', ')}.`)
      return
    }

    // Pass only column mapping, account mapping will be handled in next step
    onMappingComplete(mapping as FECColumnMapping)
  }

  const isMappingValid = REQUIRED_FIELDS.every(
    (field) => mapping[field.key as keyof FECColumnMapping] !== undefined
  )

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <h3 className="text-sm font-semibold mb-2">Champs requis</h3>
              <div className="space-y-1.5">
                {REQUIRED_FIELDS.map((field) => (
                  <div key={field.key} className="flex items-center gap-2">
                    <Label className="w-24 text-xs shrink-0">{field.label}</Label>
                    <Select
                      value={getSelectValueFromStored(
                        mapping[field.key as keyof FECColumnMapping]
                      )}
                      onValueChange={(value) => handleMappingChange(field.key, value)}
                    >
                      <SelectTrigger size="sm" className="max-w-40">
                        <SelectValue placeholder="Sélectionner" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">-- Aucune --</SelectItem>
                        {columns.map((col, index) => (
                          <SelectItem
                            key={`${field.key}-col-${index}-${col}`}
                            value={getSelectValue(col, index)}
                          >
                            {col || `(Colonne ${index + 1})`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-2">Champs optionnels</h3>
              <div className="space-y-1.5">
                {OPTIONAL_FIELDS.map((field) => (
                  <div key={field.key} className="flex items-center gap-2">
                    <Label className="w-24 text-xs shrink-0">{field.label}</Label>
                    <Select
                      value={getSelectValueFromStored(
                        mapping[field.key as keyof FECColumnMapping]
                      )}
                      onValueChange={(value) => handleMappingChange(field.key, value)}
                    >
                      <SelectTrigger size="sm" className="max-w-40">
                        <SelectValue placeholder="Sélectionner" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">-- Aucune --</SelectItem>
                        {columns.map((col, index) => (
                          <SelectItem
                            key={`${field.key}-col-${index}-${col}`}
                            value={getSelectValue(col, index)}
                          >
                            {col || `(Colonne ${index + 1})`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {previewRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Aperçu des données</CardTitle>
            <CardDescription>
              Aperçu des 5 premières lignes du fichier pour vérifier la correspondance
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="border rounded-md overflow-auto max-h-64">
              <Table>
                <TableHeader>
                  <TableRow>
                    {columns.map((col, index) => (
                      <TableHead key={`header-${index}-${col}`} className="text-xs max-w-20 truncate px-1.5">
                        {col}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.map((row, idx) => (
                    <TableRow key={idx}>
                      {columns.map((col, colIndex) => (
                        <TableCell key={`cell-${idx}-${colIndex}-${col}`} className="text-xs max-w-20 truncate px-1.5">
                          {row[col] || '-'}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onCancel}>
          Annuler
        </Button>
        <Button onClick={handleConfirm} disabled={!isMappingValid}>
          Suivant
        </Button>
      </div>
    </div>
  )
}
