/**
 * The approved state, checked again inside the transaction that acts
 * (finding KLEDG-R3-MCP-01).
 *
 * An MCP action approved by the user in validation mode is bound to the
 * rows the user saw (lib/mcp/full-control/fingerprint.ts). The MCP layer
 * compares them right before calling the service, but an edit could still
 * land between that comparison and the service's own transaction. So the
 * MCP layer runs the service inside `runWithApprovedState`, with the state
 * of every target as approved, and the services call `checkApprovedState`
 * inside their transaction, where they lock the row they are about to
 * change (lockInvoice, lockExpenseReport, the entry validation, the rule
 * application...). The check locks the target rows, reads them again and
 * throws ApprovedStateChangedError when they differ from the approved
 * state: the transaction rolls back and nothing is written.
 *
 * Outside an approved MCP execution (web pages, API, automatic mode) the
 * check does nothing.
 *
 * A target is checked once per execution (the first transaction that locks
 * it; the service then changes it itself), except rules: the rules engine
 * applies a rule many times without changing it, so every application
 * checks it again.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { ConflictError } from '@/lib/accounting/errors'
import { loadTargetState, stateHash, targetKey, type Db, type TargetRef } from './targets'

export const STATE_CHANGED_MESSAGE =
  "Les données ont changé depuis l'approbation : l'action n'a pas été exécutée. Préparez une nouvelle action (appel sans actionId) et faites-la approuver de nouveau."

/** The rows of an approved action changed since the approval: nothing was written by the refused transaction. */
export class ApprovedStateChangedError extends ConflictError {
  constructor() {
    super(STATE_CHANGED_MESSAGE)
    this.name = 'ApprovedStateChangedError'
  }
}

interface ApprovedState {
  /** Hash of each target's approved state, by targetKey. */
  expected: Map<string, string>
  /** Companies whose whole rule set is approved: a rule outside it is not approved either. */
  ruleSets: Set<string>
  /** Targets already checked (and so possibly changed by the action itself since). */
  checked: Set<string>
}

const storage = new AsyncLocalStorage<ApprovedState>()

/**
 * Runs `fn` (the execution of an approved action) with the approved state
 * of its targets: `states` maps each target to its state as approved.
 * Returns the result and the targets no transaction checked (the caller
 * logs them: those were only compared before the execution).
 */
export async function runWithApprovedState<T>(
  states: Array<{ ref: TargetRef; state: unknown }>,
  fn: () => Promise<T>,
): Promise<{ result: T; unchecked: string[] }> {
  const approved: ApprovedState = { expected: new Map(), ruleSets: new Set(), checked: new Set() }
  for (const { ref, state } of states) {
    approved.expected.set(targetKey(ref), stateHash(state))
    if (ref.kind === 'rules') {
      approved.ruleSets.add(ref.companyId)
      // Each rule of the set, for the checks of one rule (an application).
      for (const rule of (state as Array<{ id: string }> | null) ?? []) {
        approved.expected.set(targetKey({ kind: 'rule', companyId: ref.companyId, id: rule.id }), stateHash(rule))
      }
    }
  }
  const result = await storage.run(approved, fn)
  const unchecked = states.map(({ ref }) => targetKey(ref)).filter((key) => !approved.checked.has(key))
  return { result, unchecked }
}

/** Whether an approved MCP action is executing (the services take the checking path only then). */
export function approvedStateActive(): boolean {
  return storage.getStore() !== undefined
}

/**
 * Inside the service's transaction `db`: locks `ref`'s rows, reads them and
 * throws ApprovedStateChangedError when they differ from the approved
 * state. Does nothing outside an approved execution or for a row the
 * approval does not cover.
 */
export async function checkApprovedState(db: Db, ref: TargetRef): Promise<void> {
  const approved = storage.getStore()
  if (!approved) return
  const key = targetKey(ref)
  let expected = approved.expected.get(key)
  if (expected === undefined) {
    // A rule created after the approval of the whole set was not approved.
    if (ref.kind === 'rule' && approved.ruleSets.has(ref.companyId)) expected = stateHash(null)
    else return
  }
  const recheck = ref.kind === 'rule' || ref.kind === 'rules'
  if (!recheck && approved.checked.has(key)) return
  const current = stateHash(await loadTargetState(db, ref, { lock: true }))
  if (current !== expected) throw new ApprovedStateChangedError()
  approved.checked.add(key)
}
