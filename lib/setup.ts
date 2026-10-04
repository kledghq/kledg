import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { getAppUrl } from "@/lib/config";
import { isEmailEnabled, sendEmail } from "@/lib/email";
import { setupLinkEmail } from "@/lib/email/templates";

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
 * How the first administrator proves they own the instance:
 * - "token": SETUP_TOKEN is set, /setup?token=<SETUP_TOKEN> opens the form;
 * - "email": no SETUP_TOKEN, but ADMIN_EMAIL is set and the instance can send
 *   emails (RESEND_API_KEY, which the Vercel deploy button provisions with
 *   Resend): /setup sends a one-time link to ADMIN_EMAIL. Receiving it proves
 *   control of that mailbox, like a password reset, so nobody else can claim
 *   the instance and there is no secret to generate and paste;
 * - "blocked": neither, or a SETUP_TOKEN that is too short.
 * An explicit SETUP_TOKEN always wins, even when emails are available.
 */
export async function setupMode(): Promise<"token" | "email" | "blocked"> {
  const token = setupTokenStatus();
  if (token === "ok") return "token";
  if (token === "weak") return "blocked";
  return getSetupAdminEmail() && (await isEmailEnabled()) ? "email" : "blocked";
}

/** Verification rows holding the hash of the emailed setup links (Better Auth's table, exempt from RLS). */
const SETUP_LINK_IDENTIFIER = "kledg:setup-link";
/** Lifetime of an emailed setup link. */
export const SETUP_LINK_TTL_MINUTES = 30;
/** A new link is not sent sooner than this after the previous one: /setup is public. */
const SETUP_LINK_RESEND_SECONDS = 60;

function hashSetupLinkToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Whether `given` is an unexpired emailed setup link (only its hash is stored). */
export async function isValidSetupLink(given: string | null | undefined): Promise<boolean> {
  const token = given?.trim();
  if (!token || token.length > 200) return false;
  const row = await prisma.verification.findFirst({
    where: {
      identifier: SETUP_LINK_IDENTIFIER,
      value: hashSetupLinkToken(token),
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  return row !== null;
}

/** Valid proof for the current mode: SETUP_TOKEN, or an emailed link. */
export async function isValidSetupCredential(given: string | null | undefined): Promise<boolean> {
  const mode = await setupMode();
  if (mode === "token") return isValidSetupToken(given);
  if (mode === "email") return isValidSetupLink(given);
  return false;
}

/** Drops every emailed setup link, once the administrator exists. */
export async function consumeSetupLinks(): Promise<void> {
  await prisma.verification.deleteMany({ where: { identifier: SETUP_LINK_IDENTIFIER } });
}

export type SetupLinkResult = "sent" | "throttled" | "failed";

/**
 * Emails a one-time setup link to ADMIN_EMAIL. The link points at the
 * configured instance URL (never at the request's Host header), and only the
 * SHA-256 of its token is stored. Throttled instance-wide, so the public
 * /setup page cannot be used to flood the administrator's mailbox.
 */
export async function sendSetupLink(): Promise<SetupLinkResult> {
  const to = getSetupAdminEmail();
  if (!to || (await setupMode()) !== "email") return "failed";

  const now = Date.now();
  const recent = await prisma.verification.findFirst({
    where: {
      identifier: SETUP_LINK_IDENTIFIER,
      createdAt: { gt: new Date(now - SETUP_LINK_RESEND_SECONDS * 1000) },
    },
    select: { id: true },
  });
  if (recent) return "throttled";

  await prisma.verification.deleteMany({
    where: { identifier: SETUP_LINK_IDENTIFIER, expiresAt: { lte: new Date(now) } },
  });
  const token = randomBytes(32).toString("base64url");
  const row = await prisma.verification.create({
    data: {
      id: randomBytes(16).toString("hex"),
      identifier: SETUP_LINK_IDENTIFIER,
      value: hashSetupLinkToken(token),
      expiresAt: new Date(now + SETUP_LINK_TTL_MINUTES * 60_000),
    },
    select: { id: true },
  });

  const url = `${getAppUrl()}/setup?token=${encodeURIComponent(token)}`;
  try {
    await sendEmail(setupLinkEmail(to, url, SETUP_LINK_TTL_MINUTES));
    return "sent";
  } catch {
    await prisma.verification.delete({ where: { id: row.id } }).catch(() => {});
    return "failed";
  }
}

/** `florian@example.fr` → `f•••@example.fr`, to say where the link went without printing the address. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "•••";
  return `${email[0]}•••${email.slice(at)}`;
}

/**
 * What /setup shows: why setup is blocked, the form (the link carries a valid
 * token), the "send me the link" page (email mode), or a neutral page. The
 * form is never shown to a visitor without a valid token: a public instance
 * (a hosted service before its operator account exists) does not invite
 * strangers to claim it, and the page does not say whether a guessed token
 * was close.
 */
export async function setupView(
  urlToken: string | null | undefined,
): Promise<"blocked" | "form" | "pending" | "request-link"> {
  const mode = await setupMode();
  if (mode === "blocked") return "blocked";
  if (await isValidSetupCredential(urlToken)) return "form";
  return mode === "email" ? "request-link" : "pending";
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
