/**
 * dbBackup — F-1 顺手项（E8，PLAN v3）：研究库（会话/画像/判断快照/组合）此前完全裸奔，
 * 一次磁盘故障或误删就清零。用 better-sqlite3 的在线备份 API（WAL 安全，不打断读写）
 * 每日落一份快照，滚动保留 N 份，并做一次恢复校验（打开备份文件跑 PRAGMA integrity_check +
 * 抽一行真实表），确保"能恢复"不是纸面承诺。
 */

import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Database from "better-sqlite3";
import { getDb, dbPath } from "../../db/index.js";

const execFileAsync = promisify(execFile);

const FILE_PREFIX = "echo-";
const FILE_SUFFIX = ".db";

/** 备份目录：可用 ECHO_BACKUP_DIR 覆盖，默认是数据库文件所在目录下的 backups/。 */
export function backupDir() {
  return process.env.ECHO_BACKUP_DIR || join(dirname(dbPath()), "backups");
}

function timestampName(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${FILE_PREFIX}${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}${FILE_SUFFIX}`;
}

/** 目录下现存的备份文件，按时间新到旧排序。 */
export function listBackups(dir = backupDir()) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith(FILE_PREFIX) && f.endsWith(FILE_SUFFIX))
    .map((f) => {
      const full = join(dir, f);
      const st = statSync(full);
      return { file: f, path: full, sizeBytes: st.size, mtime: st.mtime.toISOString() };
    })
    .sort((a, b) => (a.file < b.file ? 1 : -1));
}

/** 打开备份文件做只读完整性校验：integrity_check + 抽一行真实表，确认这份备份真能恢复。 */
export function verifyBackup(path) {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const integrity = db.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") throw new Error(`integrity_check 未通过：${integrity}`);
    const row = db.prepare("SELECT COUNT(*) AS n FROM companies").get();
    return { ok: true, companies: row?.n ?? 0 };
  } finally {
    db.close();
  }
}

/**
 * 跑一次备份：在线备份到新文件 → 校验 → 按 retain 滚动清理旧文件。
 * @returns {Promise<string>} 人类可读的结果摘要（供 scheduler 落 last_detail）
 */
export async function runBackup({ retain = 14 } = {}) {
  const dir = backupDir();
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, timestampName());

  await getDb().backup(dest);
  const check = verifyBackup(dest);

  const existing = listBackups(dir);
  const stale = existing.slice(retain);
  for (const b of stale) {
    try { unlinkSync(b.path); } catch { /* 清理失败不影响本次备份是否成功 */ }
  }

  const sizeKb = Math.round((statSync(dest).size / 1024) * 10) / 10;
  const pushed = await pushOffsite(dest);
  return `备份完成：${basename(dest)}（${sizeKb}KB，${check.companies} 家公司，恢复校验通过）；保留 ${Math.min(existing.length, retain)} 份，清理 ${stale.length} 份${pushed}`;
}

/**
 * U-3（E14）：备份校验通过后的异地推送钩子。服务器挂了本地备份一起挂——
 * 生产必须有异地副本（PLAN v5 E14）。命令由 ECHO_BACKUP_PUSH_CMD 提供，
 * 备份文件路径以 {file} 占位（如 `rclone copy {file} b2:echo-backups/`）。
 * 未配置 = 跳过（本机开发不需要）；推送失败不影响备份本身的成功状态，但如实上报。
 */
async function pushOffsite(dest) {
  const template = process.env.ECHO_BACKUP_PUSH_CMD;
  if (!template) return "";
  const parts = template.split(/\s+/).map((p) => (p === "{file}" ? dest : p));
  try {
    await execFileAsync(parts[0], parts.slice(1), { timeout: 120_000 });
    return "；异地推送 ✓";
  } catch (error) {
    return `；异地推送 ✗（${(error?.message || "失败").slice(0, 80)}）`;
  }
}
