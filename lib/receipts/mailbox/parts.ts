/**
 * The attachments of an email, from its MIME structure as the IMAP server
 * describes it (BODYSTRUCTURE, RFC 3501 7.4.2), without downloading the
 * message (pure module). Only those parts are then downloaded, one by one:
 * the body of the email is never read.
 *
 * A part is an attachment when it has a file name (Content-Disposition
 * filename, or Content-Type name), or a disposition "attachment". An image
 * shown inline by its Content-ID (a logo of a signature) is not one. Parts
 * nested in a forwarded message (message/rfc822) are attachments too: a
 * forwarded invoice keeps its PDF there.
 */

export interface StructurePart {
  part?: string
  type: string
  parameters?: Record<string, string | undefined>
  id?: string
  size?: number
  disposition?: string
  dispositionParameters?: Record<string, string | undefined>
  childNodes?: StructurePart[]
}

export interface AttachmentPart {
  /** IMAP part number ("2", "1.2"). */
  part: string
  fileName: string
  contentType: string
  inline: boolean
  /** Encoded size the server declares (base64 is about 4/3 of the file). */
  size: number | null
}

/** Most parts walked in one message: a crafted structure cannot keep the walk going. */
const MAX_PARTS = 200

export function attachmentParts(structure: StructurePart | undefined): AttachmentPart[] {
  const out: AttachmentPart[] = []
  let walked = 0
  const visit = (node: StructurePart) => {
    if (++walked > MAX_PARTS) return
    for (const child of node.childNodes ?? []) visit(child)
    if (node.childNodes?.length || !node.part) return
    const type = node.type.toLowerCase()
    if (type.startsWith('multipart/')) return
    const fileName = node.dispositionParameters?.filename ?? node.parameters?.name ?? null
    const disposition = node.disposition?.toLowerCase() ?? null
    if (!fileName && disposition !== 'attachment') return
    out.push({
      part: node.part,
      fileName: fileName ?? 'justificatif',
      contentType: type,
      inline: disposition !== 'attachment' && Boolean(node.id) && type.startsWith('image/'),
      size: typeof node.size === 'number' ? node.size : null,
    })
  }
  if (structure) visit(structure)
  return out
}
