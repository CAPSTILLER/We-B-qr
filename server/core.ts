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
  links: Link[]; status: "active" | "retired"; gate?: string; createdBy?: string; createdRole?: Role;
  autoRefillMin?: number; lastAutoAt?: number;
  mode?: "rotating" | "faucet"; perWalletHours?: number; totalCap?: number; fundAmount?: string; demoBalanceRaw?: string;
  filled: boolean; refilledAt: number; unlockAt: number;
  claims: number; lastClaimAt: number; createdAt: number; rotatedTo?: string;
}
export interface ClaimRec { wallet: string; at: number; secsFromUnlock: number; status: "authorized" | "confirmed" | "demo"; tx?: string; name?: string }
export interface Alert { id: string; codeId: string; kind: "instant" | "repeat_wallet" | "daily_cap" | "failed_burst" | "pool_low" | "auto_refill"; detail: string; at: number; resolved?: boolean }

export interface Chain {
  verifyLogin(address: `0x${string}`, message: string, sig: `0x${string}`): Promise<boolean>;
  capsMindBalance(address: `0x${string}`): Promise<bigint>;
  primaryBasename(address: `0x${string}`): Promise<string | null>; // verified primary *.base.eth with forward match, else null
  slot(key: `0x${string}`): Promise<{ token: string; balance: bigint; epoch: bigint; retired: boolean } | null>; // null = no contract
  signClaim(m: { slot: `0x${string}`; token: `0x${string}`; to: `0x${string}`; amount: bigint; epoch: bigint; nonce: bigint; deadline: bigint }): Promise<`0x${string}` | null>;
  slotKey(id: string): `0x${string}`;
  claimedBefore(key: `0x${string}`, to: `0x${string}`): Promise<boolean>; // onchain Claimed(slot,to) logs
  gateBalance(gate: `0x${string}`, wallet: `0x${string}`): Promise<bigint>;
  paused(): Promise<boolean>;
  float(token: `0x${string}`): Promise<bigint>;
  refiller(): Promise<string | null>;               // onchain refiller address
  refillWallet(): string | null;                    // address of REFILL_WALLET_KEY
  sendRefill(token: `0x${string}`, keys: `0x${string}`[], amounts: bigint[]): Promise<`0x${string}`>;
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
  const clean = (n: string) => process.env[n]?.trim().replace(/^['"]|['"]$/g, "").trim() || null;
  const s = clean("QRCLAIM_SESSION_SECRET") ?? (clean("CLAIM_SIGNER_KEY") ? "k:" + clean("CLAIM_SIGNER_KEY") : null);
  if (!s) { if (process.env.VERCEL_ENV === "production") throw new HttpError(503, "Admin sign-in isn't set up yet (QRCLAIM_SESSION_SECRET missing on Vercel)."); return "dev-only-secret"; }
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
    if (!n) throw new HttpError(401, "Sign-in timed out. Tap Connect again.");
    await this.s.del(`nonce:${address.toLowerCase()}`);
    if (!(await this.c.verifyLogin(address, loginMessage(address, n), sig))) throw new HttpError(401, "Signature didn't match this wallet. Tap Connect and try again.");
    let role: Role;
    if (address.toLowerCase() === OWNER) role = "owner";
    else if ((await this.c.capsMindBalance(address)) > 0n) role = "teammate";
    else throw new HttpError(403, "This wallet isn't the owner Ledger and doesn't hold a CAPs Mind NFT on Base. Switch to a wallet that holds one.");
    await this.audit(address.toLowerCase(), "login", [], role);
    return { token: makeSession(address, role), role };
  }

  // ---- admin reads ----
  async state(actor: string, role: Role) {
    const [folders, codes, alerts] = await Promise.all([this.s.hgetall<Folder>("folders"), this.s.hgetall<Code>("codes"), this.s.lrange<Alert>("alerts", 200)]);
    if (!folders[BOT_FOLDER]) { folders[BOT_FOLDER] = { id: BOT_FOLDER, name: "Bot grab" }; await this.s.hset("folders", BOT_FOLDER, folders[BOT_FOLDER]); }
    await this.audit(actor, "view_list", [], String(Object.keys(codes).length));
    return { role, allowedTokens: await this.allowedTokens(), folders: Object.values(folders), codes: Object.values(codes).sort((a, b) => a.serial - b.serial), alerts, contract: this.c.contract };
  }
  async codeDetail(actor: string, id: string) {
    const c = await this.code(id); if (!c) throw new HttpError(404, "No such code");
    await this.audit(actor, "view_code", [id]);
    const claims = await this.s.lrange<ClaimRec>(`claims:${id}`, 500);
    const oc = await this.c.slot(this.c.slotKey(id)).catch(() => null);
    const balRaw = oc ? oc.balance : BigInt(c.demoBalanceRaw ?? "0");
    const dec = this.decimals(c);
    const remaining = (Number(balRaw) / 10 ** dec).toString();
    const dayAgo = now() - 86400e3;
    const stats = { remaining, claimsLeft: Math.floor(Number(balRaw) / Number(toRaw(c.amount, dec))), claims24h: claims.filter((x) => x.at > dayAgo).length, uniqueWallets: new Set(claims.map((x) => x.wallet)).size };
    return { code: c, claims: claims.slice(0, 200), stats, slotKey: this.c.slotKey(id) };
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
    const links = (input.links ?? base?.links ?? []).filter((l) => l.url?.trim()).slice(0, 3).map((l) => {
      let url = l.url.trim();
      if (/^http:\/\//i.test(url)) url = "https://" + url.slice(7);
      if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = "https://" + url; // "x.com/cap" -> https://x.com/cap
      let host = "";
      try { const u = new URL(url); if (u.protocol !== "https:") throw 0; host = u.hostname.replace(/^www\./, ""); } catch { throw new HttpError(400, `Link "${l.label || l.url}" isn't a valid web address`); }
      return { label: (l.label?.trim() || host).slice(0, 30), url: url.slice(0, 300) };
    });
    const kind = (input.kind ?? base?.kind ?? "digital") as Code["kind"];
    const gate = (input.gate ?? base?.gate ?? "").trim();
    if (gate && !isAddr(gate)) throw new HttpError(400, "Gate must be a 0x NFT/token contract");
    const mode = (input.mode ?? base?.mode ?? "rotating") === "faucet" ? "faucet" : "rotating";
    const fundAmount = String(input.fundAmount ?? base?.fundAmount ?? (mode === "faucet" ? String(Number(amount) * 25) : amount));
    if (!/^\d+(\.\d+)?$/.test(fundAmount)) throw new HttpError(400, "Bad fund amount");
    return {
      mode, fundAmount,
      perWalletHours: Math.max(1, Math.min(720, Number(input.perWalletHours ?? base?.perWalletHours ?? 24))),
      totalCap: Math.max(0, Math.floor(Number(input.totalCap ?? base?.totalCap ?? 0))),
      demoBalanceRaw: base?.demoBalanceRaw, autoRefillMin: mode === "faucet" ? 0 : base?.autoRefillMin, lastAutoAt: base?.lastAutoAt,
      name, token, amount, kind, links, gate: gate || undefined, createdBy: base?.createdBy, createdRole: base?.createdRole,
      folderId: input.folderId ?? base?.folderId ?? "",
      basenameOnly: input.basenameOnly ?? base?.basenameOnly ?? kind === "digital",
      unlockWindowH: mode === "faucet" ? 0 : Math.max(0, Math.min(720, Number(input.unlockWindowH ?? base?.unlockWindowH ?? 24))),
      dailyCap: Math.max(1, Math.min(100, Number(input.dailyCap ?? base?.dailyCap ?? DEFAULT_DAILY_CAP))),
      status: base?.status ?? "active", filled: base?.filled ?? false, refilledAt: base?.refilledAt ?? 0, unlockAt: base?.unlockAt ?? 0,
      claims: base?.claims ?? 0, lastClaimAt: base?.lastClaimAt ?? 0, rotatedTo: base?.rotatedTo,
    };
  }
  /** Ledger-managed allowed tokens: GEAR + CAPH always, plus owner-added 0x addresses. */
  async allowedTokens(): Promise<string[]> { return [...Object.keys(TOKENS), ...((await this.s.get<string[]>("allowedTokens")) ?? [])]; }
  async setAllowedTokens(actor: string, tokens: string[]) {
    const list = [...new Set((tokens ?? []).map((t) => t.trim().toLowerCase()).filter(isAddr))];
    await this.s.set("allowedTokens", list); await this.audit(actor, "set_allowed_tokens", [], list.join(",")); return { tokens: await this.allowedTokens() };
  }
  async createCode(actor: string, input: Partial<Code>, role: Role = "owner") {
    const allowed = (await this.allowedTokens()).map((t) => t.toLowerCase());
    const tok = String(input.token ?? "GEAR").trim();
    if (role !== "owner" && !allowed.includes(tok.toLowerCase())) throw new HttpError(403, "Teammates can only pick a token from the Ledger's allowed list");
    const serial = await this.s.incr("serial");
    const c: Code = { ...this.clean(input), id: newId(), serial, createdAt: now(), createdBy: actor, createdRole: role };
    await this.s.hset("codes", c.id, c); await this.audit(actor, role === "owner" ? "create_code" : "teammate_create_code", [c.id], `${c.name} · ${c.amount} ${c.token}`); return c;
  }
  async updateCode(actor: string, id: string, input: Partial<Code>) {
    const base = await this.code(id); if (!base) throw new HttpError(404, "No such code");
    const c: Code = { ...base, ...this.clean(input, base) };
    await this.s.hset("codes", id, c); await this.audit(actor, "update_code", [id]); return c;
  }
  /** Marks a refill: random unlock inside the window. Onchain, the Ledger/refiller must also call refill(). */
  tokenAddr(c: Code) { return (TOKENS[c.token]?.address ?? c.token) as `0x${string}`; }
  /** Top-up per slot so a slot holds exactly one claim amount (never overfills). */
  async topup(c: Code): Promise<bigint> {
    if (c.mode === "faucet") return toRaw(c.fundAmount ?? c.amount, this.decimals(c)); // faucet: add, never capped to one claim
    const want = toRaw(c.amount, this.decimals(c));
    const oc = await this.c.slot(this.c.slotKey(c.id));
    if (!oc) return want;
    if (oc.retired) return 0n;
    return oc.balance >= want ? 0n : want - oc.balance;
  }
  async refill(actor: string, ids: string[], role: Role = "owner") {
    const out: { id: string; slotKey: string; token: string; tokenAddress: string; amount: string; amountRaw: string }[] = [];
    for (const id of ids) {
      const c = await this.code(id); if (!c || c.status !== "active") continue;
      const t = await this.topup(c);
      c.filled = true; c.refilledAt = now(); c.unlockAt = c.mode === "faucet" ? 0 : now() + rnd(c.unlockWindowH * 3600e3);
      if (c.mode === "faucet" && !this.c.contract) c.demoBalanceRaw = (BigInt(c.demoBalanceRaw ?? "0") + t).toString();
      await this.s.hset("codes", id, c);
      if (t > 0n) out.push({ id, slotKey: this.c.slotKey(id), token: c.token, tokenAddress: this.tokenAddr(c), amount: c.amount, amountRaw: t.toString() });
    }
    await this.audit(actor, role === "owner" ? "refill" : "teammate_refill", ids); return { codes: out };
  }
  /** Fund a faucet with a specific amount (adds to the slot). */
  async fundFaucet(actor: string, id: string, amount: string, role: Role) {
    const c = await this.code(id); if (!c || c.status !== "active" || c.mode !== "faucet") throw new HttpError(400, "Not an active faucet code");
    if (!/^\d+(\.\d+)?$/.test(String(amount)) || Number(amount) <= 0) throw new HttpError(400, "Bad amount");
    const raw = toRaw(String(amount), this.decimals(c));
    c.filled = true; c.refilledAt = now();
    if (!this.c.contract) c.demoBalanceRaw = (BigInt(c.demoBalanceRaw ?? "0") + raw).toString();
    await this.s.hset("codes", id, c);
    await this.audit(actor, role === "owner" ? "fund_faucet" : "teammate_fund_faucet", [id], `${amount} ${c.token}`);
    return { codes: [{ id, slotKey: this.c.slotKey(id), token: c.token, tokenAddress: this.tokenAddr(c), amount: String(amount), amountRaw: raw.toString() }] };
  }
  async setAutoRefill(actor: string, ids: string[], minutes: number) {
    const m = Math.round(Number(minutes) || 0);
    if (m !== 0 && (m < 1 || m > 1440)) throw new HttpError(400, "Auto-refill interval must be 1 minute to 1 day (or off)");
    for (const id of ids) { const c = await this.code(id); if (c && c.mode !== "faucet") { c.autoRefillMin = m; await this.s.hset("codes", id, c); } }
    await this.audit(actor, "set_auto_refill", ids, m ? `${m} min` : "off"); return { ok: true, minutes: m };
  }
  /** Cron: refill due, empty, active codes from the unassigned pool using the refill wallet. */
  async autoRefill(minPoolUnits = 0) {
    const report: any = { refilled: [] as string[], skipped: {} as Record<string, string> };
    const codes = Object.values(await this.s.hgetall<Code>("codes")).filter((c) => c.status === "active" && c.mode !== "faucet" && (c.autoRefillMin ?? 0) > 0);
    if (!codes.length) return { ...report, note: "no auto-refill codes" };
    if (this.c.contract) {
      if (!this.c.refillWallet()) return { ...report, error: "REFILL_WALLET_KEY not set" };
      if ((await this.c.refiller())?.toLowerCase() !== this.c.refillWallet()!.toLowerCase()) return { ...report, error: "Refill wallet isn't approved onchain (Ledger: setRefiller)" };
      if (await this.c.paused()) return { ...report, error: "contract paused" };
    }
    const due: Record<string, { c: Code; t: bigint }[]> = {};
    for (const c of codes) {
      if (c.folderId === BOT_FOLDER) { report.skipped[c.id] = "in Bot grab"; continue; }
      if (now() < (c.lastAutoAt ?? 0) + c.autoRefillMin! * 60e3 - 5e3) { report.skipped[c.id] = "not due"; continue; }
      const oc = await this.c.slot(this.c.slotKey(c.id));
      const empty = oc ? oc.balance === 0n && !oc.retired : !c.filled;
      if (!empty) { report.skipped[c.id] = "not empty"; continue; }
      (due[this.tokenAddr(c)] ??= []).push({ c, t: toRaw(c.amount, this.decimals(c)) });
    }
    for (const [token, list] of Object.entries(due)) {
      const need = list.reduce((a, x) => a + x.t, 0n);
      const decimals = this.decimals(list[0].c);
      const minPool = BigInt(Math.round(minPoolUnits)) * 10n ** BigInt(decimals);
      let pick = list;
      if (this.c.contract) {
        const pool = await this.c.float(token as `0x${string}`);
        let budget = pool > minPool ? pool - minPool : 0n;
        pick = list.filter((x) => (budget >= x.t ? ((budget -= x.t), true) : false));
        if (pick.length < list.length) await this.alert(list[0].c.id, "pool_low", `Pool low for ${list[0].c.token}: ${list.length - pick.length} auto-refills skipped (need ${need}, pool ${pool})`);
        if (!pick.length) { list.forEach((x) => (report.skipped[x.c.id] = "pool low")); continue; }
        report.tx ??= [];
        report.tx.push(await this.c.sendRefill(token as `0x${string}`, pick.map((x) => this.c.slotKey(x.c.id)), pick.map((x) => x.t)));
      }
      for (const { c } of pick) {
        c.filled = true; c.refilledAt = now(); c.lastAutoAt = now(); c.unlockAt = now() + rnd(c.unlockWindowH * 3600e3);
        await this.s.hset("codes", c.id, c); report.refilled.push(c.id);
      }
    }
    if (report.refilled.length) await this.audit("auto-refill", "auto_refill", report.refilled);
    return report;
  }
  async retire(actor: string, id: string, role: Role = "owner") {
    const c = await this.code(id); if (!c) throw new HttpError(404, "No such code");
    c.status = "retired"; c.filled = false; await this.s.hset("codes", id, c); await this.audit(actor, role === "owner" ? "retire" : "teammate_retire", [id]);
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
  private async liveState(c: Code): Promise<"ready" | "locked" | "empty" | "retired"> {
    if (c.status !== "active") return "retired";
    if (c.mode === "faucet") {
      if (c.totalCap && c.claims >= c.totalCap) return "empty";
      const oc = await this.c.slot(this.c.slotKey(c.id));
      const bal = oc ? (oc.retired ? 0n : oc.balance) : BigInt(c.demoBalanceRaw ?? "0");
      return bal >= toRaw(c.amount, this.decimals(c)) ? "ready" : "empty";
    }
    const onchain = await this.c.slot(this.c.slotKey(c.id));
    const funded = onchain ? !onchain.retired && onchain.balance >= toRaw(c.amount, this.decimals(c)) : c.filled;
    if (!funded) return "empty";
    return now() >= c.unlockAt ? "ready" : "locked"; // "Refilling soon", never shows the unlock time
  }
  private decimals(c: Code) { return TOKENS[c.token]?.decimals ?? 18; }
  async card(id: string) {
    const c = await this.code(id);
    if (!c) throw new HttpError(404, "This code isn't active"); // same reply as unknown: no enumeration hints
    return { mode: c.mode ?? "rotating", perWalletHours: c.perWalletHours ?? 24, name: c.name, token: TOKENS[c.token] ? c.token : "TOKEN", amount: c.amount, links: c.links, state: await this.liveState(c), basenameOnly: c.basenameOnly, demo: !this.c.contract };
  }
  async prepare(id: string, wallet: `0x${string}`, ipHash = "") {
    if (!isAddr(wallet)) throw new HttpError(400, "Bad wallet");
    const w = wallet.toLowerCase();
    const c = await this.code(id); if (!c) throw new HttpError(404, "This code isn't active");
    const st = await this.liveState(c);
    if (st !== "ready") {
      if (ipHash && (await this.s.incr(`fail:${id}:${ipHash}`, 600)) === 10) await this.alert(id, "failed_burst", `10+ tries on an empty code from one device`);
      throw new HttpError(409, st === "retired" ? "This code is retired" : st === "locked" ? "Refilling soon. Check back later." : "Empty. Check back later.");
    }
    const faucet = c.mode === "faucet";
    if (faucet) {
      const last = await this.s.get<number>(`fw:${id}:${w}`);
      const wait = last ? last + (c.perWalletHours ?? 24) * 3600e3 - now() : 0;
      if (wait > 0) throw new HttpError(429, `Already claimed. Come back in ${fmtWait(wait)}.`);
    } else if (await this.s.get(`wc:${id}:${w}`)) throw new HttpError(403, "This wallet already claimed this code");
    let name: string | undefined;
    if (c.basenameOnly) {
      name = (await this.c.primaryBasename(wallet)) ?? undefined;
      if (!name) throw new HttpError(403, "This code needs a primary Basename (name.base.eth) set on this wallet");
    }
    if (c.gate && (await this.c.gateBalance(c.gate as `0x${string}`, wallet)) === 0n) throw new HttpError(403, "This code is for holders of a gate NFT/token");
    const dk = `wd:${w}:${day()}`;
    const used = (await this.s.get<number>(dk)) ?? 0;
    if (used >= c.dailyCap) { await this.alert(id, "daily_cap", `${w} hit ${c.dailyCap}/day`); throw new HttpError(429, "Daily claim limit reached for this wallet"); }
    const secsFromUnlock = Math.round((now() - (faucet ? c.refilledAt : c.unlockAt)) / 1000);
    if (faucet) await this.s.set(`fw:${id}:${w}`, now(), (c.perWalletHours ?? 24) * 3600);
    if (!faucet && secsFromUnlock < INSTANT_SECS) await this.alert(id, "instant", `${w} claimed ${secsFromUnlock}s after unlock`);
    const codesToday = await this.s.incr(`wcodes:${w}:${day()}`, 172800);
    if (codesToday === 5) await this.alert(id, "repeat_wallet", `${w} tried 5 codes today`);

    if (!this.c.contract) {
      // DEMO: record and empty the code, no tokens move
      await this.recordClaim(c, w, secsFromUnlock, "demo", undefined, name);
      return { demo: true as const, name, comeBackHours: faucet ? c.perWalletHours ?? 24 : undefined };
    }
    if (!faucet && await this.c.claimedBefore(this.c.slotKey(id), wallet)) { await this.s.set(`wc:${id}:${w}`, 1); throw new HttpError(403, "This wallet already claimed this code"); }
    const onchain = (await this.c.slot(this.c.slotKey(id)))!;
    const token = (TOKENS[c.token]?.address ?? c.token) as `0x${string}`;
    const m = { slot: this.c.slotKey(id), token, to: wallet, amount: toRaw(c.amount, this.decimals(c)), epoch: onchain.epoch, nonce: BigInt("0x" + randomBytes(31).toString("hex")), deadline: BigInt(Math.floor(now() / 1000) + 600) };
    const sig = await this.c.signClaim(m); if (!sig) throw new HttpError(503, "Claims are paused (no signer key)");
    await this.s.incr(dk, 172800);
    await this.s.lpush(`claims:${id}`, { wallet: w, at: now(), secsFromUnlock, status: "authorized", name } satisfies ClaimRec, 500);
    return { comeBackHours: faucet ? c.perWalletHours ?? 24 : undefined, demo: false as const, contract: this.c.contract, args: { ...m, amount: m.amount.toString(), epoch: m.epoch.toString(), nonce: m.nonce.toString(), deadline: m.deadline.toString() }, sig, name };
  }
  private async recordClaim(c: Code, w: string, secsFromUnlock: number, status: ClaimRec["status"], tx?: string, name?: string) {
    if (c.mode !== "faucet") await this.s.set(`wc:${c.id}:${w}`, 1);
    if (status === "demo") await this.s.incr(`wd:${w}:${day()}`, 172800);
    if (c.mode === "faucet" && status === "demo") c.demoBalanceRaw = (BigInt(c.demoBalanceRaw ?? "0") - toRaw(c.amount, this.decimals(c))).toString();
    await this.s.lpush(`claims:${c.id}`, { wallet: w, at: now(), secsFromUnlock, status, tx, name } satisfies ClaimRec, 500);
    c.claims += 1; c.lastClaimAt = now(); if (c.mode !== "faucet") c.filled = false;
    await this.s.hset("codes", c.id, c);
  }
  /** Called after the wallet's claim tx confirms; router verifies the receipt's Claimed event first. */
  async confirm(id: string, wallet: string, tx: string) {
    const c = await this.code(id); if (!c) throw new HttpError(404, "No such code");
    await this.recordClaim(c, wallet.toLowerCase(), Math.round((now() - c.unlockAt) / 1000), "confirmed", tx);
    return { ok: true };
  }
}

export function fmtWait(ms: number) {
  const h = Math.floor(ms / 3600e3), m = Math.ceil((ms % 3600e3) / 60e3);
  return h >= 1 ? `${h}h${m && h < 6 ? ` ${m}m` : ""}` : `${m}m`;
}
