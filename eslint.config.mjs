import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { conventionConfigs } from "./eslint/conventions.mjs";

/*
 * Design system guards (docs/design-system.md). They keep the UI consistent:
 * buttons are sized with their `size` prop only, colors come from semantic
 * tokens, and destructive confirmations use ConfirmDialog/useConfirm.
 */
const RAW_PALETTE =
  "(^|[\\s:\"'`])(text|bg|border|ring|fill|stroke|from|to|via|outline|decoration)-(red|green|blue|amber|yellow|orange|emerald|sky|purple|gray|slate|zinc|neutral|stone|indigo|teal|rose|violet|lime|cyan|pink|fuchsia)-\\d{2,3}";
const BUTTON_SIZE_CLASSES =
  "(^|\\s)(h-\\d|h-\\[|size-\\d|size-\\[|w-\\d|min-h-|py-|px-|text-(xs|sm|base|lg)(\\s|$))";

const designSystemRules = {
  "no-restricted-syntax": [
    "error",
    {
      selector: `JSXOpeningElement[name.name='Button'] > JSXAttribute[name.name='className'] Literal[value=/${BUTTON_SIZE_CLASSES}/]`,
      message:
        "Size buttons with the `size` prop (xs, sm, default, lg, icon-xs, icon-sm, icon, icon-lg), not with height, padding or text classes. See docs/design-system.md.",
    },
    {
      selector: `JSXOpeningElement[name.name='Button'] > JSXAttribute[name.name='className'] TemplateElement[value.raw=/${BUTTON_SIZE_CLASSES}/]`,
      message:
        "Size buttons with the `size` prop (xs, sm, default, lg, icon-xs, icon-sm, icon, icon-lg), not with height, padding or text classes. See docs/design-system.md.",
    },
    {
      selector: `Literal[value=/${RAW_PALETTE}/]`,
      message:
        "Use semantic color tokens (text-success, text-warning, text-destructive, text-info, bg-muted...) instead of raw palette classes. See docs/design-system.md.",
    },
    {
      selector: `TemplateElement[value.raw=/${RAW_PALETTE}/]`,
      message:
        "Use semantic color tokens (text-success, text-warning, text-destructive, text-info, bg-muted...) instead of raw palette classes. See docs/design-system.md.",
    },
  ],
  "no-restricted-globals": [
    "error",
    { name: "confirm", message: "Use ConfirmDialog or useConfirm from @/components/shared." },
    { name: "alert", message: "Use a toast (sonner) or an inline Alert." },
  ],
  "no-restricted-properties": [
    "error",
    { object: "window", property: "confirm", message: "Use ConfirmDialog or useConfirm from @/components/shared." },
    { object: "window", property: "alert", message: "Use a toast (sonner) or an inline Alert." },
  ],
};

/*
 * Screens still to migrate (phase 2 of the UI pass, see docs/ui-audit.md).
 * The guards only warn there; remove a file from this list once it is fixed,
 * never add one. Empty since the bank screens and the account detail were
 * migrated: every screen is held to the guards. Route groups and dynamic
 * segments are escaped for minimatch ("app/\\(company\\)/\\[companyId\\]/...").
 */
const PHASE_2_FILES = [];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Inherited debt from the codebase Kledg grew out of. These stay visible
    // as warnings and should be tightened back to errors as code is cleaned up.
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "react/no-unescaped-entities": "warn",
      "@next/next/no-html-link-for-pages": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/error-boundaries": "warn",
    },
  },
  {
    files: ["app/**/*.tsx", "components/**/*.tsx"],
    ignores: ["**/__tests__/**", "**/*.test.tsx"],
    rules: designSystemRules,
  },
  // An empty `files` list would match every file: add the block only when needed.
  ...(PHASE_2_FILES.length > 0
    ? [
        {
          files: PHASE_2_FILES,
          rules: Object.fromEntries(
            Object.entries(designSystemRules).map(([name, [, ...options]]) => [name, ["warn", ...options]]),
          ),
        },
      ]
    : []),
  // Engineering conventions (docs/conventions.md): layer boundaries, logger,
  // dates, money, transactions. Known violators only warn, see the module.
  ...conventionConfigs(),
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "coverage/**", ".claude/**"]),
]);

export default eslintConfig;
