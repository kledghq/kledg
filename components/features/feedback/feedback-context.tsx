'use client'

import { createContext, useContext, useState } from 'react'
import pkg from '@/package.json'
import { DEFAULT_FEEDBACK_REPO, type FeedbackKind } from '@/lib/feedback/issue-url'
import type { FeedbackTarget } from '@/lib/feedback/target'
import { FeedbackDialog } from './feedback-dialog'

interface FeedbackState {
  target: FeedbackTarget
  displayMode: string | null
  /** Opens the dialog; errorReference is the digest of a server error. */
  open: (kind: FeedbackKind, options?: { errorReference?: string | null }) => void
}

/** Outside the app frame (an error above it): the package version, the default repository. */
export const FALLBACK_FEEDBACK_TARGET: FeedbackTarget = { repo: DEFAULT_FEEDBACK_REPO, version: pkg.version, commit: null, host: 'inconnu' }

const FeedbackStateContext = createContext<FeedbackState | null>(null)

/**
 * Hands the client the instance's feedback target (computed on the server,
 * lib/feedback/target.ts) and renders the one feedback dialog of the frame.
 */
export function FeedbackProvider({
  target,
  displayMode = null,
  children,
}: {
  target: FeedbackTarget
  displayMode?: string | null
  children: React.ReactNode
}) {
  const [dialog, setDialog] = useState<{ kind: FeedbackKind; errorReference: string | null } | null>(null)
  const open: FeedbackState['open'] = (kind, options) => setDialog({ kind, errorReference: options?.errorReference ?? null })
  return (
    <FeedbackStateContext.Provider value={{ target, displayMode, open }}>
      {children}
      {dialog ? (
        <FeedbackDialog
          key={`${dialog.kind}-${dialog.errorReference ?? ''}`}
          open
          onOpenChange={(next) => (next ? null : setDialog(null))}
          kind={dialog.kind}
          target={target}
          displayMode={displayMode}
          errorReference={dialog.errorReference}
        />
      ) : null}
    </FeedbackStateContext.Provider>
  )
}

/** The feedback of the frame, or null outside it. */
export function useFeedback(): FeedbackState | null {
  return useContext(FeedbackStateContext)
}
