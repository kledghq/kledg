/**
 * Finding registry for the permanent attack test suite (lib/__tests__/security).
 *
 * Every security test that documents a weakness references a finding id here.
 * - status 'open': a weakness this suite found; its test is enabled when the
 *   behaviour is already safe (regression), or skipped (demonstrating the gap
 *   without hanging/failing CI) when a fix is still owed. The skip tag is the
 *   finding id so the test turns on once fixed.
 * - status 'delegated': a weakness already being fixed by another workstream
 *   (listed in the pentest brief). Its test asserts the expected-secure
 *   behaviour and is skipped with the finding id until that fix lands.
 * - status 'fixed': fixed together with its (enabled) test; `fixedIn` names
 *   the commit of the fix.
 *
 * CVSS vectors are 3.1 base scores, author estimate.
 */

export interface Finding {
  id: string
  title: string
  status: 'open' | 'delegated' | 'fixed'
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical'
  cvss?: string
  area: string
  note: string
  /** Commit that fixed the finding (status 'fixed'). */
  fixedIn?: string
}

/** Weaknesses this suite is the first to document. */
export const NEW_FINDINGS = {
  'KLEDG-SEC-001': {
    id: 'KLEDG-SEC-001',
    title: 'User-controlled rule condition regex runs unbounded on every transaction (ReDoS)',
    status: 'fixed',
    fixedIn: '27a7e40',
    severity: 'medium',
    cvss: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:H', // 6.5
    area: 'injection/redos',
    note:
      'lib/transactions/rule-matcher.ts compiled new RegExp(conditionValue, "i") from a rule ' +
      'condition (RuleConditionSchema, <=500 chars, settable by any accountant via the rules API ' +
      'and via MCP create_rule/update_rule) and ran .test() against every transaction label, ' +
      'reference and counterparty on every list/reconcile/suggest. A catastrophic pattern such as ' +
      '"(a+)+$" against a crafted label blocked the event loop. Fixed: patterns run on a Thompson NFA ' +
      '(lib/transactions/rule-regex.ts, no dependency) whose cost is text length x program size, ' +
      'with a JavaScript-compatible subset (no backreferences or lookaround), at most 300 characters ' +
      'and 2000 states; createRule/updateRule refuse an unsupported pattern with a French ' +
      'ValidationError; each findMatchingRules call shares a 500k step budget; stored patterns the ' +
      'matcher refuses never match, are logged once and are listed as patternIssues by ' +
      'GET /api/transaction-rules (badge on the rules page). Covered by injection-redos.test.ts and ' +
      'lib/transactions/__tests__/rule-regex.test.ts (differential tests against RegExp).',
  },
  'KLEDG-SEC-002': {
    id: 'KLEDG-SEC-002',
    title: 'OFX parser: quadratic tokenizer, unbounded nesting, and RangeError on bad entities',
    status: 'fixed',
    fixedIn: '47fb300',
    severity: 'medium',
    cvss: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:H', // 6.5
    area: 'parsers',
    note:
      'lib/banking/import/ofx.ts used /<([^>]*)>([^<]*)/g (quadratic on a long run of "<" with no ">"), ' +
      'had no nesting/stack-depth cap (recursive all()/first() -> RangeError on deep SGML), and ' +
      'decodeEntities called String.fromCodePoint without a range check (&#x110000; threw an unhandled ' +
      'RangeError instead of a ValidationError). Reachable through the authenticated statement import. ' +
      'Fixed: the entity crash first (fromCodePointSafe), then the tokenizer became an indexOf scanner ' +
      '(linear) that refuses with a French ValidationError a nesting deeper than OFX_MAX_DEPTH (64), a tag ' +
      'longer than OFX_MAX_TAG_LENGTH (1 KiB) and a value longer than OFX_MAX_TEXT_LENGTH (64 KiB). ' +
      'Covered by parsers-xml-ofx.test.ts (pathological inputs and a seeded 2 MB fuzz corpus under a ' +
      'time budget) and parser-fuzz.test.ts.',
  },
  'KLEDG-SEC-003': {
    id: 'KLEDG-SEC-003',
    title: 'CSV formula injection in the depreciation export',
    status: 'fixed',
    severity: 'medium',
    cvss: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:R/S:C/C:L/I:L/A:N', // ~5.3
    area: 'injection/export',
    note:
      'app/(company)/[companyId]/reports/depreciation/page.tsx built CSV rows by row.join(";") with no ' +
      'neutralisation of cells starting with = + - @ (and no quoting of ; or newlines). An asset label ' +
      'like "=HYPERLINK(...)" was evaluated when the exported file is opened in a spreadsheet. Fixed: the ' +
      'page now builds the CSV through buildCsv in lib/reports/csv-safe.ts, which prefixes formula leaders ' +
      'and RFC-4180-quotes separators/newlines. Covered by export-injection.test.ts.',
  },
  'KLEDG-SEC-004': {
    id: 'KLEDG-SEC-004',
    title: 'FEC cleanEntryNumber regex is quadratic on crafted entry numbers',
    status: 'fixed',
    fixedIn: 'a0af690',
    severity: 'low',
    cvss: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:L', // ~4.3
    area: 'injection/redos',
    note:
      'lib/import/fec/plan.ts cleanEntryNumber used /(\\d+)(?!.*\\d)/ with a negative lookahead that is ' +
      'quadratic on a long EcritureNum mixing digits and letters (e.g. "1a".repeat(n)) when the ' +
      'cleanEntryNumbers import option is on. Fixed: one backward scan finds the last digit run and ' +
      'strips its leading zeros as text (linear, and no float rounding of long runs). Covered by ' +
      'injection-redos.test.ts.',
  },
  'KLEDG-SEC-005': {
    id: 'KLEDG-SEC-005',
    title: 'Qonto file URL allowlist trusts any *.amazonaws.com host and never resolves DNS',
    status: 'fixed',
    fixedIn: 'c56160a',
    severity: 'low',
    cvss: 'CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:U/C:L/I:N/A:N', // ~3.1
    area: 'ssrf',
    note:
      'lib/integrations/providers/qonto/files.ts isAllowedQontoFileUrl allowed any host matching ' +
      '/(^|\\.)amazonaws\\.com$/, including arbitrary third-party S3 buckets and ec2-*.compute.amazonaws.com ' +
      'names that resolve to private addresses from inside AWS. It blocked IP literals but never resolved ' +
      'the hostname, so DNS rebinding was not prevented. Exploitation requires influencing the URL in a ' +
      'Qonto payload, hence high complexity; documented as hardening. Fixed: only Qonto domains and S3 ' +
      'buckets named qonto* in the virtual-hosted form (Qonto documents pre-signed links on its bucket, ' +
      'e.g. qonto-dev.s3.eu-central-1.amazonaws.com, and publishes no fixed production host), https on ' +
      'the default port, redirects refused; the download goes through lib/integrations/public-https-fetch.ts, ' +
      'whose socket lookup refuses loopback, private, link-local, CGNAT, multicast and reserved addresses ' +
      '(IPv4-mapped and NAT64 included) at connect time, so rebinding cannot swap the address after the ' +
      'check. Covered by ssrf.test.ts.',
  },
  'KLEDG-SEC-006': {
    id: 'KLEDG-SEC-006',
    title: 'Provider file download buffers the whole body before the size check when content-length is absent',
    status: 'fixed',
    fixedIn: 'c56160a',
    severity: 'low',
    cvss: 'CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:U/C:N/I:N/A:L', // ~2.6
    area: 'ssrf',
    note:
      'lib/integrations/providers/qonto/files.ts fetchQontoFile read response.arrayBuffer() in full before ' +
      'comparing byteLength to MAX_PROVIDER_FILE_BYTES; a response with no content-length and a very large ' +
      'body was fully buffered in memory first. Fixed: the body is read chunk by chunk with a byte budget, ' +
      'the stream is cancelled and the request aborted as soon as it passes 25 MiB (also when the declared ' +
      'content-length lies). Covered by ssrf.test.ts (endless stream test).',
  },
  'KLEDG-SEC-007': {
    id: 'KLEDG-SEC-007',
    title: 'An MCP connection with no grant row is scoped to every company',
    status: 'fixed',
    severity: 'low',
    cvss: 'CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:L/I:L/A:N', // ~4.6
    area: 'authorization/mcp',
    note:
      'Fixed: a missing grant means no company (fail closed); the consent page and API key creation always save a grant; migration 20261011120000_explicit_ai_access wrote an every-company grant for older consents and keys. mcp-authorization.db.test.ts, lib/ai-access/__tests__/explicit-access-migration.db.test.ts. ' +
      'lib/ai-access/access.ts toAccess(null) returns ALL_COMPANIES, so an API key or OAuth client whose ' +
      'aiAccessGrant row is missing reaches every company the user belongs to (still bounded by the ' +
      'user role). Documented: fail-open default rather than fail-closed.',
  },
  'KLEDG-SEC-008': {
    id: 'KLEDG-SEC-008',
    title: 'An API key with no kledg permission defaults to write level',
    status: 'fixed',
    severity: 'low',
    cvss: 'CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:N/I:L/A:N', // ~4.0
    area: 'authorization/mcp',
    note:
      'Fixed: a key without a kledg level is read-only; migration 20261011120000_explicit_ai_access wrote the write level of older keys. mcp-authorization.db.test.ts. ' +
      'lib/ai-access/access.ts apiKeyLevelOf returns "write" when permissions.kledg is absent, so a key ' +
      'created without an explicit scope can create draft entries via MCP rather than defaulting to read.',
  },
  'KLEDG-SEC-009': {
    id: 'KLEDG-SEC-009',
    title: 'Password-reset request leaks account existence through response timing',
    status: 'fixed',
    severity: 'low',
    cvss: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N', // ~3.7
    area: 'auth/enumeration',
    note:
      'The request-password-reset handler awaits sendResetPassword only for an existing account, so the ' +
      'response was measurably slower for a known email than for an unknown one, despite the identical ' +
      'body. Fixed: the hook hands the delivery to waitUntil (lib/auth.ts), so the response no longer ' +
      'waits for the email. Residual: one verification row insert vs a lookup, well under network jitter. ' +
      'lib/__tests__/security/reset-timing.db.test.ts.',
  },
  'KLEDG-SEC-010': {
    id: 'KLEDG-SEC-010',
    title: 'Concurrent management fee generations invoice a subsidiary or a period twice',
    status: 'fixed',
    fixedIn: '0389592',
    severity: 'low',
    cvss: 'CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:U/C:N/I:L/A:N', // 3.1
    area: 'business-logic/race',
    note:
      'lib/management-fees/bill-management-fees.service.ts generateManagementFeeInvoices checked the overlap with ' +
      'invoiced periods, then looked each billing up and created the sales invoice, each step in its own statement ' +
      'and without a lock. Two generations of one convention at once (a double click, two tabs, two users with ' +
      'entries:create in the holding) both passed the checks: three concurrent runs of the same quarter recorded 4 ' +
      'draft sales invoices for 2 subsidiaries (one billing pointing at the last one, the others orphaned in the ' +
      'invoice series, CGI ann. II art. 242 nonies A), and Q1 with February to April both succeeded (overlapping ' +
      'periods invoiced, i.e. management fees charged twice to a subsidiary); some runs failed with a raw unique ' +
      'violation (500). In the subsidiary, six concurrent runs with purchaseDrafts recorded 2 or 3 supplier tiers ' +
      'for the holding and as many draft purchase invoices of one number (a write duplicated in another company). ' +
      'Drafts only, nothing posted, hence low. Fixed: the holding side (overlap check again, billings, tiers, sales ' +
      'invoices) runs in one transaction under pg_advisory_xact_lock per convention and reads the state again ' +
      'there (0389592); the purchase draft of a subsidiary is found or created in one transaction under a lock per ' +
      'subsidiary, in its own scope (772c16c); createInvoice accepts the caller transaction. ' +
      'lib/management-fees/__tests__/management-fees.db.test.ts ([KLEDG-SEC-010] tests, also under KLEDG_RLS=enforce).',
  },
  'KLEDG-SEC-011': {
    id: 'KLEDG-SEC-011',
    title: 'Account pre-registration takeover when an unconfirmed address is added to a company',
    status: 'fixed',
    fixedIn: '13431d1',
    severity: 'medium',
    cvss: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:H/I:H/A:N', // 6.8
    area: 'auth/account',
    note:
      'Tracked in kledg-cloud as KLEDG-CLOUD-004. lib/rbac/add-member-to-company.service.ts addMemberToCompany ' +
      'reused an existing user found by email as is. On an instance whose policy opens sign-up and requires ' +
      'confirmed addresses (the hosted policy), an attacker registers a colleague\'s address before an ' +
      'administrator adds it to a company: the account keeps the attacker\'s password, sessions, API keys and ' +
      'assistant grants (an all-companies key then reaches the new company), and opens to the attacker once the ' +
      'victim confirms the address. Fixed: an account whose address was never confirmed is reset like a new one ' +
      'before the membership is granted (sessions ended, password replaced, other sign-in methods, API keys, ' +
      'OAuth consents and tokens, assistant grants, pending assistant actions and reset tokens removed, address ' +
      'confirmed by the welcome link, or a generated password returned without email); confirmed accounts are ' +
      'added as before. lib/__tests__/security/account-preregistration.db.test.ts (policy with ' +
      'REQUIRE_EMAIL_VERIFICATION).',
  },
  'KLEDG-SEC-012': {
    id: 'KLEDG-SEC-012',
    title: 'A failing after-creation instance hook leaves an unassigned company',
    status: 'fixed',
    fixedIn: 'af23c2b',
    severity: 'medium',
    cvss: 'CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:U/C:N/I:H/A:N', // 5.3
    area: 'business-logic/instance-policy',
    note:
      'Tracked in kledg-cloud as KLEDG-CLOUD-006. POST /api/companies created the company (and made a user creator ' +
      'its administrator), then called the instance hook afterCompanyCreated (ownership, billing assignment of a ' +
      'hosted instance) outside any rollback: a hook failure answered 500 but kept the company, unbilled and outside ' +
      'the instance\'s restrictions (companyWriteRefusal reads what the hook records). Fixed: createCompany runs the ' +
      'hook before answering and, when it throws, removes the company with its organization and memberships in the ' +
      'context it was created in, then fails the request; nothing blocks a new attempt. Kledg\'s own hook does ' +
      'nothing, so a standard instance was not affected. app/api/__tests__/company-creation-policy.db.test.ts ' +
      '([KLEDG-SEC-012], throwing hook).',
  },
  'KLEDG-SEC-013': {
    id: 'KLEDG-SEC-013',
    title: 'Audit log purge function: SECURITY DEFINER without pg_temp last, executable by the application role',
    status: 'fixed',
    fixedIn: '33913f5',
    severity: 'info',
    cvss: 'CVSS:3.1/AV:N/AC:H/PR:H/UI:N/S:U/C:N/I:N/A:N', // 0.0, hardening
    area: 'rls/definer-functions',
    note:
      'Documented in pentest round 2 (hardening). kledg_purge_audit_logs (migration 20261011090000_audit_log_append_only) ' +
      'was SECURITY DEFINER with search_path = public only, so pg_temp was searched first, and PUBLIC and the application ' +
      'role could execute it (GRANT EXECUTE ON ALL FUNCTIONS of db:rls-role). It only deletes rows older than 10 years ' +
      'and reaching it needs SQL injection, hence no impact today. Fixed: migration 20261029090000_definer_function_hardening ' +
      'sets search_path = public, pg_temp on every SECURITY DEFINER function missing it and revokes EXECUTE on the purge and ' +
      'on kledg_assert_fiscal_year_open (called only from definer triggers) from every role but the owner; db:rls-role ' +
      'revokes them again after its blanket grant (lib/rls/app-role.ts OWNER_ONLY_FUNCTIONS). ' +
      'lib/rls/__tests__/policy-coverage.db.test.ts lists every definer function from pg_proc ([KLEDG-SEC-013]); ' +
      'lib/audit/__tests__/append-only.db.test.ts runs the purge as the owner and refuses it to the application role.',
  },
  'KLEDG-SEC-014': {
    id: 'KLEDG-SEC-014',
    title: 'Read-only company check fails open when the company is invisible',
    status: 'fixed',
    fixedIn: 'a96e87f',
    severity: 'info',
    cvss: 'CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:U/C:N/I:N/A:N', // 0.0, hardening
    area: 'authorization/archive',
    note:
      'Documented in pentest round 2 (hardening). assertCompanyWritable (lib/companies/archive-company.service.ts) read ' +
      'company?.archivedAt: a company missing or invisible to the row level security context passed as writable. Every ' +
      'caller ran in a context that sees the company, so it held. Fixed: a missing or invisible company is the usual ' +
      '"Société introuvable" 404. lib/companies/__tests__/company-write-refusal.db.test.ts ([KLEDG-SEC-014], also under ' +
      'KLEDG_RLS=enforce with a scope that hides an archived company).',
  },
  'KLEDG-SEC-015': {
    id: 'KLEDG-SEC-015',
    title: 'Amounts beyond the Decimal(15, 2) columns answer a generic 500',
    status: 'fixed',
    fixedIn: 'b5fd673',
    severity: 'info',
    cvss: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:N', // 0.0, robustness
    area: 'validation/amounts',
    note:
      'Documented in pentest round 2. An invoice of 200 lines at the maximum unit price, or one line of a huge quantity, ' +
      'exceeded Decimal(15, 2) and the database refused it: a generic 500 instead of a French 400 (no corruption, values ' +
      'within the range are exact). Fixed centrally: lib/utils/money.ts MAX_AMOUNT_CENTS, fitsAmountColumn, ' +
      'exceedsAmountColumn, amountTooLargeMessage and lib/api/zod-fields.ts centsField; invoices check every line total, ' +
      'VAT row and total before the write and in the MCP dry run (lib/invoices/amount-bounds.ts, a6262e6), the Qonto ' +
      'mapping refuses such a document, unit prices, expense lines and budget amounts use centsField, and an entry amount ' +
      'beyond the column answers "Montant trop élevé". [KLEDG-SEC-015] tests in app/api/__tests__/invoice-routes.db.test.ts, ' +
      'budget-routes.db.test.ts, expense-report-routes.db.test.ts, business-logic.db.test.ts (entries) and ' +
      'lib/invoices/__tests__/qonto-mapping.test.ts.',
  },
  'KLEDG-SEC-016': {
    id: 'KLEDG-SEC-016',
    title: 'Self-authenticated API paths matched by plain prefix',
    status: 'fixed',
    fixedIn: '022c9e1',
    severity: 'info',
    cvss: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:N', // 0.0, hardening
    area: 'auth/proxy',
    note:
      'Documented in pentest round 2 (hardening). isSelfAuthenticatedApiPath (lib/instance/api-paths.ts) used startsWith: ' +
      'a fork declaring /api/demo also let /api/demo-admin through the proxy without a session (handlers keep their own ' +
      'authentication, and Kledg declares no path). Fixed: a declared path covers itself and the paths under it, on ' +
      'segment boundaries, with or without a trailing slash. lib/instance/__tests__/api-paths.test.ts ([KLEDG-SEC-016]).',
  },
  'KLEDG-SEC-017': {
    id: 'KLEDG-SEC-017',
    title: 'Holding helpers widen the row level security scope to every company of the user',
    status: 'fixed',
    fixedIn: '15d46e9',
    severity: 'info',
    cvss: 'CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:U/C:N/I:N/A:N', // 0.0, hardening
    area: 'rls/management-fees',
    note:
      'Documented in pentest round 2 (hardening). listHoldingRefs and listSubsidiaryCandidates (lib/management-fees/holding.ts) ' +
      'called withUserContext(user.id) without companies inside a route narrowed to the holding; every candidate was then ' +
      'checked with inCompany(reports:read) and no MCP tool called them, so nothing leaked, but a future MCP caller would ' +
      'have lost its grant narrowing. Fixed: listHoldingRefs runs narrowed to the companies of the switcher; the subsidiary ' +
      'lookup finds the ids within the access\'s own bound (GroupAccess.companyIds, the MCP company grant through ' +
      'CompanyGuard.companyIds), then reads the rows narrowed to the holding and those subsidiaries. ' +
      'lib/management-fees/__tests__/management-fees.db.test.ts ([KLEDG-SEC-017], also under KLEDG_RLS=enforce).',
  },
} as const satisfies Record<string, Finding>

