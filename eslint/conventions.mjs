/*
 * Engineering convention guards (docs/conventions.md).
 *
 * Small local rules built from AST selectors, plus the import boundaries
 * between layers. Each rule is an error for new code. Files that broke a
 * rule before it existed are listed in KNOWN_VIOLATIONS: the rule only warns
 * there, so the debt stays visible in `pnpm lint`. Remove a file from its
 * list once it is fixed, never add one (docs/conventions.md#known-violations).
 *
 * Minimatch patterns: escape route groups and dynamic segments, e.g.
 * "app/\\(company\\)/\\[companyId\\]/page.tsx".
 */

/** An ESLint rule reporting every node matched by one of `selectors`. */
function selectorRule(description, message, selectors) {
  return {
    meta: { type: "problem", docs: { description }, messages: { violation: message }, schema: [] },
    create(context) {
      const report = (node) => context.report({ node, messageId: "violation" });
      return Object.fromEntries(selectors.map((selector) => [selector, report]));
    },
  };
}

const LOCAL_TIME_METHODS = [
  "getFullYear",
  "getMonth",
  "getDate",
  "getDay",
  "getHours",
  "getMinutes",
  "getSeconds",
  "getMilliseconds",
  "setFullYear",
  "setMonth",
  "setDate",
  "setHours",
  "setMinutes",
  "setSeconds",
  "setMilliseconds",
].join("|");

export const kledgPlugin = {
  meta: { name: "kledg" },
  rules: {
    "no-local-time-date": selectorRule(
      "Accounting dates are calendar days stored at midnight UTC: never read or build them in the server timezone.",
      "Local time Date API in server code: an accounting date would move by one day outside UTC. Use calendarDayOf, todayUtc, utcDate, addUtcDays or the getUTC*/setUTC* methods (docs/conventions.md#dates).",
      [
        `CallExpression > MemberExpression.callee[property.name=/^(${LOCAL_TIME_METHODS})$/]`,
        "NewExpression[callee.name='Date'][arguments.length>1]",
      ],
    ),
    "no-prisma-in-transaction": selectorRule(
      "Inside prisma.$transaction(async (tx) => ...), every query goes through tx.",
      "`prisma` used inside a $transaction callback: this query runs outside the transaction (no atomicity, no locks). Use the transaction client `tx` (docs/conventions.md#data-access).",
      ["CallExpression[callee.property.name='$transaction'] > :function MemberExpression[object.name='prisma']"],
    ),
    "no-parse-float": selectorRule(
      "Amounts are integer cents parsed exactly.",
      "parseFloat on server code: amounts are integer cents. Use parseCents, parseAmount or toCents (lib/utils/money.ts) (docs/conventions.md#money).",
      ["CallExpression[callee.name='parseFloat']", "CallExpression[callee.object.name='Number'][callee.property.name='parseFloat']"],
    ),
  },
};

/** Modules that only run on the server (database, auth, mail, Node APIs). */
export const SERVER_ONLY_IMPORTS = [
  { name: "@/lib/prisma", message: "Components never query the database: call an API route or a server component (docs/conventions.md#architecture)." },
  { name: "@prisma/client", allowTypeImports: true, message: "Components may import Prisma types only (`import type`)." },
  { name: "@/lib/auth", message: "Server auth instance: use @/lib/auth-client in components." },
  { name: "@/lib/session", message: "Server session helper: read the session in a server component or an API route." },
  { name: "@/lib/audit", message: "Audit logs are written by API routes and services." },
  { name: "@/lib/email", message: "Emails are sent by API routes and services." },
  { name: "pg", message: "Database driver: server only." },
];

/** lib/ is the domain layer: it never depends on routes, pages or UI. */
const LIB_RESTRICTED_PATTERNS = [
  {
    group: ["@/app/*", "@/components/*", "@/hooks/*", "**/app/**", "**/components/**", "**/hooks/**"],
    message: "lib/ never imports app/, components/ or hooks/: move the shared code into lib/ (docs/conventions.md#architecture).",
  },
];

const TESTS = ["**/__tests__/**", "**/*.test.ts", "**/*.test.tsx"];
const SERVER_FILES = ["lib/**/*.{ts,tsx}", "app/api/**/*.{ts,tsx}"];
const SOURCE_FILES = ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}", "hooks/**/*.{ts,tsx}"];

/**
 * Files that broke a rule before it was introduced, with the number of
 * violations when the rule was added (docs/conventions.md#known-violations).
 * The rule warns in these files. Remove a file once it is clean; never add one.
 */
export const KNOWN_VIOLATIONS = {
  "no-console": [],
  "@typescript-eslint/no-explicit-any": [
    "app/\\(company\\)/\\[companyId\\]/fiscal-years/page.tsx", // 4
    "components/features/companies/establishments-management.tsx", // 1
    "components/features/companies/shareholders-management.tsx", // 1
    "components/ui/address-form.tsx", // 4
    "lib/services/transactions/transaction-processing-service.ts", // 1
  ],
  "kledg/no-local-time-date": [],
  "kledg/no-parse-float": [],
  "kledg/no-prisma-in-transaction": [],
};

/** Config objects to spread into eslint.config.mjs, after the shared configs. */
export function conventionConfigs() {
  return [
    {
      files: SOURCE_FILES,
      ignores: [...TESTS, "lib/logger.ts"],
      plugins: { kledg: kledgPlugin },
      rules: {
        "no-console": "error",
        "@typescript-eslint/no-explicit-any": "error",
      },
    },
    {
      files: SERVER_FILES,
      ignores: TESTS,
      plugins: { kledg: kledgPlugin },
      rules: {
        "kledg/no-local-time-date": "error",
        "kledg/no-prisma-in-transaction": "error",
        "kledg/no-parse-float": "error",
      },
    },
    {
      files: ["lib/**/*.{ts,tsx}"],
      ignores: TESTS,
      rules: { "no-restricted-imports": ["error", { patterns: LIB_RESTRICTED_PATTERNS }] },
    },
    {
      files: ["components/**/*.{ts,tsx}", "hooks/**/*.{ts,tsx}"],
      ignores: TESTS,
      rules: { "no-restricted-imports": ["error", { paths: SERVER_ONLY_IMPORTS }] },
    },
    ...Object.entries(KNOWN_VIOLATIONS)
      .filter(([, files]) => files.length > 0)
      .map(([rule, files]) => ({ files, rules: { [rule]: "warn" } })),
  ];
}
