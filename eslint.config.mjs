import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import i18next from "eslint-plugin-i18next";
import { readFileSync } from "node:fs";

// Story 3.5: every file under src/ takes its UI text from messages/*.json.
// Literal UI text is an error anywhere in src (scope: scripts/i18n-scope.json).
const i18nScope = JSON.parse(
  readFileSync(new URL("./scripts/i18n-scope.json", import.meta.url), "utf8"),
).files;

// Attributes and copy props that reach the user (read aloud or shown) must
// come from messages too. no-literal-string in jsx-text-only mode only sees JSX text,
// so these are checked with a syntax selector.
const TEXT_ATTRS =
  "/^(aria-label|title|placeholder|alt|label|busyLabel|confirmLabel|cancelLabel|text|lead|description|message|hint)$/";
const LETTERS = "/[A-Za-z]{2,}/";
const literalAttrMessage = "User-visible attribute text must come from messages (t(...)).";

// Module boundaries (AD-2): other code imports a module only through its
// public surface, `@/modules/<name>` (its index.ts), never its internals.
const noDeepModuleImports = {
  group: ["@/modules/*/*", "**/modules/*/*"],
  message: "Import a module through its public surface '@/modules/<name>' only.",
};

// Story 6.3: src/lib/config.ts is the only reader of the environment.
// `process.env.NODE_ENV` stays allowed (a build-time constant, also in client code).
const localPlugin = {
  rules: {
    "no-process-env": {
      meta: {
        type: "problem",
        messages: {
          env: "Read configuration through config() from '@/lib/config', not process.env (only process.env.NODE_ENV is allowed).",
        },
        schema: [],
      },
      create(context) {
        return {
          MemberExpression(node) {
            const isProcessEnv =
              !node.computed &&
              node.object.type === "Identifier" &&
              node.object.name === "process" &&
              node.property.type === "Identifier" &&
              node.property.name === "env";
            if (!isProcessEnv) return;
            const parent = node.parent;
            const nodeEnv =
              parent?.type === "MemberExpression" &&
              parent.object === node &&
              !parent.computed &&
              parent.property.type === "Identifier" &&
              parent.property.name === "NODE_ENV";
            if (!nodeEnv) context.report({ node, messageId: "env" });
          },
        };
      },
    },
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Legacy debt ratchet: these rule families carry pre-existing findings
      // in the extracted code. They report as warnings, and `npm run lint`
      // caps the warning count (--max-warnings), so the debt can only shrink.
      "@typescript-eslint/no-explicit-any": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "no-restricted-imports": ["error", { patterns: [noDeepModuleImports] }],
    },
  },
  {
    // src/lib is the bottom layer: it must not depend on app code.
    files: ["src/lib/**"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          noDeepModuleImports,
          {
            group: [
              "@/services", "@/services/*", "@/graphql", "@/graphql/*",
              "@/components", "@/components/*", "@/app", "@/app/*",
              "@/modules", "@/modules/*", "@/emails", "@/emails/*",
              "**/services", "**/graphql", "**/components", "**/app", "**/modules", "**/emails",
              "**/services/*", "**/graphql/*", "**/components/*", "**/app/*", "**/modules/*", "**/emails/*",
            ],
            message: "src/lib must not import services, graphql, components, app, emails or modules.",
          },
        ],
      }],
    },
  },
  {
    files: i18nScope,
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": ["error", {
        mode: "jsx-text-only",
        words: {
          // Technical text only: no letters (punctuation, numbers, symbols
          // such as the middle dot) or an all-caps identifier.
          exclude: [/^[^\p{L}]*$/u, /^[A-Z0-9_-]+$/],
        },
      }],
      "no-restricted-syntax": ["error",
        { selector: `JSXAttribute[name.name=${TEXT_ATTRS}] > Literal[value=${LETTERS}]`, message: literalAttrMessage },
        { selector: `JSXAttribute[name.name=${TEXT_ATTRS}] > JSXExpressionContainer > Literal[value=${LETTERS}]`, message: literalAttrMessage },
        { selector: `JSXAttribute[name.name=${TEXT_ATTRS}] > JSXExpressionContainer > TemplateLiteral > TemplateElement[value.raw=${LETTERS}]`, message: literalAttrMessage },
        { selector: `JSXAttribute[name.name=${TEXT_ATTRS}] > JSXExpressionContainer > :matches(ConditionalExpression, LogicalExpression) > Literal[value=${LETTERS}]`, message: literalAttrMessage },
      ],
    },
  },
  {
    files: ["src/**", "server.ts"],
    ignores: ["src/lib/config.ts"],
    plugins: { local: localPlugin },
    rules: { "local/no-process-env": "error" },
  },
  {
    // Story 4.5: feedback goes through the toast or a Dialog with a coded
    // message; browser alert(), confirm() and prompt() are not allowed.
    files: ["src/**"],
    rules: { "no-alert": "error" },
  },
  {
    // Unit tests run the module internals directly with node --test (type
    // stripping needs explicit file paths, which the public index cannot give).
    files: ["scripts/**/*.test.mjs"],
    rules: { "no-restricted-imports": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Local development data (gitignored): PGlite database and media storage.
    ".devdb/**",
    "data/**",
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated Prisma client.
    "src/generated/**",
    // Compiled custom server (npm run build:server).
    "dist/**",
  ]),
]);

export default eslintConfig;