/** Weaknesses the brief says another workstream is already fixing. Tests are expected-secure, skipped. */
export const DELEGATED_FINDINGS = {
  'KLEDG-DEL-company-delete': { id: 'KLEDG-DEL-company-delete', title: 'Company deletion by companyAdmin', status: 'fixed', severity: 'high', area: 'authorization', note: 'Fixed: deletion is instance-admin only, refused (and by a database trigger) once the company holds validated entries or a closed year; archiving instead; audited. app/api/__tests__/company-deletion.db.test.ts.' },
  'KLEDG-DEL-setup-takeover': { id: 'KLEDG-DEL-setup-takeover', title: 'Setup takeover without SETUP_TOKEN', status: 'fixed', severity: 'critical', area: 'auth', note: 'Fixed: /setup refuses without a SETUP_TOKEN of 16+ characters. lib/__tests__/setup-token.test.ts, setup-race.test.ts.' },
  'KLEDG-DEL-anon-companies': { id: 'KLEDG-DEL-anon-companies', title: 'Anonymous /companies listing', status: 'fixed', severity: 'high', area: 'authorization', note: 'Fixed: the /companies page requires the user itself. app/(account)/companies/__tests__/page.test.ts; route-coverage.test.ts.' },
  'KLEDG-DEL-reset-sessions': { id: 'KLEDG-DEL-reset-sessions', title: 'Sessions survive password reset', status: 'fixed', severity: 'high', area: 'auth/session', note: 'Fixed: reset revokes every session, change revokes the others by default, getCurrentUser confirms the session row. lib/account/__tests__/session-revocation.db.test.ts.' },
  'KLEDG-DEL-upload-zipbomb': { id: 'KLEDG-DEL-upload-zipbomb', title: 'Upload size and zip bomb', status: 'fixed', severity: 'medium', area: 'parsers', note: 'Fixed: bodies counted while streamed with a hard cap; xlsx entries really inflated under a byte budget. lib/api/__tests__/request-guards.test.ts, zip-bomb.test.ts.' },
  'KLEDG-DEL-bank-connect-guard': { id: 'KLEDG-DEL-bank-connect-guard', title: 'Bank connect guard bypass', status: 'fixed', severity: 'high', area: 'authorization', note: 'Fixed: guardBankConnect on Qonto connect, POST /api/integrations and the verify routes. app/api/__tests__/bank-connect-guard.test.ts.' },
  'KLEDG-DEL-mcp-self-confirm': {
    id: 'KLEDG-DEL-mcp-self-confirm',
    title: 'MCP self-confirmation',
    status: 'fixed',
    severity: 'medium',
    area: 'authorization/mcp',
    note:
      'Fixed for validation mode: high-impact actions of a connection in "Validation dans Kledg" mode are approved by the user in Kledg ' +
      '(session, password); the agent gets no token; accepted risk in automatic mode, owner decision, 2026-10-04: a connection in ' +
      '"Automatique" mode (the default for full control, chosen per assistant and per API key) executes high-impact tools on the call, ' +
      'so a prompt injection in the data (a bank label, a statement) could make the assistant act; still bounded by kledg:admin, the ' +
      'company grant, the user role, the rate limit, the audit log ("mode automatique") and the accounting invariants of the services ' +
      'and triggers. SECURITY.md. lib/mcp/__tests__/full-control.db.test.ts, ai-action-approval.db.test.ts, mcp-authorization.db.test.ts.',
  },
  'KLEDG-DEL-consent-spoof': { id: 'KLEDG-DEL-consent-spoof', title: 'Consent branding spoof', status: 'fixed', severity: 'medium', area: 'oauth', note: 'Fixed: branding only for CIMD client ids on claude.ai / chatgpt.com; others "Application non vérifiée". components/features/settings/__tests__/assistant-kind.test.ts.' },
  'KLEDG-DEL-ip-spoofing': { id: 'KLEDG-DEL-ip-spoofing', title: 'IP spoofing', status: 'fixed', severity: 'medium', area: 'auth', note: 'Fixed: proxy headers trusted only with TRUST_PROXY_HOPS, RATE_LIMIT_IP_HEADER or on Vercel (lib/client-ip.ts). lib/__tests__/client-ip.db.test.ts.' },
  'KLEDG-DEL-admin-role-cache': { id: 'KLEDG-DEL-admin-role-cache', title: 'Admin role cache', status: 'fixed', severity: 'medium', area: 'authorization', note: 'Fixed: Better Auth /admin/* closed over HTTP; accounts created through POST /api/users; getCurrentUser reads role and ban from the database. lib/users/__tests__/admin-endpoints.db.test.ts.' },
  'KLEDG-DEL-security-headers': { id: 'KLEDG-DEL-security-headers', title: 'Missing security headers', status: 'fixed', severity: 'low', area: 'headers', note: 'Fixed: static headers in next.config.ts and a nonce CSP from proxy.ts. lib/__tests__/security-headers.test.ts.' },
  'KLEDG-DEL-csrf-json': { id: 'KLEDG-DEL-csrf-json', title: 'CSRF on JSON routes', status: 'fixed', severity: 'medium', area: 'auth', note: 'Fixed: cookie requests must be same origin and JSON (multipart on file routes) in the route wrappers. lib/api/__tests__/request-guards.test.ts.' },
  'KLEDG-DEL-audit-mutability': { id: 'KLEDG-DEL-audit-mutability', title: 'Audit log mutability', status: 'fixed', severity: 'medium', area: 'audit', note: 'Fixed: append-only trigger with a 10 year purge function; member changes audited. lib/audit/__tests__/append-only.db.test.ts.' },
  'KLEDG-DEL-unvalidated-bodies': { id: 'KLEDG-DEL-unvalidated-bodies', title: 'Unvalidated bodies', status: 'fixed', severity: 'low', area: 'validation', note: 'Fixed: the listed routes validate with zod; integration feature config bounded. app/api/__tests__/route-bodies.test.ts.' },
} as const satisfies Record<string, Finding>

export type NewFindingId = keyof typeof NEW_FINDINGS
export type DelegatedFindingId = keyof typeof DELEGATED_FINDINGS

/** Skip-tag helper: `it.skip(skip('KLEDG-SEC-001', 'short reason'), ...)`. */
export function skip(id: NewFindingId | DelegatedFindingId, reason: string): string {
  return `[${id}] ${reason}`
}
