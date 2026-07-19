type HistoryMessage = { role?: unknown; content?: unknown; createdAt?: unknown };

/**
 * Bounded context window: preserve recent turns verbatim and compress older turns
 * into short semantic breadcrumbs. This prevents a long chat from crowding out the
 * current filing/evidence blocks while keeping pronouns and follow-ups resolvable.
 */
export function compactConversationHistory(history: unknown, maxChars = 12_000) {
  const messages = (Array.isArray(history) ? history : [])
    .filter((item: HistoryMessage) => item && (item.role === "user" || item.role === "assistant") && String(item.content || "").trim())
    .map((item: HistoryMessage) => ({
      role: item.role as "user" | "assistant",
      content: String(item.content).replace(/\s+/g, " ").trim(),
      createdAt: item.createdAt ? String(item.createdAt) : undefined
    }));
  if (!messages.length) return [];

  const recent = messages.slice(-8);
  const older = messages.slice(0, -8);
  let used = recent.reduce((sum, item) => sum + item.content.length, 0);
  const compactedOlder = [];
  for (let i = older.length - 1; i >= 0 && used < maxChars; i--) {
    const item = older[i];
    const limit = item.role === "user" ? 180 : 320;
    const content = item.content.length > limit ? `${item.content.slice(0, limit)}…` : item.content;
    used += content.length;
    compactedOlder.unshift({ ...item, content, compacted: true });
  }
  return [...compactedOlder, ...recent].slice(-24);
}
