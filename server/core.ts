// QR Claim core logic. Pure-ish: storage + chain are injected so tests can run offline.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Store } from "./store.js";

export const OWNER = "0xD8382719b8fF90eE3Dd521B9d7c5dc23E8e4EAca".toLowerCase();
export const CAPS_MIND = "0x00635ca44339c7c194ef5bc87bf2cd6df04a666d"; // ERC-721 "CAPs Mind" (supportsInterface 0x80ac58cd = true)
export const TOKENS: Record<string, { address: `0x${string}`; decimals: number }> = {
  GEAR: { address: "0x5880cD05605A549f1DAb01a53ca61Ee559244bD1", decimals: 6 },
  CAPH: { address: "0x1d1bcd1459259429accde23e24e1782f83e97ba3", decimals: 18 },
};
export const BOT_FOLDER = "bot-grab";
export const DEFAULT_DAILY_CAP = 3; // claims per wallet per UTC day across all codes
export const INSTANT_SECS = 60;

export type Role = "owner" | "teammate";
export interface Link { label: string; url: string }
export interface Folder { id: string; name: string; defaults?: { kind?: "digital" | "paper"; token?: string; amount?: string } }
export interface Code {
  id: string; serial: number; name: string; folderId: string;
  token: string; amount: string; kind: "digital" | "paper";
  basenameOnly: boolean; unlockWindowH: number; dailyCap: number;
  links: Link[]; status: "active" | "retired";
  filled: boolean; refilledAt: number; unlockAt: number;
  claims: number; lastClaimAt: number; createdAt: number; rotatedTo?: string;
}
export interface ClaimRec { wallet: string; at: number; secsFromUnlock: number; status: "authorized" | "confirmed" | "demo"; tx?: string; name?: string }
export interface Alert { id: string; codeId: string; kind: "instant" | "repeat_wallet" | "daily_cap" | "failed_burst"; detail: string; at: number; resolved?: boolean }

export interface Chain {
  verifyLogin(address: `0x${string}`, message: string, sig: `0x${string}`): Promise<boolean>;
  capsMindBalance(address: `0x${string}`): Promise<bigint>;
  primaryBasename(address: `0x${string}`): Promise<string | null>; // verified primary *.base.eth with forward match, else null
  slot(key: `0x${string}`): Promise<{ token: string; balance: bigint; epoch: bigint; retired: boolean } | null>; // null = no contract
  signClaim(m: { slot: `0x${string}`; token: `0x${string}`; to: `0x${string}`; amount: bigint; epoch: bigint; nonce: bigint; deadline: bigint }): Promise<`0x${string}` | null>;
  slotKey(id: string): `0x${string}`;
  claimedBefore(key: `0x${string}`, to: `0x${string}`): Promise<boolean>; // onchain Claimed(slot,to) logs
  claimTx(tx: `0x${string}`): Promise<{ key: string; to: string } | null>;
  contract: string | null;
}

export class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
const now = () => Date.now();
const day = () => Math.floor(now() / 86400000);
export const newId = () => randomBytes(16).toString("base64url"); // 128-bit, unguessable
const rnd = (max: number) => Math.floor((randomBytes(4).readUInt32BE() / 2 ** 32) * max);
const isAddr = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);
export function toRaw(amount: string, decimals: number): bigint {
  const [w, f = ""] = amount.split("."); return BigInt(w || "0") * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
}

// ---------------- sessions ----------------
function secret() {
  const s = process.env.QRCLAIM_SESSION_SECRET ?? (process.env.CLAIM_SIGNER_KEY ? "k:" + process.env.CLAIM_SIGNER_KEY : null);
  if (!s) { if (process.env.VERCEL_ENV === "production") throw new HttpError(500, "Set QRCLAIM_SESSION_SECRET"); return "dev-only-secret"; }
  return createHmac("sha256", "qrclaim-session").update(s).digest();
}
export function makeSession(address: string, role: Role, hours = 12) {
  const body = Buffer.from(JSON.stringify({ a: address.toLowerCase(), r: role, e: now() + hours * 3600e3 })).toString("base64url");
  return body + "." + createHmac("sha256", secret()).update(body).digest("base64url");
}
export function readSession(token?: string | null): { a: string; r: Role } | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const want = createHmac("sha256", secret()).update(body).digest("base64url");
  if (want.length !== mac.length || !timingSafeEqual(Buffer.from(want), Buffer.from(mac))) return null;
  const s = JSON.parse(Buffer.from(body, "base64url").toString());
  return s.e > now() ? { a: s.a, r: s.r } : null;
}
export const loginMessage = (address: string, nonce: string) =>
  `payup QR Claim admin login\nAddress: ${address.toLowerCase()}\nNonce: ${nonce}\nThis signature only logs you in. No transaction, no gas.`;

