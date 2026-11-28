/** The worker module of PDF.js, imported on the main thread (pdf-text.ts); pdfjs-dist ships no types for it. */
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown
}
