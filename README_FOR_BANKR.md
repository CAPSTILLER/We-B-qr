# We B qr: scan-to-pay + Paper Gears

## Routes
- `/` Studio: Link/Text or Scan-to-Pay QR (USDC / GEAR / ETH on Base). Gear/dot/rounded/square modules, 12 gear-color gradients, GEAR/CAPH/custom center logo, CTA frame, wobble preview, PNG/SVG download. Error correction is always H. Low-contrast warning under 4:1.
- `/pay?to=<addr|name.base.eth>&amt=5&t=USDC&n=note`: one-tap pay page (EIP-6963 injected wallets + Base Account). Switches to Base, sends transfer, shows BaseScan link.
- `/paper`: printable gear-shaped PAY card sheets.

QR modes: "Pay page" works with any phone camera. "Wallet app (EIP-681)" encodes
`ethereum:<token>@8453/transfer?address=<to>&uint256=<raw>` for in-wallet scanners (needs a 0x address).

## QR Claim system (separate section)
- `/claim-admin`: admin. The owner Ledger `0xD8382719b8fF90eE3Dd521B9d7c5dc23E8e4EAca` sets all rules. Holders of the CAPs Mind NFT (ERC-721 `0x00635ca44339c7c194ef5bc87bf2cd6df04a666d`, checked with balanceOf at sign-in) can view, print and organize only. Login is one free wallet signature (EOA or smart wallet), and the session lasts 12 h.
- `/c/<randomId>`: scan card with up to 3 link buttons plus Claim. Empty, locked and retired codes still show the buttons, with "Claim empty". IDs are random 128-bit values, and serials appear only in admin.
- API: `POST /api/qrclaim {action}` (Vercel function, `server/`). Storage is Upstash Redis with keys prefixed `qrclaim:`.
- No codes are pre-generated. Cap creates and names each one (name, folder, token GEAR/CAPH/allowlisted address, amount, unlock window, wallet claims/day, paper/digital, Basename-only, 3 links).
- Rules: once per wallet per code, a daily per-wallet cap, and a random unlock up to 24 h after each refill (locked looks empty). Basename-only is on for digital and off for paper by default. Claimer pays gas.
- Alerts (dashboard only): instant claim (<60 s after unlock), repeat wallet (5 codes/day), daily cap hit, failed burst. Each alert has one-tap "Move to Bot grab". The audit log records logins, views, prints, moves and rule changes.

### Contract: `contracts/src/QRClaimContract.sol` (NOT deployed)
Constructor: `QRClaimContract(address owner, address signer, address[] tokens)`
- owner = `0xD8382719b8fF90eE3Dd521B9d7c5dc23E8e4EAca` (Cap's Ledger)
- signer = address of the `CLAIM_SIGNER_KEY` wallet (a fresh key used only for this; it can only authorize claims)
- tokens = `[0x5880cD05605A549f1DAb01a53ca61Ee559244bD1 (GEAR, 6 dec), 0x1d1bcd1459259429accde23e24e1782f83e97ba3 (CAPH, 18 dec)]`

Tests: `cd contracts && forge install foundry-rs/forge-std --no-git && forge test` (7 passing). The server's EIP-712 digest is checked against the contract encoding in `server/eip712.test.ts`.

Deploy (Bankr), then Ledger approvals (the Ledger only signs; it never sends tokens):
1. Deploy with the args above on Base and verify on BaseScan. Note the deploy block.
2. Ledger: `setVault(GearVault, GEAR, 1)` and `setVault(CAPHVault 0xc7d5a9fed7f1b2d00ab404aa4f867df131ef4ba4, CAPH, 2)`.
3. Ledger on the vaults: `GearVault.authorizeOperator(QRClaimContract)` and `CAPHVault.setGame(QRClaimContract, dailyCap, maxPerPayout)`.
4. Optional: Ledger calls `setRefiller(<hot key>)` so bulk pulls and refills don't need the Ledger each time.
5. Fund: `pullFromVault(vault, amount)` (refiller or owner), or any wallet sends GEAR/CAPH directly. Then refill from admin, which prompts the owner wallet for `refill(keys, token, amounts)`.
6. Set Vercel env (below) and redeploy. The app leaves demo mode once `QRCLAIM_CONTRACT` is set.

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
