import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

/**
 * 只开 correctness 级规则（真 bug 才报 error），不吵代码风格。
 * Legacy browser modules use browser globals; server, scripts and filing
 * pipelines use Node globals. TypeScript workspaces share one strict baseline.
 */
export default [
  { ignores: ["node_modules/**", "**/dist/**", "coverage/**"] },
  js.configs.recommended,
  {
    files: ["src/app.js", "src/ui/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser }
    }
  },
  {
    files: ["server.js", "src/**/*.js", "scripts/**/*.js", "tests/**/*.mjs", "packages/domain/**/*.{js,mjs}", "apps/worker/src/pipelines/**/*.js"],
    ignores: ["src/app.js", "src/ui/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node }
    }
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["packages/**/*.ts", "apps/web/**/*.{ts,tsx}"]
  })),
  {
    ...reactHooks.configs.flat["recommended-latest"],
    files: ["apps/web/**/*.{ts,tsx}"]
  },
  {
    rules: {
      // 未用变量是提示；--max-warnings=0 仍会阻止它进入主干。
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      // 空 catch 是本项目"优雅降级"的惯用法
      "no-empty": ["error", { allowEmptyCatch: true }],
      // 中文文案里的全角括号常触发误报
      "no-irregular-whitespace": ["error", { skipStrings: true, skipTemplates: true }],
      // documentParser 刻意用正则清洗 NUL 等控制字符，属合法用法
      "no-control-regex": "off"
    }
  },
  {
    files: ["packages/**/*.ts", "apps/web/**/*.{ts,tsx}"],
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      // Brownfield API payloads are intentionally gradual; strict tsc remains
      // the correctness gate while contracts replace these escape hatches.
      "@typescript-eslint/no-explicit-any": "off"
    }
  }
];
