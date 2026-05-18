// Minimal ESLint v9 flat config for @veridex/sdk.
// Uses the TypeScript parser so .ts files parse correctly.
// Rule set is intentionally empty; deeper type checking is delegated to tsc/tsup at build time.
import tsParser from "@typescript-eslint/parser";

export default [
  {
    ignores: ["dist/**", "node_modules/**", "**/*.d.ts"],
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {},
  },
];
