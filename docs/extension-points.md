# Extension points

Kledg runs the same way on every instance. A deployment that needs to
customise it (a fork with its own pages, restrictions or interface) does so
through two files that Kledg keeps small and stable, instead of patching
layouts, routes and services. Both do nothing in Kledg: a standard instance
behaves exactly as if they did not exist.

| File | Side | What a fork changes there |
|---|---|---|
| `lib/instance/policy.ts` | server | which actions are allowed, to whom; API routes that authenticate themselves |
| `components/instance/slots.tsx` | interface | a banner, a card on `/login`, floating UI on company pages, user menu entries |

Everything else a fork adds lives in its own files (new routes, `lib/<fork>/`,
components, scripts), so merging Kledg into the fork only conflicts when
these two files change, which is rare.

## Instance policy (`lib/instance/policy.ts`)

```ts
isActionAllowed(action: InstanceAction, actor: InstanceActor | null): Promise<boolean>
actionRefusalMessage(action: InstanceAction): string
companyCreationRefusal(actor: InstanceActor): Promise<ActionRefusal | null>
afterCompanyCreated(companyId: string, actor: InstanceActor): Promise<void>
companyWriteRefusal(companyId: string): Promise<ActionRefusal | null>
companyIdentifierScope(companyId: string | null, actor: { id, role } | null): Promise<string[] | null>
randomCompanySlugSuffix(): boolean
requiresRowLevelSecurity(env): boolean
SELF_AUTHENTICATED_API_ROUTES: Record<string, string>
PUBLIC_PAGES: readonly string[]
SETUP_PENDING_REDIRECT: string | null
REQUIRE_EMAIL_VERIFICATION: boolean
INSTANCE_RATE_LIMITS: Record<string, RateLimitRule>
```

Kledg checks every restrictable action through `lib/instance`
(`assertActionAllowed`, `isActionAllowed`), which calls the policy. The
`actor` is the signed-in user ({ id, email, role }), or null for anonymous
requests, so a policy can differ per user (an administrator and a guest
account, for instance). A refused action answers 403 with
`actionRefusalMessage(action)` (French, shown to the user).

