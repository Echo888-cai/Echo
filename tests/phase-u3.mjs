// U-3（E14）：生产门禁必须挡住无鉴权、无异地备份、未声明数据授权模式的部署。
import assert from "node:assert/strict";
import { productionReadiness } from "../src/server/services/productionReadiness.js";

const base = {
  NODE_ENV: "production",
  LUVIO_TRUST_PROXY: "1",
  LUVIO_BACKUP_PUSH_CMD: "rclone copy {file} remote:echo",
  LUVIO_BETA_MODE: "1",
  GLM_API_KEY: "configured"
};

assert.equal(productionReadiness({ env: base, userCount: 1, dbIntegrity: "ok" }).ready, true);
assert.equal(productionReadiness({ env: { ...base, LUVIO_TRUST_PROXY: "0" }, userCount: 1, dbIntegrity: "ok" }).ready, false);
assert.equal(productionReadiness({ env: base, userCount: 0, dbIntegrity: "ok" }).blockers.some((b) => b.id === "auth"), true);
assert.equal(productionReadiness({ env: { ...base, LUVIO_BACKUP_PUSH_CMD: "" }, userCount: 1, dbIntegrity: "ok" }).blockers.some((b) => b.id === "backup"), true);
assert.equal(productionReadiness({ env: { ...base, LUVIO_BETA_MODE: "" }, userCount: 1, dbIntegrity: "ok" }).blockers.some((b) => b.id === "data_mode"), true);

console.log("phase-u3 ✓ 生产部署硬门禁");