// ---------------- service ----------------
export class QrClaim {
  constructor(private s: Store, private c: Chain) {}

  private async audit(actor: string, action: string, ids: string[] = [], extra = "") {
    await this.s.lpush("audit", { actor, action, ids, extra, at: now() }, 5000);
  }
  private async alert(codeId: string, kind: Alert["kind"], detail: string) {
    await this.s.lpush("alerts", { id: newId(), codeId, kind, detail, at: now() } satisfies Alert, 2000);
  }
  async code(id: string) { return this.s.hget<Code>("codes", id); }

  // ---- auth ----
  async nonce(address: string) {
    if (!isAddr(address)) throw new HttpError(400, "Bad address");
    const n = newId(); await this.s.set(`nonce:${address.toLowerCase()}`, n, 600);
    return { message: loginMessage(address, n) };
  }
  async login(address: `0x${string}`, sig: `0x${string}`) {
    const n = await this.s.get<string>(`nonce:${address.toLowerCase()}`);
    if (!n) throw new HttpError(401, "Login expired, try again");
    await this.s.del(`nonce:${address.toLowerCase()}`);
    if (!(await this.c.verifyLogin(address, loginMessage(address, n), sig))) throw new HttpError(401, "Signature check failed");
    let role: Role;
    if (address.toLowerCase() === OWNER) role = "owner";
    else if ((await this.c.capsMindBalance(address)) > 0n) role = "teammate";
    else throw new HttpError(403, "This wallet is not the owner Ledger and holds no CAPs Mind NFT");
    await this.audit(address.toLowerCase(), "login", [], role);
    return { token: makeSession(address, role), role };
  }

  // ---- admin reads ----
  async state(actor: string, role: Role) {
    const [folders, codes, alerts] = await Promise.all([this.s.hgetall<Folder>("folders"), this.s.hgetall<Code>("codes"), this.s.lrange<Alert>("alerts", 200)]);
    if (!folders[BOT_FOLDER]) { folders[BOT_FOLDER] = { id: BOT_FOLDER, name: "Bot grab" }; await this.s.hset("folders", BOT_FOLDER, folders[BOT_FOLDER]); }
    await this.audit(actor, "view_list", [], String(Object.keys(codes).length));
    return { role, folders: Object.values(folders), codes: Object.values(codes).sort((a, b) => a.serial - b.serial), alerts, contract: this.c.contract };
  }
  async codeDetail(actor: string, id: string) {
    const c = await this.code(id); if (!c) throw new HttpError(404, "No such code");
    await this.audit(actor, "view_code", [id]);
    return { code: c, claims: await this.s.lrange<ClaimRec>(`claims:${id}`, 200), slotKey: this.c.slotKey(id) };
  }
  async auditLog() { return this.s.lrange("audit", 300); }
  async logPrint(actor: string, ids: string[]) { await this.audit(actor, "print", ids); return { ok: true }; }

  // ---- organize (owner + teammates) ----
  async saveFolder(actor: string, f: { id?: string; name: string; defaults?: Folder["defaults"] }, role: Role) {
    const name = (f.name ?? "").trim().slice(0, 40); if (!name) throw new HttpError(400, "Folder needs a name");
    const id = f.id ?? newId().slice(0, 10);
    const prev = await this.s.hget<Folder>("folders", id);
    const folder: Folder = { id, name, defaults: role === "owner" ? f.defaults ?? prev?.defaults : prev?.defaults };
    await this.s.hset("folders", id, folder); await this.audit(actor, f.id ? "rename_folder" : "create_folder", [id], name);
    return folder;
  }
  async deleteFolder(actor: string, id: string) {
    if (id === BOT_FOLDER) throw new HttpError(400, "Bot grab folder stays");
    const codes = Object.values(await this.s.hgetall<Code>("codes"));
    if (codes.some((c) => c.folderId === id)) throw new HttpError(400, "Move its codes out first");
    await this.s.hdel("folders", id); await this.audit(actor, "delete_folder", [id]); return { ok: true };
  }
  async move(actor: string, ids: string[], folderId: string) {
    if (!(await this.s.hget("folders", folderId)) && folderId !== BOT_FOLDER) throw new HttpError(400, "No such folder");
    for (const id of ids) { const c = await this.code(id); if (c) { c.folderId = folderId; await this.s.hset("codes", id, c); } }
    await this.audit(actor, "move", ids, folderId); return { ok: true };
  }

