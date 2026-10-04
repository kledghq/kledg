/**
 * First-run setup without SETUP_TOKEN nor email (lib/setup.ts, "derived"
 * mode): the token derived from the auth secret opens /setup.
 * - the token is what the deploy guide of kledg.com computes with WebCrypto
 *   (HMAC-SHA256 of the label, keyed with the secret, base64url);
 * - an explicit SETUP_TOKEN wins: the derived token no longer works;
 * - with email available, both the emailed link and the derived token work;
 * - the account is created only with the right token and for ADMIN_EMAIL.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createUser: vi.fn(async () => ({ user: { id: "u1" } })),
  isEmailEnabled: vi.fn(async () => false),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { createUser: mocks.createUser } } }));
vi.mock("@/lib/email", () => ({ isEmailEnabled: mocks.isEmailEnabled, sendEmail: vi.fn() }));
vi.mock("@/lib/prisma", async () =>
  (await import("@/lib/__tests__/helpers/prisma-mock")).prismaModuleMock(),
);
vi.mock("@/lib/rate-limit", async () => ({
  ...(await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit")),
  withinRateLimit: vi.fn(async () => true),
}));

import { prisma } from "@/lib/prisma";
import { asPrismaMock } from "@/lib/__tests__/helpers/prisma-mock";
import { createFirstAdmin } from "@/app/(auth)/setup/actions";
import { DERIVED_SETUP_TOKEN_LABEL, derivedSetupToken, setupMode, setupView } from "@/lib/setup";

const db = asPrismaMock(prisma);
const SECRET = "deploy-guide-secret-0123456789abcdefghijklmn+/=";
const input = { name: "Owner", email: "owner@example.fr", password: "long-enough-password" };

/** What the deploy guide runs in the browser. */
async function browserToken(secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(DERIVED_SETUP_TOKEN_LABEL)));
  return btoa(String.fromCharCode(...mac)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.BETTER_AUTH_SECRET = SECRET;
  delete process.env.BETTER_AUTH_SECRETS;
  delete process.env.SETUP_TOKEN;
  process.env.ADMIN_EMAIL = "owner@example.fr";
  mocks.isEmailEnabled.mockResolvedValue(false);
  db.user.count.mockResolvedValue(0);
  db.$executeRaw.mockResolvedValue(0);
  db.verification.findFirst.mockResolvedValue(null);
  db.verification.deleteMany.mockResolvedValue({ count: 0 });
});

afterEach(() => {
  delete process.env.BETTER_AUTH_SECRET;
  delete process.env.ADMIN_EMAIL;
  delete process.env.SETUP_TOKEN;
});

describe("derived setup token", () => {
  it("is the value the deploy guide computes in the browser", async () => {
    expect(derivedSetupToken()).toBe(await browserToken(SECRET));
    expect(derivedSetupToken({ BETTER_AUTH_SECRETS: `2:${SECRET}`, BETTER_AUTH_SECRET: "old" })).toBe(await browserToken(SECRET));
  });

  it("opens /setup without SETUP_TOKEN nor email", async () => {
    expect(await setupMode()).toBe("derived");
    expect(await setupView(derivedSetupToken())).toBe("form");
    expect(await setupView(undefined)).toBe("pending");
    expect(await setupView("forged")).toBe("pending");
  });

  it("creates the administrator with the derived token only, for ADMIN_EMAIL", async () => {
    expect((await createFirstAdmin({ ...input, token: "forged" })).ok).toBe(false);
    expect((await createFirstAdmin({ ...input, email: "eve@attacker.test", token: derivedSetupToken()! })).ok).toBe(false);
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect((await createFirstAdmin({ ...input, token: derivedSetupToken()! })).ok).toBe(true);
    expect(mocks.createUser).toHaveBeenCalledTimes(1);
  });

  it("is refused once SETUP_TOKEN is set", async () => {
    process.env.SETUP_TOKEN = "a-long-random-setup-token-value";
    expect(await setupMode()).toBe("token");
    expect(await setupView(derivedSetupToken())).toBe("pending");
  });

  it("still works next to the emailed link", async () => {
    mocks.isEmailEnabled.mockResolvedValue(true);
    expect(await setupMode()).toBe("email");
    expect(await setupView(derivedSetupToken())).toBe("form");
    expect(await setupView(undefined)).toBe("request-link");
  });

  it("is blocked without any auth secret", async () => {
    delete process.env.BETTER_AUTH_SECRET;
    expect(await setupMode()).toBe("blocked");
  });
});
