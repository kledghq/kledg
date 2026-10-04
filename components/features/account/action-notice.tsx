import { Info, Lock } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'

/**
 * Why the controls of a section are disabled: the instance policy refuses
 * the action (`refused`), or something must change first (`blocked`).
 */
export function ActionNotice({ kind = 'refused', children }: { kind?: 'refused' | 'blocked'; children: React.ReactNode }) {
  const Icon = kind === 'refused' ? Lock : Info
  return (
    <Alert>
      <Icon aria-hidden />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  )
}
