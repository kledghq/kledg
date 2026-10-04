/**
 * First-run setup by email (lib/setup.ts, "email" mode): without SETUP_TOKEN
 * but with ADMIN_EMAIL and email delivery, /setup sends a one-time link to
 * ADMIN_EMAIL, and only that link opens the form.
 * - SETUP_TOKEN, when set, always wins;
 * - only the SHA-256 of the link token is stored, and the link points at the
 *   configured instance URL;
 * - a new link is not sent within a minute of the previous one;
 * - a failed delivery leaves no usable link behind;
 * - the account can only be created through a valid link, for ADMIN_EMAIL,
 *   and the links are dropped once it exists.
 */

import { createHash } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createUser: vi.fn(async () => ({ user: { id: "u1" } })),
  isEmailEnabled: vi.fn(async () => true),
  sendEmail: vi.fn(async (message: { to: string; text: string }) => void message),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  auth: { api: { createUser: mocks.createUser } },
}));
vi.mock("@/lib/email", () => ({
  isEmailEnabled: mocks.isEmailEnabled,
  sendEmail: mocks.sendEmail,
}));
vi.mock("@/lib/prisma", async () =>
  (await import("@/lib/__tests__/helpers/prisma-mock")).prismaModuleMock(),
);
vi.mock("@/lib/rate-limit", async () => ({
  ...(await vi.importActual<typeof import("@/lib/rate-limit")>(
    "@/lib/rate-limit",
  )),
  withinRateLimit: vi.fn(async () => true),
}));

import { prisma } from "@/lib/prisma";
import { asPrismaMock } from "@/lib/__tests__/helpers/prisma-mock";
import {
  createFirstAdmin,
  requestSetupLink,
} from "@/app/(auth)/setup/actions";
import { maskEmail, sendSetupLink, setupMode, setupView } from "@/lib/setup";

const db = asPrismaMock(prisma);
const ADMIN = "owner@example.fr";
const input = { name: "Owner", email: ADMIN, password: "long-enough-password" };
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** The token of the link passed to sendEmail. */
function sentToken(): string {
  const message = mocks.sendEmail.mock.calls.at(-1)![0];
  const url = new URL(message.text.match(/https?:\/\/\S+/)![0]);
  return url.searchParams.get("token")!;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.SETUP_TOKEN;
  process.env.ADMIN_EMAIL = ADMIN;
  process.env.BETTER_AUTH_URL = "https://compta.example.fr";
  mocks.isEmailEnabled.mockResolvedValue(true);
  db.user.count.mockResolvedValue(0);
  db.$executeRaw.mockResolvedValue(0);
  db.verification.findFirst.mockResolvedValue(null);
  db.verification.create.mockResolvedValue({ id: "v1" });
  db.verification.deleteMany.mockResolvedValue({ count: 0 });
  db.verification.delete.mockResolvedValue({ id: "v1" });
});

afterEach(() => {
  delete process.env.ADMIN_EMAIL;
  delete process.env.BETTER_AUTH_URL;
  delete process.env.SETUP_TOKEN;
});

describe("setup mode", () => {
  it("uses email links without SETUP_TOKEN, when ADMIN_EMAIL is set and emails can be sent", async () => {
    expect(await setupMode()).toBe("email");
    expect(await setupView(undefined)).toBe("request-link");
  });

  it("prefers an explicit SETUP_TOKEN", async () => {
    process.env.SETUP_TOKEN = "a-long-random-setup-token-value";
    expect(await setupMode()).toBe("token");
  });

  it("is blocked without ADMIN_EMAIL, or when emails cannot be sent", async () => {
    delete process.env.ADMIN_EMAIL;
    expect(await setupMode()).toBe("blocked");
    process.env.ADMIN_EMAIL = ADMIN;
    mocks.isEmailEnabled.mockResolvedValue(false);
    expect(await setupMode()).toBe("blocked");
  });
});

describe("sending the setup link", () => {
  it("emails ADMIN_EMAIL a link to the configured URL and stores only the token's hash", async () => {
    expect(await sendSetupLink()).toBe("sent");
    const message = mocks.sendEmail.mock.calls[0]![0];
    expect(message.to).toBe(ADMIN);
    expect(message.text).toContain("https://compta.example.fr/setup?token=");
    const token = sentToken();
    expect(token.length).toBeGreaterThanOrEqual(40);
    const stored = db.verification.create.mock.calls[0]?.[0]?.data;
    expect(stored?.value).toBe(sha256(token));
    expect(stored?.value).not.toContain(token);
    expect(stored?.identifier).toBe("kledg:setup-link");
  });

  it("does not send another link within a minute of the previous one", async () => {
    db.verification.findFirst.mockResolvedValueOnce({ id: "recent" });
    expect(await sendSetupLink()).toBe("throttled");
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(db.verification.create).not.toHaveBeenCalled();
  });

  it("drops the link when the email cannot be delivered", async () => {
    mocks.sendEmail.mockRejectedValueOnce(new Error("testing emails only"));
    expect(await sendSetupLink()).toBe("failed");
    expect(db.verification.delete).toHaveBeenCalledWith({ where: { id: "v1" } });
  });

  it("tells the visitor where the link went without printing the address", async () => {
    expect(await requestSetupLink()).toEqual({ ok: true, sentTo: "o•••@example.fr", ttlMinutes: 30 });
    expect(maskEmail("x@y.fr")).toBe("x•••@y.fr");
  });

  it("explains a failed delivery (Resend test sender) to the administrator", async () => {
    mocks.sendEmail.mockRejectedValueOnce(new Error("testing emails only"));
    const result = await requestSetupLink();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Resend");
  });
});

describe("creating the administrator through the link", () => {
  it("refuses without a valid link", async () => {
    expect((await createFirstAdmin({ ...input, token: "forged" })).ok).toBe(false);
    expect((await createFirstAdmin(input)).ok).toBe(false);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("looks the link up by hash, unexpired, then creates the account and drops the links", async () => {
    db.verification.findFirst.mockResolvedValueOnce({ id: "v1" });
    expect((await createFirstAdmin({ ...input, token: "link-token" })).ok).toBe(true);
    const where = db.verification.findFirst.mock.calls[0]?.[0]?.where as {
      value: string;
      expiresAt: { gt: Date };
    };
    expect(where.value).toBe(sha256("link-token"));
    expect(where.expiresAt.gt).toBeInstanceOf(Date);
    expect(mocks.createUser).toHaveBeenCalledTimes(1);
    expect(db.verification.deleteMany).toHaveBeenCalledWith({
      where: { identifier: "kledg:setup-link" },
    });
  });

  it("still only accepts ADMIN_EMAIL", async () => {
    db.verification.findFirst.mockResolvedValueOnce({ id: "v1" });
    const result = await createFirstAdmin({ ...input, email: "eve@attacker.test", token: "link-token" });
    expect(result.ok).toBe(false);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });
});
