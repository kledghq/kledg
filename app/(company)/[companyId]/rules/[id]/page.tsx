'use client'

import { useParams } from 'next/navigation'
import { RuleEditorPage } from '@/components/features/rules/rule-editor-page'

/** A saved assignment rule, edited on its own page. */
export default function RulePage() {
  const params = useParams()
  return <RuleEditorPage ruleId={params?.id as string} />
}
