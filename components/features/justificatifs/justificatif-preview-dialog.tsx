'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Download, FileText } from 'lucide-react'

export interface JustificatifPreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  attachmentId: string
  transactionUuid: string
  companyId: string
  fileName: string
  fileContentType?: string | null
}

/**
 * Dialog de prévisualisation d'un justificatif d'une transaction bancaire.
 * Utilise le proxy API pour afficher PDF, image ou proposer le téléchargement.
 */
export function JustificatifPreviewDialog({
  open,
  onOpenChange,
  attachmentId,
  transactionUuid,
  companyId,
  fileName,
  fileContentType,
}: JustificatifPreviewDialogProps) {
  const proxyUrl = `/api/banking/attachments/${attachmentId}/proxy?companyId=${encodeURIComponent(companyId)}&transactionUuid=${encodeURIComponent(transactionUuid)}`
  const contentType = (fileContentType ?? '').toLowerCase()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{fileName}</DialogTitle>
          <DialogDescription>Justificatif de la transaction</DialogDescription>
        </DialogHeader>
        <div className="mt-4">
          {contentType.includes('pdf') && (
            <div className="w-full space-y-2">
              <div className="w-full h-[600px] border rounded overflow-hidden bg-muted">
                <iframe
                  src={`${proxyUrl}#toolbar=1&navpanes=1&scrollbar=1`}
                  className="w-full h-full"
                  title={fileName}
                  style={{ border: 'none' }}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(proxyUrl, '_blank')}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Ouvrir dans un nouvel onglet
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(proxyUrl, '_blank')}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Télécharger
                </Button>
              </div>
            </div>
          )}

          {contentType.includes('image') && (
            <div className="space-y-2">
              <div className="flex justify-center">
                <img
                  src={proxyUrl}
                  alt={fileName}
                  className="max-w-full h-auto rounded max-h-[600px]"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(proxyUrl, '_blank')}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Ouvrir dans un nouvel onglet
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(proxyUrl, '_blank')}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Télécharger
                </Button>
              </div>
            </div>
          )}

          {!contentType.includes('pdf') && !contentType.includes('image') && (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-4" />
              <p className="mb-2">
                Prévisualisation non disponible pour ce type de fichier
              </p>
              <p className="text-sm mb-4">
                Type&nbsp;: {contentType || 'inconnu'}
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => window.open(proxyUrl, '_blank')}
              >
                <Download className="h-4 w-4 mr-2" />
                Télécharger le fichier
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
