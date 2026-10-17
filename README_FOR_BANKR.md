# We B qr: scan-to-pay + Paper Gears

## Routes
- `/` Studio: Link/Text or Scan-to-Pay QR (USDC / GEAR / ETH on Base). Gear/dot/rounded/square modules, 12 gear-color gradients, GEAR/CAPH/custom center logo, CTA frame, wobble preview, PNG/SVG download. Error correction is always H. Low-contrast warning under 4:1.
- `/pay?to=<addr|name.base.eth>&amt=5&t=USDC&n=note`: one-tap pay page (EIP-6963 injected wallets + Base Account). Switches to Base, sends transfer, shows BaseScan link.
- `/paper`: printable gear-shaped PAY card sheets.

QR modes: "Pay page" works with any phone camera. "Wallet app (EIP-681)" encodes
`ethereum:<token>@8453/transfer?address=<to>&uint256=<raw>` for in-wallet scanners (needs a 0x address).

## QR Claim system (separate section)
- `/claim-admin`: admin. The owner Ledger `0xD8382719b8fF90eE3Dd521B9d7c5dc23E8e4EAca` sets all rules. CAPs Mind NFT holders (ERC-721 `0x00635ca44339c7c194ef5bc87bf2cd6df04a666d`, checked at sign-in) can create codes (tokens only from the Ledger allowed list), view, print, organize, **refill and retire**. Refill and retire also work onchain from their own wallet: the contract checks `teamNft.balanceOf(msg.sender) > 0`. Only the Ledger edits settings after creation, rotates, changes allowed tokens or signer, pauses, withdraws or rescues. Teammate creations are audit-logged. Optional per-code gate: live balanceOf check at claim time (snapshot mode not built yet). Login is one free wallet signature (EOA or smart wallet), and the session lasts 12 h.
- `/c/<randomId>`: scan card with up to 3 link buttons plus Claim. Empty, locked and retired codes still show the buttons, with "Claim empty". IDs are random 128-bit values, and serials appear only in admin.
- API: `POST /api/qrclaim {action}` (Vercel function, `server/`). Storage is Upstash Redis with keys prefixed `qrclaim:`.
- No codes are pre-generated. Cap creates and names each one (name, folder, token GEAR/CAPH/allowlisted address, amount, unlock window, wallet claims/day, paper/digital, Basename-only, 3 links).
- Rules: once per wallet per code, a daily per-wallet cap, and a random unlock up to 24 h after each refill (locked looks empty). Basename-only is on for digital and off for paper by default. Claimer pays gas.
- Alerts (dashboard only): instant claim (<60 s after unlock), repeat wallet (5 codes/day), daily cap hit, failed burst. Each alert has one-tap "Move to Bot grab". The audit log records logins, views, prints, moves and rule changes.

