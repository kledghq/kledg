'use client'

import * as React from 'react'
import type { AssistantApp } from '@/lib/ai-assist/apps'

export interface AiAssistContextValue {
  companyId: string
  companyName: string
  /** The signed-in user, to remember their last choice of app. */
  userId: string
  /** The assistants the user connected to this company (lib/ai-access/company-assistants.service.ts); empty: no button. */
  apps: AssistantApp[]
}

// Outside a company layout (tests, isolated components): no assistant, so no button.
const AiAssistContext = React.createContext<AiAssistContextValue>({ companyId: '', companyName: '', userId: '', apps: [] })

/** Given by the company layout (app/(company)/[companyId]/layout.tsx). */
export function AiAssistProvider({ value, children }: { value: AiAssistContextValue; children: React.ReactNode }) {
  return <AiAssistContext.Provider value={value}>{children}</AiAssistContext.Provider>
}

export function useAiAssist(): AiAssistContextValue {
  return React.useContext(AiAssistContext)
}
