import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Module boundaries (AD-2): other code imports a module only through its
// public surface, `@/modules/<name>` (its index.ts), never its internals.
const noDeepModuleImports = {
  group: ["@/modules/*/*", "**/modules/*/*"],
  message: "Import a module through its public surface '@/modules/<name>' only.",
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
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated Prisma client.
    "src/generated/**",
  ]),
]);

export default eslintConfig;
