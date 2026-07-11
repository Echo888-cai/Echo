/**
 * manage-users — 多用户 beta 的账号管理 CLI（U-1 / E12）。
 *
 * 用法（在项目根目录）：
 *   node scripts/manage-users.js create-owner <用户名> <密码>   # 建 owner（同时开启多用户模式）
 *   node scripts/manage-users.js invite [备注]                  # 生成一枚一次性邀请码
 *   node scripts/manage-users.js invite-batch <数量> [备注]      # 批量生成一次性邀请码
 *   node scripts/manage-users.js bootstrap-test-users <数量>     # 首次创建 owner + 测试账号
 *   node scripts/manage-users.js list                           # 用户 + 邀请码一览
 *
 * 说明：owner 的 id 固定为 'local'——所有既有私有数据（user_id DEFAULT 'local'）
 * 自动归属 owner，不需要数据搬家。建 owner 之前服务器是单用户 legacy 模式，
 * 建完的下一个请求起自动要求登录（见 services/authService.js resolveRequestUser）。
 */

import { randomBytes } from "node:crypto";
import { loadEnvFile } from "../src/server/utils/env.js";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), ".."));

const { createOwner, hashPassword, OWNER_USER_ID } = await import("../src/server/services/authService.js");
const { createInvite, listInvites, listUsers, getUserById, countUsers, createUser } = await import("../src/server/repositories/authRepository.js");

const [, , command, ...args] = process.argv;
const randomPassword = () => `Echo-${randomBytes(12).toString("base64url")}`;

try {
  if (command === "create-owner") {
    const [username, password] = args;
    if (!username || !password) {
      console.error("用法：node scripts/manage-users.js create-owner <用户名> <密码>");
      process.exit(1);
    }
    const user = createOwner({ username, password });
    console.log(`✓ owner 已创建：${user.username}（id=${user.id}）`);
    console.log("  多用户模式已开启——现在起所有 API 需要登录，先用这个账号登录。");
  } else if (command === "bootstrap-test-users") {
    const count = Number.parseInt(args[0] || "", 10);
    if (!Number.isInteger(count) || count < 2 || count > 10) {
      console.error("用法：node scripts/manage-users.js bootstrap-test-users <2-10>");
      process.exit(1);
    }
    if (countUsers() !== 0) throw new Error("已有用户，不能覆盖或重置账号；请改用 invite-batch");
    const ownerPassword = randomPassword();
    createOwner({ username: "arlan", password: ownerPassword, displayName: "Arlan" });
    console.log(`✓ 已创建 ${count} 个可登录账号（含 owner）：`);
    console.log(`  arlan / ${ownerPassword}  [owner]`);
    for (let i = 1; i < count; i++) {
      const username = `test${String(i).padStart(2, "0")}`;
      const password = randomPassword();
      createUser({
        id: `u_${randomBytes(6).toString("hex")}`,
        username,
        passHash: hashPassword(password),
        displayName: `测试用户 ${i}`,
        role: "member"
      });
      console.log(`  ${username} / ${password}`);
    }
    console.log("  请妥善保存以上密码；当前版本不提供密码重置。 ");
  } else if (command === "invite" || command === "invite-batch") {
    if (!getUserById(OWNER_USER_ID)) {
      throw new Error("请先执行 create-owner；未建 owner 时禁止生成邀请码");
    }
    if (command === "invite") {
      const code = `echo-${randomBytes(4).toString("hex")}`;
      createInvite(code, { note: args.join(" ") || null, createdBy: "cli" });
      console.log(`✓ 邀请码：${code}`);
      console.log("  一次性有效。发给朋友，注册页填这个码。");
    } else {
      const count = Number.parseInt(args[0] || "", 10);
      if (!Number.isInteger(count) || count < 1 || count > 10) {
        console.error("用法：node scripts/manage-users.js invite-batch <1-10> [备注]");
        process.exit(1);
      }
      const note = args.slice(1).join(" ") || null;
      const codes = Array.from({ length: count }, () => {
        const code = `echo-${randomBytes(4).toString("hex")}`;
        createInvite(code, { note, createdBy: "cli" });
        return code;
      });
      console.log(`✓ 已生成 ${count} 枚一次性邀请码${note ? `（${note}）` : ""}：`);
      for (const code of codes) console.log(`  ${code}`);
      console.log("  每个码只能注册一个账号；邀请码不包含或预设密码。");
    }
  } else if (command === "list") {
    console.log("── 用户 ──");
    for (const u of listUsers()) console.log(`  ${u.id.padEnd(14)} ${u.username.padEnd(16)} ${u.role.padEnd(8)} 最近登录 ${u.lastLoginAt || "从未"}`);
    console.log("── 邀请码 ──");
    for (const i of listInvites()) console.log(`  ${i.code.padEnd(16)} ${i.used_by ? `已用（${i.used_by}）` : "未用"} ${i.note || ""}`);
  } else {
    console.error("用法：node scripts/manage-users.js <create-owner|bootstrap-test-users|invite|invite-batch|list>");
    process.exit(1);
  }
} catch (error) {
  console.error(`✗ ${error.message}`);
  process.exit(1);
}
