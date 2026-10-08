/**
 * Route wrappers: the single place where API handlers authenticate,
 * authorize and handle errors. Every app/api route must export handlers
 * built with one of these (enforced by lib/api/__tests__/routes.test.ts).
 *
 *   export const GET = companyRoute(
 *     { company: fromQuery(), permission: { reports: ['read'] }, query: TrialBalanceQuerySchema },
 *     async ({ companyId, query }) => NextResponse.json(await getTrialBalance(companyId, query)),
 *   )
 *
 * Input is validated with zod: `body` (JSON body) and `query` (query
 * string) options give the handler typed values, or answer 400 with the
 * issues before the handler runs.
 *
 * Every state-changing request is size capped and CSRF checked first
 * (lib/api/request-guards.ts): JSON up to 1 MB unless the route sets
 * `maxBodyBytes`, `multipart: true` for file routes.
 *
 * Company references in URLs, query strings and bodies may be a slug or an
 * id; resolvers always hand the handler the real company id. A user who is
 * not a member of the company gets a 404, exactly like a company (or a
 * resource) that does not exist, so ids of other companies are never confirmed.
 */

import { NextRequest, NextResponse } from 'next/server'
import type { z } from 'zod'
import { getCurrentUser, type CurrentUser } from '@/lib/session'
import {
  COMPANY_NOT_FOUND_MESSAGE,
  getUserRolesForCompany,
  isGlobalAdmin,
  rolesGrant,
  type Permission,
} from '@/lib/rbac/authorize'
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '@/lib/accounting/errors'
import { ROLE_LABELS } from '@/lib/permissions'
import { resolveCompanyRef } from '@/lib/companies/slug'
import { toErrorResponse } from '@/lib/api/errors'
import { FRENCH_ERRORS, parseInput } from '@/lib/api/zod-fields'
import { assertCompanyWritable } from '@/lib/companies/archive-company.service'
import { guardRequest, type BodyOptions } from '@/lib/api/request-guards'
import { withUserContext } from '@/lib/rls/context'

export { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/request-guards'

export type Params = Record<string, string | string[] | undefined>
type RouteContext = { params: Promise<Params> }

export interface RequestContext<TBody, TQuery = undefined> {
  request: NextRequest
  params: Params
  user: CurrentUser
  /** Parsed by `options.body` when given, else undefined. */
  body: TBody
  /** The query string parsed by `options.query` when given, else undefined. */
  query: TQuery
}

export interface CompanyRequestContext<TBody, TQuery = undefined> extends RequestContext<TBody, TQuery> {
  /** The real company id (never a slug). */
  companyId: string
  /** The user's roles in the company (['admin'] for instance administrators). */
  roles: string[]
  /** Whether the user also has `permission` (for actions that depend on the payload). */
  can: (permission: Permission) => boolean
  /** Throws a 403 unless the user also has `permission`. */
  authorize: (permission: Permission) => void
}

interface ResolverInput {
  request: NextRequest
  params: Params
  /** Lazily reads the JSON body (from a clone: the handler can still read the request). */
  json: () => Promise<unknown>
  /** Lazily reads multipart form data (from a clone). */
  formData: () => Promise<FormData>
}

/** How a route finds the company it acts on. Returns the real company id or throws. */
export type CompanyResolver = (input: ResolverInput) => Promise<string>

async function resolveRef(ref: string | null | undefined, missingMessage: string): Promise<string> {
  if (!ref) throw new ValidationError(missingMessage)
  const companyId = await resolveCompanyRef(ref)
  if (!companyId) throw new NotFoundError(COMPANY_NOT_FOUND_MESSAGE)
  return companyId
}

/** Company from a route segment, e.g. /api/companies/[id]. */
export const fromParam =
  (name = 'id'): CompanyResolver =>
  async ({ params }) => {
    const value = params[name]
    return resolveRef(typeof value === 'string' ? value : null, `Paramètre ${name} manquant`)
  }

/** Company from the query string (?companyId=). */
export const fromQuery =
  (name = 'companyId'): CompanyResolver =>
  async ({ request }) =>
    resolveRef(request.nextUrl.searchParams.get(name), `${name} est requis`)

/** Company from a field of the JSON body. */
export const fromBody =
  (name = 'companyId'): CompanyResolver =>
  async ({ json }) => {
    const body = (await json()) as Record<string, unknown> | null
    const value = body && typeof body === 'object' ? body[name] : undefined
    return resolveRef(typeof value === 'string' ? value : null, `${name} est requis`)
  }

/** Company from a field of a multipart form (file uploads). */
export const fromForm =
  (name = 'companyId'): CompanyResolver =>
  async ({ formData }) => {
    const value = (await formData()).get(name)
    return resolveRef(typeof value === 'string' ? value : null, `${name} est requis`)
  }

/** Company from the query string, else from the JSON body (routes called both ways). */
export const fromQueryOrBody =
  (name = 'companyId'): CompanyResolver =>
  async (input) => {
    if (input.request.nextUrl.searchParams.get(name)) return fromQuery(name)(input)
    return fromBody(name)(input)
  }

/**
 * Company of the resource the route acts on, e.g.
 *   fromResource((id) => prisma.accountingEntry.findUnique({ where: { id }, select: { companyId: true } }))
 * A missing resource is a 404; so is a resource of a company the user can't
 * see (requireCompanyAccess answers 404 to non-members).
 */
export const fromResource =
  (load: (id: string) => Promise<{ companyId: string | null } | null>, param = 'id'): CompanyResolver =>
  async ({ params }) => {
    const id = params[param]
    if (typeof id !== 'string' || !id) throw new NotFoundError('Ressource introuvable')
    const row = await load(id)
    if (!row?.companyId) throw new NotFoundError('Ressource introuvable')
    return row.companyId
  }

const INVALID_JSON_MESSAGE = 'Corps de requête JSON invalide'

function bodyReaders(request: NextRequest) {
  let text: Promise<string> | undefined
  let json: Promise<unknown> | undefined
  let form: Promise<FormData> | undefined
  const readText = () =>
    (text ??= request
      .clone()
      .text()
      .catch(() => ''))
  return {
    /** The raw body ('' when there is none). */
    text: readText,
    json: () =>
      (json ??= readText().then((raw) => {
        try {
          return JSON.parse(raw) as unknown
        } catch {
          throw new ValidationError(INVALID_JSON_MESSAGE)
        }
      })),
    formData: () =>
      (form ??= request
        .clone()
        .formData()
        .catch(() => {
          throw new ValidationError('Formulaire invalide')
        })),
  }
}

/** Validates `value` with `schema`; a 400 lists the zod issues with their path. */
const validate = parseInput

/**
 * The JSON body validated by `schema`. An empty body is `undefined`: a
 * schema ending in `.optional()` accepts it (routes whose body is
 * optional), any other schema answers 400 as for invalid JSON.
 */
async function parseBody<T>(readers: ReturnType<typeof bodyReaders>, schema?: z.ZodType<T>): Promise<T | undefined> {
  if (!schema) return undefined
  if (!(await readers.text()).trim()) {
    const parsed = schema.safeParse(undefined, { error: FRENCH_ERRORS })
    if (parsed.success) return parsed.data
    throw new ValidationError(INVALID_JSON_MESSAGE)
  }
  return validate(schema, await readers.json())
}

/**
 * The query string as an object, validated by `schema`. Each parameter is
 * a string (the last one when repeated: `?a=1&a=2` gives `{ a: '2' }`); an
 * empty value counts as absent, as the clients send `?fiscalYearId=` when
 * nothing is selected. Use `z.coerce` or a transform for numbers and
 * booleans.
 */
function parseQuery<T>(request: NextRequest, schema?: z.ZodType<T>): T | undefined {
  if (!schema) return undefined
  const values: Record<string, string> = {}
  for (const [key, value] of request.nextUrl.searchParams) {
    if (value !== '') values[key] = value
  }
  return validate(schema, values)
}

type Handler = (request: Request, context?: RouteContext) => Promise<Response>

/** Methods that never change state (RFC 9110). */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Marks handlers built here, for the architecture test. */
const ROUTE_WRAPPER = Symbol.for('kledg.routeWrapper')

function wrap(
  kind: string,
  run: (request: NextRequest, params: Params) => Promise<Response>,
  body: BodyOptions = {},
): Handler {
  const handler: Handler = async (request, context) => {
    try {
      // Next passes a NextRequest (possibly from another bundled copy of the
      // class, so no instanceof); tests may pass a plain Request.
      const incoming = 'nextUrl' in request ? (request as NextRequest) : new NextRequest(request)
      // Size cap and CSRF checks of state-changing requests (lib/api/request-guards.ts).
      const req = await guardRequest(incoming, body)
      const params = ((await context?.params) ?? {}) as Params
      return await run(req, params)
    } catch (error) {
      return toErrorResponse(error)
    }
  }
  Object.defineProperty(handler, ROUTE_WRAPPER, { value: kind })
  return handler
}

async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) throw new UnauthorizedError('Non authentifié')
  return user
}

