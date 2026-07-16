import { eq } from "drizzle-orm";
import { userPreferences } from "../schema/misc.js";
import { withTenant } from "./context.js";

const defaults = {
  onboardingCompleted: false,
  notifyDigest: true,
  notifyPositions: true,
  notifyFalsify: true,
  notifyReview: true,
  notifyEarnings: true,
  quietHoursStart: null as string | null,
  quietHoursEnd: null as string | null
};

type Preferences = typeof defaults;

function hydrate(row: typeof userPreferences.$inferSelect | undefined): Preferences {
  if (!row) return { ...defaults };
  return {
    onboardingCompleted: row.onboardingCompleted,
    notifyDigest: row.notifyDigest,
    notifyPositions: row.notifyPositions,
    notifyFalsify: row.notifyFalsify,
    notifyReview: row.notifyReview,
    notifyEarnings: row.notifyEarnings,
    quietHoursStart: row.quietHoursStart || null,
    quietHoursEnd: row.quietHoursEnd || null
  };
}

export async function getUserPreferences(userId = "local") {
  return withTenant(userId, async (tx) => hydrate((await tx.select().from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1))[0]));
}

export async function updateUserPreferences(userId = "local", patch: Partial<Preferences> = {}) {
  return withTenant(userId, async (tx) => {
    const current = hydrate((await tx.select().from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1))[0]);
    const next = { ...current };
    for (const key of Object.keys(defaults) as Array<keyof Preferences>) {
      if (typeof patch[key] === "boolean") (next as any)[key] = patch[key];
      else if ((key === "quietHoursStart" || key === "quietHoursEnd") && patch[key] !== undefined) next[key] = patch[key]!;
    }
    const [saved] = await tx.insert(userPreferences).values({ userId, ...next, updatedAt: new Date() })
      .onConflictDoUpdate({ target: userPreferences.userId, set: { ...next, updatedAt: new Date() } }).returning();
    return hydrate(saved);
  });
}

/**
 * 通知 kind → 用户偏好开关。
 *
 * key 必须与**代码实际发出**的 kind 字符串逐字一致，否则这里查不到映射就默认放行，
 * 开关静默失效。`digest` 曾是这里的 key，但 #27 迁移后 worker 改发 `event_digest`
 * ——字符串漂移了，两边都没报错（库里那 7 行 `digest` 是旧底盘留下的）。
 * 改 kind 时必须同步改这里；`insertNotification` 是唯一咽喉，加新 kind 请一并登记。
 *
 * `position_alert`/`review_reminder` 目前**没有任何代码发出**（持仓纪律、研究复盘提醒
 * 属 docs/PLAN.md P3 未建功能）。映射先留着，等功能落地即自动生效；设置页对应的两个
 * 开关已标注"未接通"，不冒充可用。
 */
const kindPreference: Record<string, keyof Preferences> = {
  event_digest: "notifyDigest",
  position_alert: "notifyPositions",
  falsify_alert: "notifyFalsify",
  review_reminder: "notifyReview",
  earnings_review: "notifyEarnings"
};

/** 未登记的 kind（如用户主动触发的 `system` 测试通知）一律放行——只有明确对应某个
 *  开关的通知才受该开关控制。 */
export async function notificationEnabled(userId: string, kind: string) {
  const key = kindPreference[kind];
  return key ? (await getUserPreferences(userId))[key] : true;
}

/**
 * 判定当前时刻是否落在用户设定的免打扰时段内。
 * 支持跨午夜区间（如 22:00–08:00）。未设定则视为不在免打扰。
 */
export async function isInQuietHours(userId: string) {
  const prefs = await getUserPreferences(userId);
  if (!prefs.quietHoursStart || !prefs.quietHoursEnd) return false;
  const now = new Date();
  const hhmm = `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
  const start = prefs.quietHoursStart;
  const end = prefs.quietHoursEnd;
  if (start <= end) return hhmm >= start && hhmm < end;
  return hhmm >= start || hhmm < end;
}
