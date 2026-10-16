// Storage: Upstash Redis (prefix qrclaim:) or in-memory fallback for local/demo.
import { Redis } from "@upstash/redis";

export interface Store {
  get<T>(k: string): Promise<T | null>;
  set(k: string, v: unknown, exSec?: number): Promise<void>;
  del(k: string): Promise<void>;
  hget<T>(k: string, f: string): Promise<T | null>;
  hset(k: string, f: string, v: unknown): Promise<void>;
  hdel(k: string, f: string): Promise<void>;
  hgetall<T>(k: string): Promise<Record<string, T>>;
  lpush(k: string, v: unknown, max?: number): Promise<void>;
  lrange<T>(k: string, n: number): Promise<T[]>;
  incr(k: string, exSec?: number): Promise<number>;
}
const P = "qrclaim:";

export function memoryStore(): Store {
  const kv = new Map<string, any>(); const exp = new Map<string, number>();
  const live = (k: string) => { const e = exp.get(k); if (e && e < Date.now()) { kv.delete(k); exp.delete(k); } return kv.get(k); };
  const clone = (v: any) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  return {
    async get(k) { return clone(live(P + k)); },
    async set(k, v, ex) { kv.set(P + k, clone(v)); if (ex) exp.set(P + k, Date.now() + ex * 1000); },
    async del(k) { kv.delete(P + k); },
    async hget(k, f) { return clone((live(P + k) ?? {})[f]); },
    async hset(k, f, v) { const h = live(P + k) ?? {}; h[f] = clone(v); kv.set(P + k, h); },
    async hdel(k, f) { const h = live(P + k) ?? {}; delete h[f]; kv.set(P + k, h); },
    async hgetall(k) { return clone(live(P + k) ?? {}); },
    async lpush(k, v, max = 1000) { const l = live(P + k) ?? []; l.unshift(clone(v)); kv.set(P + k, l.slice(0, max)); },
    async lrange(k, n) { return clone((live(P + k) ?? []).slice(0, n)); },
    async incr(k, ex) { const n = (live(P + k) ?? 0) + 1; kv.set(P + k, n); if (ex && n === 1) exp.set(P + k, Date.now() + ex * 1000); return n; },
  };
}

export function redisStore(url: string, token: string): Store {
  const r = new Redis({ url, token });
  return {
    async get(k) { return (await r.get(P + k)) as any; },
    async set(k, v, ex) { ex ? await r.set(P + k, v, { ex }) : await r.set(P + k, v); },
    async del(k) { await r.del(P + k); },
    async hget(k, f) { return (await r.hget(P + k, f)) as any; },
    async hset(k, f, v) { await r.hset(P + k, { [f]: v }); },
    async hdel(k, f) { await r.hdel(P + k, f); },
    async hgetall(k) { return ((await r.hgetall(P + k)) ?? {}) as any; },
    async lpush(k, v, max = 1000) { await r.lpush(P + k, v); await r.ltrim(P + k, 0, max - 1); },
    async lrange(k, n) { return (await r.lrange(P + k, 0, n - 1)) as any; },
    async incr(k, ex) { const n = await r.incr(P + k); if (ex && n === 1) await r.expire(P + k, ex); return n; },
  };
}

let cached: Store | null = null;
export function getStore(): { store: Store; persistent: boolean } {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (url && token) { cached ??= redisStore(url, token); return { store: cached, persistent: true }; }
  cached ??= memoryStore();
  return { store: cached, persistent: false };
}
export function setStoreForTests(s: Store) { cached = s; }
