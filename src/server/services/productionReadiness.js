/** 生产部署硬门禁；纯函数，doctor 与测试共用。 */
export function productionReadiness({ env = process.env, userCount = 0, dbIntegrity = "unknown" } = {}) {
  const checks = [
    { id: "node_env", ok: env.NODE_ENV === "production", detail: "NODE_ENV=production" },
    { id: "trust_proxy", ok: env.LUVIO_TRUST_PROXY === "1", detail: "LUVIO_TRUST_PROXY=1（Secure cookie + 真实 IP 限速）" },
    { id: "auth", ok: userCount > 0, detail: "至少已创建 owner，公网不可处于 legacy 无鉴权模式" },
    { id: "model", ok: Boolean(env.GLM_API_KEY || env.DEEPSEEK_API_KEY || env.OPENAI_API_KEY || (env.MODEL_API_KEY && env.MODEL_BASE_URL)), detail: "至少一个模型 provider" },
    { id: "backup", ok: Boolean(env.LUVIO_BACKUP_PUSH_CMD), detail: "LUVIO_BACKUP_PUSH_CMD 异地备份" },
    { id: "database", ok: dbIntegrity === "ok", detail: "主库 PRAGMA integrity_check=ok" },
    {
      id: "data_mode",
      ok: env.LUVIO_BETA_MODE === "1" || env.LUVIO_COMMERCIAL_DATA === "1",
      detail: "明确数据模式：邀请制免费 beta 或已取得商用数据授权"
    }
  ];
  return { ready: checks.every((check) => check.ok), checks, blockers: checks.filter((check) => !check.ok) };
}
