/**
 * Where the feedback of this instance goes, and the instance's version for
 * its technical context (server only: reads the environment).
 *
 * KLEDG_FEEDBACK_REPO (owner/name) sends the reports of an instance to its
 * own repository; kledghq/kledg by default, or when the value is not a
 * repository name.
 */

import { getDeployedVersion } from '@/lib/updates/version'
import { PLATFORM_LABELS } from '@/lib/updates/hosting'
import { DEFAULT_FEEDBACK_REPO, isFeedbackRepo } from '@/lib/feedback/issue-url'

export interface FeedbackTarget {
  repo: string
  version: string
  commit: string | null
  host: string
}

type Env = Record<string, string | undefined>

export function feedbackRepo(env: Env = process.env): string {
  const value = env.KLEDG_FEEDBACK_REPO?.trim()
  return value && isFeedbackRepo(value) ? value : DEFAULT_FEEDBACK_REPO
}

export function getFeedbackTarget(env: Env = process.env): FeedbackTarget {
  const { version, commit, platform } = getDeployedVersion(env)
  return { repo: feedbackRepo(env), version, commit, host: PLATFORM_LABELS[platform] }
}
