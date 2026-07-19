import Redis from "ioredis";

type MemoryEntry = { expiresAt: number; value: string };

const memory = new Map<string, MemoryEntry>();
let redis: Redis | null | undefined;

function client() {
  if (redis !== undefined) return redis;
  const url = process.env.REDIS_URL?.trim();
  if (!url) return (redis = null);
  redis = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    connectTimeout: 500,
    commandTimeout: 700
  });
  redis.on("error", () => {});
  return redis;
}

function cacheKey(namespace: string, key: string) {
  return `echo:${namespace}:${key}`;
}

export async function getCachedJson<T>(namespace: string, key: string): Promise<T | null> {
  const fullKey = cacheKey(namespace, key);
  const local = memory.get(fullKey);
  if (local && local.expiresAt > Date.now()) {
    try { return JSON.parse(local.value) as T; } catch { memory.delete(fullKey); }
  }
  const remote = client();
  if (!remote) return null;
  try {
    if (remote.status === "wait") await remote.connect();
    const value = await remote.get(fullKey);
    if (!value) return null;
    memory.set(fullKey, { value, expiresAt: Date.now() + 60_000 });
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export async function setCachedJson(namespace: string, key: string, value: unknown, ttlSeconds: number) {
  const fullKey = cacheKey(namespace, key);
  const serialized = JSON.stringify(value);
  memory.set(fullKey, { value: serialized, expiresAt: Date.now() + ttlSeconds * 1_000 });
  const remote = client();
  if (!remote) return;
  try {
    if (remote.status === "wait") await remote.connect();
    await remote.set(fullKey, serialized, "EX", ttlSeconds);
  } catch {
    // Cache is an optimization. PostgreSQL and the model path stay authoritative.
  }
}

export function cacheRuntime() {
  return { configured: Boolean(process.env.REDIS_URL), backend: client() ? "redis+memory" : "memory" };
}
