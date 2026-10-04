/**
 * First-run setup is refused unless SETUP_TOKEN is configured: without it,
 * the first visitor of a freshly deployed instance would become its
 * administrator (ADMIN_EMAIL alone is not a secret). The server action is
 * called directly, as the /setup form does, with the database mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createUser: vi.fn(async () => ({ user: { id: "u1" } })),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  auth: { api: { createUser: mocks.createUser } },
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
import { createFirstAdmin } from "@/app/(auth)/setup/actions";
import { isValidSetupToken, setupTokenStatus } from "@/lib/setup";

const db = asPrismaMock(prisma);
const input = {
  name: "Eve",
  email: "eve@attacker.test",
  password: "long-enough-password",
};

describe("first-run setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.user.count.mockResolvedValue(0);
    db.$executeRaw.mockResolvedValue(0);
    delete process.env.SETUP_TOKEN;
    delete process.env.ADMIN_EMAIL;
  });
  afterEach(() => {
    delete process.env.SETUP_TOKEN;
    delete process.env.ADMIN_EMAIL;
  });

  it("refuses to create the first administrator when no SETUP_TOKEN is configured", async () => {
    const result = await createFirstAdmin(input);
    expect(result.ok).toBe(false);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("refuses even with ADMIN_EMAIL set, since the email is not a secret", async () => {
    process.env.ADMIN_EMAIL = "eve@attacker.test";
    expect((await createFirstAdmin(input)).ok).toBe(false);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("refuses a token too short to resist guessing", () => {
    process.env.SETUP_TOKEN = "short";
    expect(setupTokenStatus()).toBe("weak");
    expect(isValidSetupToken("short")).toBe(false);
  });

  it("refuses a wrong token and accepts the configured one", async () => {
    process.env.SETUP_TOKEN = "a-long-random-setup-token-value";
    expect((await createFirstAdmin({ ...input, token: "wrong" })).ok).toBe(
      false,
    );
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(
      (
        await createFirstAdmin({
          ...input,
          token: "a-long-random-setup-token-value",
        })
      ).ok,
    ).toBe(true);
    expect(mocks.createUser).toHaveBeenCalledTimes(1);
  });

  it("reports no configured token as missing", () => {
    expect(setupTokenStatus()).toBe("missing");
    expect(isValidSetupToken(undefined)).toBe(false);
    expect(isValidSetupToken("")).toBe(false);
  });
});

describe("/setup view", () => {
  const previous = process.env.SETUP_TOKEN;
  afterEach(() => {
    process.env.SETUP_TOKEN = previous;
  });

  it("shows the form only with the right token in the link, a neutral page otherwise", async () => {
    const { setupView } = await import("@/lib/setup");
    process.env.SETUP_TOKEN = "a-long-enough-setup-token-0123";
    expect(setupView("a-long-enough-setup-token-0123")).toBe("form");
    expect(setupView(undefined)).toBe("pending");
    expect(setupView("")).toBe("pending");
    expect(setupView("a-long-enough-setup-token-0124")).toBe("pending");
  });

  it("says why setup is blocked when no usable token is configured, whatever the link", async () => {
    const { setupView } = await import("@/lib/setup");
    delete process.env.SETUP_TOKEN;
    expect(setupView("anything")).toBe("blocked");
    process.env.SETUP_TOKEN = "short";
    expect(setupView("short")).toBe("blocked");
  });
});
