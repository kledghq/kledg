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
SELF_AUTHENTICATED_API_ROUTES: Record<string, string>
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
| `invite-member` | `POST /api/companies/[id]/members`, Better Auth `/organization/invite-member` |
| `delete-company` | `DELETE /api/companies/[id]`, Better Auth `/organization/delete` |
| `manage-updates` | GitHub actions of the "Mises à jour" page (`lib/updates/guard.ts`); the page shows the refusal message instead of the GitHub connection (`managementRefused` of `lib/updates/overview.ts`) |
| `connect-bank` | bank API connections (`lib/banking/guard.ts`: Revolut Business, Ponto) |
| `send-email` | `lib/email`: when refused, emails are written to the server log, and new members get a generated password instead of a welcome email |
| `setup` | `/` and `/setup`: when refused, the first-run setup never opens (`/setup` redirects to `/login`); accounts are provisioned otherwise |
| `onboarding` | the guided start: the welcome page after setup (`/welcome`, its user menu entry "État de l'instance"), the "Démarrer" checklist of company dashboards and its help menu entry (`GET/POST /api/companies/[id]/onboarding` answers `enabled: false`, hiding it is refused). Empty states of company pages then show their plain action. A demo instance with seeded companies would refuse it |

`SELF_AUTHENTICATED_API_ROUTES` maps API path prefixes to the reason they are
safe without a session (an API key, a `CRON_SECRET` bearer token). The
request proxy (`proxy.ts`) lets them through and the route architecture test
(`lib/api/__tests__/routes.test.ts`) accepts their handlers without a route
wrapper. Keep the policy file free of database and Node imports: the proxy
imports it.

To point Kledg's Qonto client at another API (a simulated one for tests or a
public sandbox instance), set `QONTO_API_URL`; no code change is needed.

## Interface slots (`components/instance/slots.tsx`)

All slots are server components; they may render client components and pass
them server actions (to create an account and sign it in, for instance).

| Slot | Rendered | Props |
|---|---|---|
| `InstanceBanner` | above the header of company and settings pages (`components/layout/app-shell.tsx`) | `user` |
| `LoginExtra` | above the sign-in card on `/login` | `redirectTo`: checked same-origin path to open after signing in |
| `CompanyOverlay` | after the content of company pages (`app/(company)/layout.tsx`); floating UI goes bottom right | `user` |
| `filterUserMenu(items, user)` | filters the account and instance pages (`components/layout/user-menu.ts`): the user menu entry (`inMenu`) and the settings sidebar links | returns the entries to show |
| `instanceSettingsLinks(user)` | for a user who is not an instance administrator: the instance's own versions of the administrators' pages, by user menu entry (`{ instance, users, updates }`, absolute URLs). The settings sidebar then shows the "Instance" group with these links only, the breadcrumb names them and the version line links to `updates`. Kledg returns null | returns the links or null |

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

