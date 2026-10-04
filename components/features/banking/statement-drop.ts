/**
 * Files handed to the statement import dialog: real files dropped from the
 * desktop, and files offered by other interface of the page, an "external
 * file source" (for instance a panel rendered by an instance slot, see
 * docs/extension-points.md).
 *
 * An external source registers each file it offers with registerExternalFile
 * and gets a random token, then hands the token over in one of three ways:
 *  - drag and drop: the token as EXTERNAL_FILE_DRAG_TYPE drag data;
 *  - "import this file" on a page with the dialog: IMPORT_FILE_EVENT on
 *    window, cancelled by the dialog when it takes the file;
 *  - from another page: a client-side navigation to the statements page with
 *    ?importFile=<token> (the registry lives as long as the page session).
 * Only tokens registered in this page are accepted, so a drag from another
 * site or a crafted link can never make the dialog fetch or load anything.
 */

/** Drag data type carrying the token of a registered external file. */
export const EXTERNAL_FILE_DRAG_TYPE = 'application/x-kledg-file'

/** Window event (detail: ImportFileRequest) asking the mounted import dialog to load a file; cancelled when handled. */
export const IMPORT_FILE_EVENT = 'kledg:import-file'

/** Query parameter of the statements page: token of a registered file to load on arrival. */
export const IMPORT_FILE_PARAM = 'importFile'

/** Window event the import dialog sends when it opens, closes or shows a preview (detail: ImportDialogState). */
export const IMPORT_DIALOG_STATE_EVENT = 'kledg:import-dialog-state'

export interface ImportDialogState {
  open: boolean
  hasPreview: boolean
}

export interface ExternalFile {
  fileName: string
  /** Produces the file (e.g. downloads it) when the dialog takes it. */
  load: () => Promise<File>
  /** Bank account the file belongs to, preselected in the dialog. */
  bankAccountId?: string
}

export interface ImportFileRequest {
  token: string
}

const registry = new Map<string, ExternalFile>()

function newToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
}

/** Offers a file to the import dialog; returns its token. */
export function registerExternalFile(file: ExternalFile): string {
  const token = newToken()
  registry.set(token, file)
  return token
}

export function unregisterExternalFile(token: string): void {
  registry.delete(token)
}

/** The registered file of a token, or null for an unknown token. */
export function externalFile(token: string | null | undefined): ExternalFile | null {
  return (token && registry.get(token)) || null
}

/** Does this drag carry something the import accepts (a file or a registered external file)? */
export function isImportableDrag(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false
  const types = Array.from(dataTransfer.types ?? [])
  return types.includes(EXTERNAL_FILE_DRAG_TYPE) || types.includes('Files')
}

/** The file of a drop: the first real file, or the registered external file it carries. */
export async function droppedFile(dataTransfer: DataTransfer): Promise<{ file: File; bankAccountId?: string } | null> {
  const token = dataTransfer.getData(EXTERNAL_FILE_DRAG_TYPE)
  if (token) {
    const source = externalFile(token)
    return source ? { file: await source.load(), bankAccountId: source.bankAccountId } : null
  }
  const file = dataTransfer.files?.[0]
  return file ? { file } : null
}
