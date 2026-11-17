/**
 * prepare_feedback: an assistant prepares a bug report or an idea from the
 * conversation (docs/signaler-un-probleme.md). The tool only builds the link
 * to the prefilled GitHub issue form (lib/feedback/issue-url.ts) with the
 * instance's version and host: the user reads it and submits it from their
 * own GitHub account. Nothing is sent anywhere by the tool, no company data
 * is read.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { json, run } from '@/lib/mcp/tool-result'
import { READ_ONLY, describeTool } from '@/lib/mcp/tool-meta'
import { contextLines, feedbackIssueUrl, feedbackSearchUrl, FEEDBACK_KINDS, TEXT_MAX, TITLE_MAX } from '@/lib/feedback/issue-url'
import { getFeedbackTarget } from '@/lib/feedback/target'

export function registerFeedbackTools(server: McpServer) {
  server.registerTool(
    'prepare_feedback',
    {
      title: 'Préparer un signalement ou une idée',
      description: describeTool({
        summary:
          'Prepares a GitHub issue for Kledg from the conversation: kind bug (what happens, steps to reproduce) or idea (need, proposal). Returns issueUrl, the prefilled issue form to give the user, searchUrl to check whether it is already reported, the repository, and the technical context added (version, commit, host). Write the title and texts in French, and leave out accounting data: amounts, company names, SIREN, people. The user reads the issue and submits it from their GitHub account.',
        access: 'read',
        permission: 'signed-in',
        amounts: 'none',
        never: 'creates the issue, sends anything to GitHub, or reads company data.',
      }),
      inputSchema: z.object({
        kind: z.enum(FEEDBACK_KINDS).describe('bug for something that does not work, idea for an improvement.'),
        title: z.string().trim().min(1).max(TITLE_MAX).describe('Short title, in French.'),
        description: z.string().trim().min(1).max(TEXT_MAX).describe('bug: what happens and what was expected. idea: the need. In French.'),
        details: z.string().trim().max(TEXT_MAX).optional().describe('bug: steps to reproduce. idea: the proposal. In French.'),
      }),
      annotations: READ_ONLY,
    },
    ({ kind, title, description, details }) =>
      run(async () => {
        const target = getFeedbackTarget()
        const context = { version: target.version, commit: target.commit, host: target.host }
        return json({
          repository: target.repo,
          issueUrl: feedbackIssueUrl(target.repo, { kind, title, description, details }, context),
          searchUrl: feedbackSearchUrl(target.repo, title),
          context: contextLines(context),
        })
      }),
  )
}