| Action (`InstanceAction`, `lib/instance/types.ts`) | Checked in |
|---|---|
| `change-password`, `change-email`, `delete-account` | the account routes of the Profil page (`app/api/account`, services in `lib/account`), and the Better Auth hook (`lib/auth.ts`, endpoint to action map `authActionOf` in `lib/instance/index.ts`) for direct calls |
| `manage-users` | the "Utilisateurs" page (`app/api/users/[id]`, `lib/users/instance-users.service.ts`: role, ban, email, deletion; the page shows the refusal message and disables its actions) and the Better Auth hook (`lib/auth.ts`, `authActionOf`) for account creation |
| `change-appearance` | `PUT /api/account/appearance` (chart colours, `lib/appearance/appearance.service.ts`); the Apparence page shows the refusal message and disables its colour controls (the theme stays available), and its user menu entry carries the action so `filterUserMenu` can hide it. Saved colours keep applying |
| `invite-member` | `POST /api/companies/[id]/members` (instance administrators), the invitations of company administrators (`lib/rbac/company-invitations.service.ts`: sending, sending again, and again at acceptance, so pending links stop working once refused; the actor is the inviter), Better Auth `/organization/invite-member`. See [membres-et-invitations.md](membres-et-invitations.md) |
| `invitation-sign-up` | the invitation page (`app/(auth)/invitation/[token]`, `acceptInvitation`), with a null actor: when refused, an invitee without an account cannot create one from the link; the page tells them to ask the instance administrator, who creates the account, then the same link accepts. Kledg allows it (the link proves the mailbox) |
| `remove-member` | the removal of a member and leaving a company (`lib/rbac/remove-member.service.ts`: `DELETE /api/companies/[id]/members/[memberId]`, `DELETE /api/companies/[id]/membership`, MCP `manage_members` action `remove`), with the user acting as actor, an instance administrator included. Kledg allows it; company administrators remove members within the rules of [membres-et-invitations.md](membres-et-invitations.md#retrait-dun-membre) |
| `delete-company` | `DELETE /api/companies/[id]`, Better Auth `/organization/delete` |
| `manage-updates` | GitHub actions of the "Mises à jour" page (`lib/updates/guard.ts`); the page shows the refusal message instead of the GitHub connection (`managementRefused` of `lib/updates/overview.ts`) |
| `connect-bank` | bank API connections (`lib/banking/guard.ts`: Revolut Business, Ponto) |
| `send-email` | `lib/email`: when refused, emails are written to the server log, and new members get a generated password instead of a welcome email |
| `setup` | `/` and `/setup`: when refused, the first-run setup never opens (`/setup` redirects to `/login`); accounts are provisioned otherwise |
| `onboarding` | the guided start: the Configuration page shown after setup (`/settings/configuration`, formerly `/welcome`, its user menu entry "Configuration"), the "Démarrer" checklist of company dashboards and its help menu entry (`GET/POST /api/companies/[id]/onboarding` answers `enabled: false`, hiding it is refused). Empty states of company pages then show their plain action. A demo instance with seeded companies would refuse it |

### Company creation

```ts
companyCreationRefusal(actor: InstanceActor): Promise<ActionRefusal | null>
afterCompanyCreated(companyId: string, actor: InstanceActor): Promise<void>
```

`companyCreationRefusal` decides who may create a company: the creation
wizard (`/companies/new`), its SIREN prefill (`GET /api/companies/lookup`)
and `POST /api/companies`. It answers null when `actor` may, else an
`ActionRefusal` (`lib/instance/types.ts`): a French message and an optional
link (`{ label, href }`, an upgrade page for instance). Kledg answers null
for instance administrators only, so nothing changes on a standard instance.
A fork that replaces the policy file must define it, which keeps company
creation closed until the fork decides otherwise.

When the policy lets a user who is not an instance administrator create a
company, that user becomes its administrator (`companyAdmin` member,
`lib/companies/create-company.service.ts`), the root page sends a user
without a company to the wizard, and the companies page shows the "Créer"
button. A refusal answers 403 with the message, its link in the response
(`{ error, link }`); the wizard page shows the message and the link instead
of the form. `afterCompanyCreated` runs once the company is ready (a fork
records who owns it, for instance); Kledg does nothing there. When it
throws, the company is removed (with its organization and memberships) and
the request fails: no company stays that the instance did not take in
charge (an unbilled, unrestricted company).

### Read-only companies

```ts
companyWriteRefusal(companyId: string): Promise<ActionRefusal | null>
```

Checked by `assertCompanyWritable` (`lib/companies/archive-company.service.ts`)
after the archive check, so on every state-changing request of a company
route (`companyRoute`) and every MCP tool that does more than read. A refusal
answers 409 with its message and link (`{ error, link }`); reads, reports
and exports (all GET) keep working. A fork makes a company read-only this
way (an unpaid subscription, a legal hold) without hiding any data. Kledg
answers null.

A read-only company also stops receiving bank operations
(`lib/banking/sync-pause.ts`): the daily bank sync skips it and every manual
sync returns without calling the bank, recording nothing, so its last sync
date stays. Once the policy answers null again, the next sync reads from that
date and catches up the paused period.

### Company identifiers

```ts
companyIdentifierScope(companyId: string | null, actor: { id, role } | null): Promise<string[] | null>
randomCompanySlugSuffix(): boolean
```

A company's SIREN and its establishments' SIRETs are unique within the scope
`companyIdentifierScope` answers: the ids of the companies they must differ
from, or null for every company of the instance (Kledg). `companyId` is the
company whose SIREN or establishment changes, null for a creation, where
`actor` is the user creating it. It is checked by the creation wizard and
`POST /api/companies`, the MCP tool `create_company`, `PATCH
/api/companies/[id]` and the establishment routes
(`lib/companies/identifiers.ts`). An instance whose customers share one
database answers the customer's own companies: a customer can then neither
block another business's SIREN (SIRENs are public) nor learn which
businesses are customers. Such an instance drops the unique indexes on
`companies.siren` and `establishments.siret` in its own migration.

The slug is part of company URLs and stays unique across the instance. When
`randomCompanySlugSuffix` answers true, every slug gets a random suffix of six
letters and digits, the generated ones and those a user types alike, and a
typed slug is never refused for being taken: no answer depends on the slugs
of companies the user cannot see. Kledg: false, slugs follow the name and
are numbered on collision.

`lib/instance/route-coverage.ts` (`INSTANCE_ROUTE_COVERAGE`) declares the
MCP coverage of the instance's own routes: for each `METHOD /api/path`, the
MCP tools doing the same, or a French reason why it stays out of the MCP
server. The MCP coverage guard (`lib/mcp/__tests__/route-coverage.test.ts`)
reads it with Kledg's own map, so a fork never edits `lib/mcp/route-coverage.ts`.
Kledg declares none.

`SELF_AUTHENTICATED_API_ROUTES` maps API paths to the reason they are
safe without a session (an API key, a `CRON_SECRET` bearer token). A path
covers itself and the paths under it, matched on segments: `/api/demo`
never covers `/api/demo-admin`. The request proxy (`proxy.ts`) lets them through, the route architecture test
(`lib/api/__tests__/routes.test.ts`) accepts their handlers without a route
wrapper, and the route coverage guard
(`lib/__tests__/security/route-coverage.test.ts`) leaves them to their own
tests.

`REQUIRE_EMAIL_VERIFICATION` (Kledg: false) turns on Better Auth's
`requireEmailVerification` and `sendOnSignIn` (`lib/auth.ts`): an account
whose address is not confirmed is refused at sign-in, the login page says so
in French, and the attempt sends the confirmation link again. Member
accounts created from a company's Membres page are marked confirmed; other
accounts (first-run setup, Utilisateurs page) confirm at their first sign-in.
Better Auth's own sign-up endpoint stays closed (`disableSignUp`): an
instance with public sign-up serves its own sign-up route.

`INSTANCE_RATE_LIMITS` declares the rate limit rules of the instance's own
routes (`{ name: { window, max, message } }`). `enforceRateLimit(name,
subject)` (`lib/rate-limit.ts`) applies them like Kledg's rules, in the same
shared table; a name Kledg already uses keeps Kledg's rule, and every rule
is checked by `lib/__tests__/rate-limit.test.ts` (positive window and
maximum, French message without dashes). Kledg declares none.

`PUBLIC_PAGES` lists pages that open without a session (a sign-up page,
legal notices): the proxy lets each path and the paths under it through,
like `/login`. Kledg declares none.

`requiresRowLevelSecurity` (Kledg: false) makes row level security
mandatory: without `KLEDG_RLS=enforce` the server refuses to start
(`instrumentation.ts`) and the database client to open (`lib/prisma.ts`),
with an error naming the variable. A service whose customers share one
database answers true, so a missing variable can never turn their isolation
off.

`SETUP_PENDING_REDIRECT` is where `/setup` sends a visitor without the
installation link while the instance has no administrator yet (a hosted
service before launch: its waitlist). Kledg: `null`, the neutral
"Installation en cours" page.

Keep the policy file free of database and Node imports: the proxy
imports it. A hook that needs the database (a quota, a subscription) loads
its module inside the function (`const { check } = await import('@/lib/x')`),
so the proxy never runs it.

To point Kledg's Qonto client at another API (a simulated one for tests or a
public sandbox instance), set `QONTO_API_URL`; no code change is needed.

