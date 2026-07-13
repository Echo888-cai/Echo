import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

/** Correctness rules for the TypeScript workspaces and Node.js domain modules. */
export default [
  { ignores: ["node_modules/**", "**/dist/**", "coverage/**", "playwright-report/**", "test-results/**", "packages/finance-native/index.cjs", "packages/finance-native/index.d.ts"] },
  js.configs.recommended,
  {
    files: ["apps/web/public/sw.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: { ...globals.serviceworker }
    }
  },
  {
    files: ["packages/domain/**/*.{js,mjs}", "apps/worker/src/pipelines/**/*.js", "packages/finance-native/*.mjs", "scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node }
    }
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["packages/**/*.ts", "apps/**/*.{ts,tsx}"]
  })),
  {
    ...reactHooks.configs.flat["recommended-latest"],
    files: ["apps/web/**/*.{ts,tsx}"]
  },
  {
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-irregular-whitespace": ["error", { skipStrings: true, skipTemplates: true }],
      "no-control-regex": "off"
    }
  },
  {
    files: ["packages/**/*.ts", "apps/**/*.{ts,tsx}"],
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "@typescript-eslint/no-explicit-any": "off"
    }
  }
];
