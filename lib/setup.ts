import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";

/** An instance needs setup until its first user exists. */
export async function needsSetup(): Promise<boolean> {
  return (await prisma.user.count()) === 0;
}

/**
 * Email allowed to create the first administrator account. When set, nobody
 * else can claim a freshly deployed instance through /setup.
 */
export function getSetupAdminEmail(): string | null {
  return process.env.ADMIN_EMAIL?.trim().toLowerCase() || null;
}

/**
 * One-time secret required by /setup. Mandatory: without it, the first
 * visitor of a freshly deployed instance would become its administrator.
 * ADMIN_EMAIL is not a secret (it often appears on the company website), so
 * it narrows who may claim the instance but never replaces the token. The
 * Vercel deploy button asks for SETUP_TOKEN (its `env` parameter lists
 * required variables); Docker and other hosts set it in their environment.
 */
export function getSetupToken(): string | null {
  return process.env.SETUP_TOKEN?.trim() || null;
}

/** Shortest accepted SETUP_TOKEN: `openssl rand -base64 24` gives 32 characters. */
export const MIN_SETUP_TOKEN_LENGTH = 16;

/** Whether SETUP_TOKEN is usable: 'ok', 'missing' or 'weak' (shorter than MIN_SETUP_TOKEN_LENGTH). */
export function setupTokenStatus(): "ok" | "missing" | "weak" {
  const token = getSetupToken();
  if (!token) return "missing";
  return token.length < MIN_SETUP_TOKEN_LENGTH ? "weak" : "ok";
}

/** Constant-time comparison with SETUP_TOKEN; false when no usable token is configured. */
export function isValidSetupToken(given: string | null | undefined): boolean {
  if (setupTokenStatus() !== "ok") return false;
  const expected = getSetupToken() as string;
  if (!given) return false;
  const a = Buffer.from(given.trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * What /setup shows: why setup is blocked (no usable SETUP_TOKEN), the form
 * (the link carries the right token), or a neutral page. The form is never
 * shown to a visitor without the token: a public instance (a hosted service
 * before its operator account exists) does not invite strangers to claim it,
 * and the page does not say whether a guessed token was close.
 */
export function setupView(
  urlToken: string | null | undefined,
): "blocked" | "form" | "pending" {
  if (setupTokenStatus() !== "ok") return "blocked";
  return isValidSetupToken(urlToken) ? "form" : "pending";
}

/** Arbitrary constant identifying the setup advisory lock. */
const SETUP_LOCK_KEY = 4_217_001;

export class SetupAlreadyDoneError extends Error {
  constructor() {
    super("Cette instance est déjà configurée.");
    this.name = "SetupAlreadyDoneError";
  }
}

/**
 * Runs `create` only if the instance has no user yet, under a PostgreSQL
 * transaction-level advisory lock: two concurrent /setup submissions are
 * serialized, and the second one sees the first user and fails.
 * `create` must commit the user before returning (Better Auth does).
 */
export async function runFirstUserCreation<T>(
  create: () => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SETUP_LOCK_KEY})`;
      if ((await tx.user.count()) > 0) throw new SetupAlreadyDoneError();
      return create();
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
}
