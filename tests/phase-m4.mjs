import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const watchSource = readFileSync(new URL("../src/ui/watch.js", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const watchCss = readFileSync(new URL("../src/styles/06-watch.css", import.meta.url), "utf8");

assert.match(watchSource, /export function exportPortraitImage\(\)/, "应导出分享图生成函数");
assert.match(watchSource, /canvas\.toBlob\(/, "分享图应在本地生成 PNG");
assert.match(watchSource, /data-action="export-portrait-image"/, "画像页应提供分享图按钮");
assert.match(appSource, /export-portrait-image/, "全局事件委托应接入分享图动作");
assert.match(watchCss, /\.portrait-bar-actions/, "双导出动作应有响应式布局");

console.log("M-4: 分享图导出接线与本地 PNG 生成路径验证通过。");