## Interface slots (`components/instance/slots.tsx`)

All slots are server components; they may render client components and pass
them server actions (to create an account and sign it in, for instance).

| Slot | Rendered | Props |
|---|---|---|
| `InstanceBanner` | above the header of company and settings pages (`components/layout/app-shell.tsx`) | `user` |
| `LoginExtra` | above the sign-in card on `/login` | `redirectTo`: checked same-origin path to open after signing in |
| `InstanceDocumentEnd` | at the end of `<body>` on every page, signed in or not (`app/layout.tsx`): an analytics or status script | `nonce`: the page CSP nonce |
| `CompanyOverlay` | after the content of company pages (`app/(company)/layout.tsx`); floating UI goes bottom right | `user` |
| `filterUserMenu(items, user)` | filters the account and instance pages (`components/layout/user-menu.ts`): the user menu entry (`inMenu`) and the settings sidebar links | returns the entries to show |
| `instanceSettingsLinks(user)` | for a user who is not an instance administrator: the instance's own versions of the administrators' pages, by user menu entry (`{ instance, users, updates }`, absolute URLs). The settings sidebar then shows the "Instance" group with these links only, the breadcrumb names them and the version line links to `updates`. Kledg returns null | returns the links or null |
| `instanceSettingsPages(user)` | the instance's own settings pages (a billing page, an operator console): `{ group: 'account' \| 'instance', title, url, icon }`, appended to the "Compte" group or to the "Instance" group (shown to instance administrators only) of the settings sidebar, and named by its breadcrumb. `icon` is a name of `INSTANCE_PAGE_ICONS` (`components/layout/settings-nav-config.ts`). Kledg returns none | returns the pages |