  // ---- rules (owner only; enforced by router) ----
  private clean(input: Partial<Code>, base?: Code): Omit<Code, "id" | "serial" | "createdAt"> {
    const name = (input.name ?? base?.name ?? "").trim().slice(0, 60); if (!name) throw new HttpError(400, "Name the code");
    const token = (input.token ?? base?.token ?? "GEAR").trim();
    if (!TOKENS[token] && !isAddr(token)) throw new HttpError(400, "Token must be GEAR, CAPH or an allowlisted 0x address");
    const amount = String(input.amount ?? base?.amount ?? "1"); if (!/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) throw new HttpError(400, "Bad amount");
    const links = (input.links ?? base?.links ?? []).filter((l) => l.label?.trim() && l.url?.trim()).slice(0, 3).map((l) => {
      const url = l.url.trim(); if (!/^https:\/\//i.test(url)) throw new HttpError(400, `Link "${l.label}" must start with https://`);
      return { label: l.label.trim().slice(0, 30), url: url.slice(0, 300) };
    });
    const kind = (input.kind ?? base?.kind ?? "digital") as Code["kind"];
    return {
      name, token, amount, kind, links,
      folderId: input.folderId ?? base?.folderId ?? "",
      basenameOnly: input.basenameOnly ?? base?.basenameOnly ?? kind === "digital",
      unlockWindowH: Math.max(0, Math.min(720, Number(input.unlockWindowH ?? base?.unlockWindowH ?? 24))),
      dailyCap: Math.max(1, Math.min(100, Number(input.dailyCap ?? base?.dailyCap ?? DEFAULT_DAILY_CAP))),
      status: base?.status ?? "active", filled: base?.filled ?? false, refilledAt: base?.refilledAt ?? 0, unlockAt: base?.unlockAt ?? 0,
      claims: base?.claims ?? 0, lastClaimAt: base?.lastClaimAt ?? 0, rotatedTo: base?.rotatedTo,
    };
  }
  async createCode(actor: string, input: Partial<Code>) {
    const serial = await this.s.incr("serial");
    const c: Code = { ...this.clean(input), id: newId(), serial, createdAt: now() };
    await this.s.hset("codes", c.id, c); await this.audit(actor, "create_code", [c.id], c.name); return c;
  }
  async updateCode(actor: string, id: string, input: Partial<Code>) {
    const base = await this.code(id); if (!base) throw new HttpError(404, "No such code");
    const c: Code = { ...base, ...this.clean(input, base) };
    await this.s.hset("codes", id, c); await this.audit(actor, "update_code", [id]); return c;
  }
  /** Marks a refill: random unlock inside the window. Onchain, the Ledger/refiller must also call refill(). */
  async refill(actor: string, ids: string[]) {
    const out: Code[] = [];
    for (const id of ids) {
      const c = await this.code(id); if (!c || c.status !== "active") continue;
      c.filled = true; c.refilledAt = now(); c.unlockAt = now() + rnd(c.unlockWindowH * 3600e3);
      await this.s.hset("codes", id, c); out.push(c);
    }
    await this.audit(actor, "refill", ids); return { codes: out.map((c) => ({ id: c.id, slotKey: this.c.slotKey(c.id), token: c.token, amount: c.amount })) };
  }
  async retire(actor: string, id: string) {
    const c = await this.code(id); if (!c) throw new HttpError(404, "No such code");
    c.status = "retired"; c.filled = false; await this.s.hset("codes", id, c); await this.audit(actor, "retire", [id]);
    return { code: c, slotKey: this.c.slotKey(id) };
  }
  /** New random ID with the same settings; the old one is retired (its old URL dies). */
  async rotate(actor: string, id: string) {
    const old = await this.code(id); if (!old) throw new HttpError(404, "No such code");
    const serial = await this.s.incr("serial");
    const fresh: Code = { ...old, id: newId(), serial, status: "active", filled: false, claims: 0, lastClaimAt: 0, refilledAt: 0, unlockAt: 0, createdAt: now(), rotatedTo: undefined };
    old.status = "retired"; old.filled = false; old.rotatedTo = fresh.id;
    await this.s.hset("codes", old.id, old); await this.s.hset("codes", fresh.id, fresh);
    await this.audit(actor, "rotate", [old.id, fresh.id]); return { code: fresh, oldSlotKey: this.c.slotKey(old.id) };
  }
  async resolveAlert(actor: string, alertId: string) { await this.audit(actor, "resolve_alert", [alertId]); return { ok: true }; }

  // ---- public ----
  private async liveState(c: Code): Promise<"ready" | "empty" | "retired"> {
    if (c.status !== "active") return "retired";
    const onchain = await this.c.slot(this.c.slotKey(c.id));
    const funded = onchain ? !onchain.retired && onchain.balance >= toRaw(c.amount, this.decimals(c)) : c.filled;
    if (!funded) return "empty";
    return now() >= c.unlockAt ? "ready" : "empty"; // locked looks empty: no countdown to snipe
  }
  private decimals(c: Code) { return TOKENS[c.token]?.decimals ?? 18; }
  async card(id: string) {
    const c = await this.code(id);
    if (!c) throw new HttpError(404, "This code isn't active"); // same reply as unknown: no enumeration hints
    return { name: c.name, token: TOKENS[c.token] ? c.token : "TOKEN", amount: c.amount, links: c.links, state: await this.liveState(c), basenameOnly: c.basenameOnly, demo: !this.c.contract };
  }
  async prepare(id: string, wallet: `0x${string}`, ipHash = "") {
    if (!isAddr(wallet)) throw new HttpError(400, "Bad wallet");
    const w = wallet.toLowerCase();
    const c = await this.code(id); if (!c) throw new HttpError(404, "This code isn't active");
    const st = await this.liveState(c);
    if (st !== "ready") {
      if (ipHash && (await this.s.incr(`fail:${id}:${ipHash}`, 600)) === 10) await this.alert(id, "failed_burst", `10+ tries on an empty code from one device`);
      throw new HttpError(409, st === "retired" ? "This code is retired" : "Empty right now. Check back later.");
    }
    if (await this.s.get(`wc:${id}:${w}`)) throw new HttpError(403, "This wallet already claimed this code");
    let name: string | undefined;
    if (c.basenameOnly) {
      name = (await this.c.primaryBasename(wallet)) ?? undefined;
      if (!name) throw new HttpError(403, "This code needs a primary Basename (name.base.eth) set on this wallet");
    }
    const dk = `wd:${w}:${day()}`;
    const used = (await this.s.get<number>(dk)) ?? 0;
    if (used >= c.dailyCap) { await this.alert(id, "daily_cap", `${w} hit ${c.dailyCap}/day`); throw new HttpError(429, "Daily claim limit reached for this wallet"); }
    const secsFromUnlock = Math.round((now() - c.unlockAt) / 1000);
    if (secsFromUnlock < INSTANT_SECS) await this.alert(id, "instant", `${w} claimed ${secsFromUnlock}s after unlock`);
    const codesToday = await this.s.incr(`wcodes:${w}:${day()}`, 172800);
    if (codesToday === 5) await this.alert(id, "repeat_wallet", `${w} tried 5 codes today`);

    if (!this.c.contract) {
      // DEMO: record and empty the code, no tokens move
      await this.recordClaim(c, w, secsFromUnlock, "demo", undefined, name);
      return { demo: true as const, name };
    }
    if (await this.c.claimedBefore(this.c.slotKey(id), wallet)) { await this.s.set(`wc:${id}:${w}`, 1); throw new HttpError(403, "This wallet already claimed this code"); }
    const onchain = (await this.c.slot(this.c.slotKey(id)))!;
    const token = (TOKENS[c.token]?.address ?? c.token) as `0x${string}`;
    const m = { slot: this.c.slotKey(id), token, to: wallet, amount: toRaw(c.amount, this.decimals(c)), epoch: onchain.epoch, nonce: BigInt("0x" + randomBytes(31).toString("hex")), deadline: BigInt(Math.floor(now() / 1000) + 600) };
    const sig = await this.c.signClaim(m); if (!sig) throw new HttpError(503, "Claims are paused (no signer key)");
    await this.s.incr(dk, 172800);
    await this.s.lpush(`claims:${id}`, { wallet: w, at: now(), secsFromUnlock, status: "authorized", name } satisfies ClaimRec, 500);
    return { demo: false as const, contract: this.c.contract, args: { ...m, amount: m.amount.toString(), epoch: m.epoch.toString(), nonce: m.nonce.toString(), deadline: m.deadline.toString() }, sig, name };
  }
  private async recordClaim(c: Code, w: string, secsFromUnlock: number, status: ClaimRec["status"], tx?: string, name?: string) {
    await this.s.set(`wc:${c.id}:${w}`, 1);
    if (status === "demo") await this.s.incr(`wd:${w}:${day()}`, 172800);
    await this.s.lpush(`claims:${c.id}`, { wallet: w, at: now(), secsFromUnlock, status, tx, name } satisfies ClaimRec, 500);
    c.claims += 1; c.lastClaimAt = now(); c.filled = false;
    await this.s.hset("codes", c.id, c);
  }
  /** Called after the wallet's claim tx confirms; router verifies the receipt's Claimed event first. */
  async confirm(id: string, wallet: string, tx: string) {
    const c = await this.code(id); if (!c) throw new HttpError(404, "No such code");
    await this.recordClaim(c, wallet.toLowerCase(), Math.round((now() - c.unlockAt) / 1000), "confirmed", tx);
    return { ok: true };
  }
}
