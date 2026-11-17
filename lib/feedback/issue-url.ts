/**
 * Feedback from Kledg (docs/signaler-un-probleme.md): a link that opens a
 * GitHub issue prefilled from the repository's issue forms
 * (.github/ISSUE_TEMPLATE/bug_report.yml and feature_request.yml). The user
 * reads it and submits it from their own GitHub account: Kledg never creates
 * an issue itself.
 *
 * GitHub prefills an issue form from the query string: `template` (file
 * name), `title`, and one parameter per field `id`
 * (https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms).
 * A test checks that every id used here exists in the YAML files.
 *
 * The technical context is shown to the user before sending and holds no
 * accounting data: version, commit, host, page (route pattern, never an id
 * or a company slug), display mode, browser and language.
 *
 * Pure, no server imports: used by the dialog and the MCP tool.
 */

export const FEEDBACK_KINDS = ['bug', 'idea'] as const
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]

/** Issue form of each kind, and the ids of its fields (.github/ISSUE_TEMPLATE). */
export const FEEDBACK_TEMPLATES = {
  bug: { file: 'bug_report.yml', description: 'what', steps: 'steps', version: 'version' },
  idea: { file: 'feature_request.yml', description: 'need', proposal: 'proposal' },
} as const

export const DEFAULT_FEEDBACK_REPO = 'kledghq/kledg'

/** owner/name of a GitHub repository (GitHub's own character rules). */
const REPO_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/

export function isFeedbackRepo(value: string): boolean {
  return REPO_PATTERN.test(value) && !value.endsWith('/.') && !value.endsWith('/..')
}

export const TITLE_MAX = 120
export const TEXT_MAX = 4000

/**
 * Browsers and GitHub cut long addresses: the description and the steps are
 * shortened so the whole link stays under this length.
 */
const URL_MAX = 7500

export interface FeedbackContext {
  version: string
  commit: string | null
  /** Host name ("Vercel", "Docker"...). */
  host: string
  /** Route pattern of the page ("/[companyId]/entries/[entryId]"), never real ids. */
  page?: string | null
  displayMode?: string | null
  browser?: string | null
  language?: string | null
  /** Digest of a server error (error pages), to find it in the logs. */
  errorReference?: string | null
}

export interface FeedbackInput {
  kind: FeedbackKind
  title: string
  description: string
  /** Bug: steps to reproduce. Idea: the proposal. */
  details?: string
}

/** The context lines shown before sending and added to the issue. */
export function contextLines(context: FeedbackContext): string[] {
  const lines = [
    `Version\u00a0: ${context.version}${context.commit ? ` (${context.commit.slice(0, 7)})` : ''}`,
    `Hébergement\u00a0: ${context.host}`,
  ]
  if (context.page) lines.push(`Page\u00a0: ${context.page}`)
  if (context.displayMode) lines.push(`Mode d'affichage\u00a0: ${context.displayMode}`)
  if (context.browser) lines.push(`Navigateur\u00a0: ${context.browser}`)
  if (context.language) lines.push(`Langue\u00a0: ${context.language}`)
  if (context.errorReference) lines.push(`Référence de l'erreur\u00a0: ${context.errorReference}`)
  return lines
}

function clip(text: string, max: number): string {
  const trimmed = text.trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`
}

function withContext(text: string, context: FeedbackContext): string {
  return `${text}\n\n**Contexte technique** (ajouté par Kledg)\n${contextLines(context).map((line) => `- ${line}`).join('\n')}`
}

function build(repo: string, input: FeedbackInput, context: FeedbackContext, textMax: number): string {
  const template = FEEDBACK_TEMPLATES[input.kind]
  const params = new URLSearchParams({ template: template.file, title: clip(input.title, TITLE_MAX) })
  params.set(template.description, withContext(clip(input.description, textMax), context))
  const details = input.details ? clip(input.details, textMax) : ''
  if (input.kind === 'bug') {
    if (details) params.set(FEEDBACK_TEMPLATES.bug.steps, details)
    params.set(FEEDBACK_TEMPLATES.bug.version, `${context.version}${context.commit ? ` (${context.commit.slice(0, 7)})` : ''}`)
  } else if (details) {
    params.set(FEEDBACK_TEMPLATES.idea.proposal, details)
  }
  return `https://github.com/${repo}/issues/new?${params.toString()}`
}

/** Link to the prefilled issue form. */
export function feedbackIssueUrl(repo: string, input: FeedbackInput, context: FeedbackContext): string {
  if (!isFeedbackRepo(repo)) throw new Error(`Invalid feedback repository: ${repo}`)
  let max = TEXT_MAX
  let url = build(repo, input, context, max)
  while (url.length > URL_MAX && max > 200) {
    max = Math.floor(max * 0.8)
    url = build(repo, input, context, max)
  }
  return url
}

/** Search of the repository's issues with the words of the title ("Est-ce déjà signalé ?"). */
export function feedbackSearchUrl(repo: string, title: string): string {
  if (!isFeedbackRepo(repo)) throw new Error(`Invalid feedback repository: ${repo}`)
  const words = clip(title, TITLE_MAX).replace(/["\\]/g, ' ').trim()
  return `https://github.com/${repo}/issues?${new URLSearchParams({ q: `is:issue ${words}` }).toString()}`
}

/**
 * Route pattern of a page: each segment that is a route parameter
 * (company slug, entry id...) becomes its name in brackets; query string
 * and hash are dropped.
 */
export function pagePattern(pathname: string, params: Record<string, string | string[] | undefined>): string {
  const path = pathname.split(/[?#]/)[0] || '/'
  const names = new Map<string, string>()
  for (const [name, value] of Object.entries(params)) {
    for (const v of Array.isArray(value) ? value : value ? [value] : []) names.set(v, name)
  }
  return path
    .split('/')
    .map((segment) => {
      if (!segment) return segment
      let decoded = segment
      try {
        decoded = decodeURIComponent(segment)
      } catch {
        // keep the raw segment
      }
      const name = names.get(decoded) ?? names.get(segment)
      if (name) return `[${name}]`
      // Ids that are not route parameters of this page (cuid, uuid, numbers) are hidden too.
      if (/^\d+$/.test(decoded) || /^c[a-z0-9]{20,}$/.test(decoded) || /^[0-9a-f-]{32,36}$/i.test(decoded)) return '[id]'
      return segment
    })
    .join('/')
}

/** "Firefox 140, Linux": browser and system, without the full user agent. */
export function browserLabel(userAgent: string): string | null {
  const browsers: Array<[string, RegExp]> = [
    ['Edge', /Edg\/(\d+)/],
    ['Opera', /OPR\/(\d+)/],
    ['Firefox', /Firefox\/(\d+)/],
    ['Chrome', /Chrome\/(\d+)/],
    ['Safari', /Version\/(\d+)[\d.]* .*Safari/],
  ]
  const systems: Array<[string, RegExp]> = [
    ['Android', /Android/],
    ['iOS', /iPhone|iPad|iPod/],
    ['Windows', /Windows/],
    ['macOS', /Mac OS X/],
    ['Linux', /Linux/],
  ]
  const browser = browsers.find(([, re]) => re.test(userAgent))
  const system = systems.find(([, re]) => re.test(userAgent))?.[0]
  if (!browser && !system) return null
  const name = browser ? `${browser[0]} ${userAgent.match(browser[1])?.[1] ?? ''}`.trim() : 'Navigateur inconnu'
  return system ? `${name}, ${system}` : name
}