### Contract: `contracts/src/QRClaimContract.sol` (NOT deployed)
Constructor: `QRClaimContract(address owner, address signer, address[] tokens)`. `teamNft` defaults to CAPs Mind `0x00635CA44339C7c194eF5bc87Bf2cd6df04a666D`, and the owner can change it with `setTeamNft`.
Permissions: **owner, refiller or a team NFT holder** can call only `refill` (assigns unassigned float already in the contract to slots, so it can never exceed it) and `retire` (the slot balance returns to unassigned float). **There is no pull-from-vault function.** Tokens enter only by plain transfers: any wallet, or a vault operator calling the vault to send to this contract. **Owner only:** `withdraw`, `rescueToken`, `setPaused`, `setTokenAllowed`, `setSigner`, `setRefiller`, `setTeamNft`, `setOwner`. No team or refiller path moves tokens out of the contract.
- owner = `0xD8382719b8fF90eE3Dd521B9d7c5dc23E8e4EAca` (Cap's Ledger)
- signer = address of the `CLAIM_SIGNER_KEY` wallet (a fresh key used only for this; it can only authorize claims)
- tokens = `[0x5880cD05605A549f1DAb01a53ca61Ee559244bD1 (GEAR, 6 dec), 0x1d1bcd1459259429accde23e24e1782f83e97ba3 (CAPH, 18 dec)]`

Tests: `cd contracts && forge install foundry-rs/forge-std --no-git && forge test` (8 passing). The server's EIP-712 digest is checked against the contract encoding in `server/eip712.test.ts`.

Deploy (Bankr), then Ledger approvals (the Ledger only signs; it never sends tokens):
1. Deploy with the args above on Base and verify on BaseScan. Note the deploy block.
2. Vault funding is vault-side only. Do **not** make the QR Claim contract a vault operator or game. Whoever is already approved on the vault sends to the contract:
   - GearVault: an authorized operator (the Ledger itself, or an operator wallet the Ledger approved with `authorizeOperator`) calls `GearVault.dispense(QRClaimContract, amount)`. Limit: 50 GEAR per call, 10k per day.
   - CAPHVault `0xc7d5a9fed7f1b2d00ab404aa4f867df131ef4ba4`: an approved game wallet (set by the Ledger with `setGame(wallet, dailyCap, maxPerPayout)`) calls `payout(QRClaimContract, amount, uniqueRef)`.
   - Or any wallet transfers GEAR/CAPH straight to the contract.
3. Optional: the Ledger calls `setRefiller(<hot key>)`. That key can only refill and retire slots.
4. Refill from admin: the owner, refiller or a CAPs Mind holder approves `refill(keys, token, amounts)` from their own wallet, using unassigned tokens already in the contract.
5. Set Vercel env (below) and redeploy. The app leaves demo mode once `QRCLAIM_CONTRACT` is set.

### Vercel env
| Var | Server/Client | Notes |
|---|---|---|
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL`/`KV_REST_API_TOKEN`) | server | required for persistent data |
| `QRCLAIM_SESSION_SECRET` | server | random 32+ chars (required in production) |
| `CLAIM_SIGNER_KEY` | server only | 0x private key of the signer; **never** VITE_-prefixed |
| `QRCLAIM_CONTRACT` | server | deployed QRClaimContract address (unset = demo) |
| `QRCLAIM_FROM_BLOCK` | server | deploy block (for duplicate-claim log checks) |
| `BASE_RPC_URL`, `MAINNET_RPC_URL` | server | optional dedicated RPCs (Basename lookup uses mainnet ENS) |

Limitations: custom (non-GEAR/CAPH) token addresses are assumed to have 18 decimals for now. Auth is prepared right after a wallet connects, so the Claim tap opens the wallet immediately, and that counts toward the wallet's daily cap.

## Dev
`npm i && npm run dev`, `npm test` (QR decode tests with ZXing + jsQR, QR Claim server tests), `npm run build`.

## Bulk refill + auto-refill
- **Bulk refill:** select codes (or "Select all"), tap Refill, then approve once. The deployed contract's `refill(bytes32[] keys, address token, uint128[] amounts)` is already a batch and callable by the owner, the refiller or CAPs Mind holders. It refills only from the unassigned pool, and the server sends top-ups only, so slots never overfill. Mixed tokens produce one `refill` per token, sent as a single `wallet_sendCalls` (EIP-5792) batch, with a fallback of one tx per token.
- **Auto-refill:** per code, an interval of off, 1/5/15 min, 1 h, 6 h or 1 day. Owner and teammates can set it. A cron calls `GET /api/qrclaim-cron` with `Authorization: Bearer $CRON_SECRET`. Each run refills only due, active codes whose onchain slot is empty and that aren't in Bot grab. It skips everything if the contract is paused or the refill wallet isn't the onchain `refiller`, keeps `AUTO_REFILL_MIN_POOL` tokens in reserve, and raises a `pool_low` alert when the pool runs short. Each due code also gets a new random unlock time inside its window.
- Setup:
  1. Make a fresh wallet. Put its private key in Vercel as `REFILL_WALLET_KEY` (server only) and send it about 0.002 ETH on Base for gas (a refill tx costs well under $0.01).
  2. Ledger tx on `0x0f7b4359dc04bad4ec262a7fb25f675f31424fb9`: `setRefiller(<refill wallet address>)`. That wallet can only refill and retire.
  3. Vercel env: `CRON_SECRET` (random), optional `AUTO_REFILL_MIN_POOL` (whole tokens kept in reserve).
  4. Schedule. Vercel Hobby crons run at most once per day, so use **Upstash QStash**: create a schedule `* * * * *` to `https://payup.gearup.wtf/api/qrclaim-cron` with header `Upstash-Forward-Authorization: Bearer <CRON_SECRET>`. On Vercel Pro, a `vercel.json` cron at `* * * * *` on the same path works too.
  5. Check: POST `{"action":"health"}` to `/api/qrclaim` shows `refillWallet` (address) and `cronSecret: true`.