/**
 * Authenticates, then runs the rest of the request as the signed-in user:
 * every statement carries the user's row level security context
 * (docs/rls.md), from the company resolver to the handler.
 */
async function asSignedInUser(run: (user: CurrentUser) => Promise<Response>): Promise<Response> {
  const user = await requireUser()
  return withUserContext(user.id, () => run(user))
}

/** Any signed-in user; the handler scopes its own data (e.g. the companies list). */
export function authedRoute<TBody = undefined, TQuery = undefined>(
  options: { body?: z.ZodType<TBody>; query?: z.ZodType<TQuery> } & BodyOptions,
  handler: (ctx: RequestContext<TBody, TQuery>) => Promise<Response>,
): Handler {
  return wrap('authed', (request, params) => asSignedInUser(async (user) => {
    const query = parseQuery(request, options.query) as TQuery
    const body = (await parseBody(bodyReaders(request), options.body)) as TBody
    return handler({ request, params, user, body, query })
  }), options)
}

/**
 * Instance administrators only (user role "admin"). With `company`, also
 * resolves the company (404 when it doesn't exist).
 */
export function adminRoute<TBody = undefined, TQuery = undefined>(
  options: { body?: z.ZodType<TBody>; query?: z.ZodType<TQuery>; company?: CompanyResolver } & BodyOptions,
  handler: (ctx: RequestContext<TBody, TQuery> & { companyId: string }) => Promise<Response>,
): Handler {
  return wrap('admin', (request, params) => asSignedInUser(async (user) => {
    if (!isGlobalAdmin(user)) {
      throw new ForbiddenError("Action réservée aux administrateurs de l'instance.")
    }
    const readers = bodyReaders(request)
    const companyId = options.company ? await options.company({ request, params, ...readers }) : ''
    const query = parseQuery(request, options.query) as TQuery
    const body = (await parseBody(readers, options.body)) as TBody
    return handler({ request, params, user, body, query, companyId })
  }), options)
}

function forbidden(userRoles: string[]): ForbiddenError {
  const label = userRoles.map((r) => ROLE_LABELS[r] ?? r).join(', ')
  return new ForbiddenError(`Action non autorisée : votre rôle (${label}) ne permet pas cette opération.`)
}

/** A route acting on one company: resolves it, then checks the user's role permission there. */
export function companyRoute<TBody = undefined, TQuery = undefined>(
  options: { company: CompanyResolver; permission: Permission; body?: z.ZodType<TBody>; query?: z.ZodType<TQuery> } & BodyOptions,
  handler: (ctx: CompanyRequestContext<TBody, TQuery>) => Promise<Response>,
): Handler {
  return wrap('company', (request, params) => asSignedInUser(async (user) => {
    const readers = bodyReaders(request)
    const companyId = await options.company({ request, params, ...readers })

    const admin = isGlobalAdmin(user)
    const userRoles = admin ? ['admin'] : await getUserRolesForCompany(user.id, companyId)
    if (userRoles.length === 0) throw new NotFoundError(COMPANY_NOT_FOUND_MESSAGE)
    const can = (permission: Permission) => admin || rolesGrant(userRoles, permission)
    const authorize = (permission: Permission) => {
      if (!can(permission)) throw forbidden(userRoles)
    }
    authorize(options.permission)
    // An archived company is read-only (lib/companies/archive-company.service.ts).
    if (!SAFE_METHODS.has(request.method)) await assertCompanyWritable(companyId)

    // Input is validated after authorization: a viewer gets 403, not the details of a 400.
    const query = parseQuery(request, options.query) as TQuery
    const body = (await parseBody(readers, options.body)) as TBody
    // The handler acts on this company only: its statements are narrowed to
    // it (row level security, docs/rls.md), so a query that forgets its
    // companyId cannot reach the user's other companies either.
    return withUserContext(user.id, () => handler({ request, params, user, body, query, companyId, roles: userRoles, can, authorize }), {
      companyIds: [companyId],
    })
  }), options)
}

export { NextResponse }
