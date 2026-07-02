import js from "@eslint/js";
import globals from "globals";

/**
 * 只开 correctness 级规则（真 bug 才报 error），不吵代码风格。
 * 前端 src/app.js + src/ui/** 用浏览器全局；其余全部是 Node 侧代码。
 */
export default [
  { ignores: ["node_modules/**", "dist/**", "coverage/**"] },
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
    files: ["server.js", "src/**/*.js", "scripts/**/*.js", "tests/**/*.mjs"],
    ignores: ["src/app.js", "src/ui/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node }
    }
  },
  {
    rules: {
      // 未用变量是提示不是门禁；_ 前缀视为刻意占位
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      // 空 catch 是本项目"优雅降级"的惯用法
      "no-empty": ["error", { allowEmptyCatch: true }],
      // 中文文案里的全角括号常触发误报
      "no-irregular-whitespace": ["error", { skipStrings: true, skipTemplates: true }],
      // documentParser 刻意用正则清洗 NUL 等控制字符，属合法用法
      "no-control-regex": "off"
    }
  }
];