Each entry names the restrictable action it leads to (`action`), so a fork
can hide what its policy refuses (the Profil page has no action: it stays
visible and shows each refused action, `change-email`, `change-password`,
`delete-account`, disabled with `actionRefusalMessage`):

```ts
export async function filterUserMenu(items: UserMenuItem[], user: InstanceActor) {
  const allowed = await Promise.all(items.map((i) => !i.action || isActionAllowed(i.action, user)))
  return items.filter((_, index) => allowed[index])
}
```

A floating element rendered by `CompanyOverlay` should carry the
`data-instance-overlay` attribute: the statement import dialog then stays
open while the user interacts with it.

## External file source (statement import)

Interface added by a fork can hand files to the statement import dialog
(`components/features/banking/statement-drop.ts`). Register the file, then
hand over its token:

```ts
const token = registerExternalFile({ fileName, bankAccountId, load: () => downloadAsFile(url) })
// drag and drop
event.dataTransfer.setData(EXTERNAL_FILE_DRAG_TYPE, token)
// an "Importer" button: handled by the dialog when the page has one
const handled = !window.dispatchEvent(new CustomEvent(IMPORT_FILE_EVENT, { detail: { token }, cancelable: true }))
// otherwise, open the statements page (client-side navigation keeps the registry)
router.push(`/${companyId}/banking/statements?${IMPORT_FILE_PARAM}=${token}`)
```

Only tokens registered in the page are accepted: a drag from another site or
a crafted link cannot make the dialog load anything. The dialog announces
its state with `IMPORT_DIALOG_STATE_EVENT` (open, preview shown) so a panel
can fold away while a preview needs the room.

## Row level security

With `KLEDG_RLS=enforce` ([rls.md](rls.md)), every statement runs with the
context of its request: route wrappers, the MCP endpoint, crons, and the
session of server components and server actions. Code of a fork that runs
outside those paths (a script, a job that provisions or purges throwaway
companies, the demo's sandbox) sets its context with `lib/rls/context.ts`:

```ts
import { withSystemContext, withUserContext } from '@/lib/rls/context'

// A server job without a user, limited to the companies it handles.
await withSystemContext('instance-extension', () => purgeCompany(id), { companyIds: [id] })

// Work done for a user (an account created and signed in by the fork).
await withUserContext(userId, () => createDemoCompany(userId))
```

`'instance-extension'` is the reason reserved to forks; the system
context reaches every company when `companyIds` is absent, so pass it
whenever the job concerns known companies. The flags of the database
guards (`kledg.company_purge`, `kledg.closed_year_bypass`) still work inside
such a transaction. Add the file to the allowlist of
`lib/rls/__tests__/system-context-usage.test.ts` in the fork.

