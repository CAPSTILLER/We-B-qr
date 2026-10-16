# We B qr: scan-to-pay + Paper Gears

## Routes
- `/` Studio: Link/Text or Scan-to-Pay QR (USDC / GEAR / ETH on Base). Gear/dot/rounded/square modules, 12 gear-color gradients, GEAR/CAPH/custom center logo, CTA frame, wobble preview, PNG/SVG download. Error correction is always H. Low-contrast warning under 4:1.
- `/pay?to=<addr|name.base.eth>&amt=5&t=USDC&n=note`: one-tap pay page (EIP-6963 injected wallets + Base Account). Switches to Base, sends transfer, shows BaseScan link.
- `/claim?id=<n>&s=<64 hex>&a=<amount>`: Paper Gear claim. **Demo mode** until `VITE_VOUCHER_CONTRACT` is set at build time.
- `/paper`: printable gear-shaped card sheets. PAY cards (fixed amount pay-to-Cap) and CLAIM cards (fresh secret per card + hash CSV).

QR modes: "Pay page" works with any phone camera. "Wallet app (EIP-681)" encodes
`ethereum:<token>@8453/transfer?address=<to>&uint256=<raw>` for in-wallet scanners (needs a 0x address).

## Paper Gear vouchers (contracts/, NOT deployed)
`PaperGearVouchers.sol`: owner registers `keccak256(secret)` + amount per card id and funds GEAR in the same tx (approve first).
First wallet to call `claim(id, secret, to)` gets it. `revoke(ids)` returns unclaimed GEAR to the owner.
Tests: `cd contracts && forge install foundry-rs/forge-std --no-git && forge test` (5 passing).

Deploy flow:
1. Deploy `PaperGearVouchers(GEAR=0x5880cD05605A549f1DAb01a53ca61Ee559244bD1, owner=Cap)`.
2. On `/paper`, make CLAIM cards, download the hash CSV, then print. Secrets exist only on the printed cards.
3. Owner: `GEAR.approve(vouchers, total)`, then `register(ids, hashes, amounts)` (amounts use 6 decimals).
4. Set Vercel env `VITE_VOUCHER_CONTRACT=<address>` and redeploy.

Caveats: a claim tx reveals the secret. Base's sequencer has no public mempool, so front-running is unlikely but possible in theory. Keep card values modest.
Anyone holding a card (or a photo of it) can claim it, so treat cards like cash. Revoke lost batches.

## Dev
`npm i && npm run dev`, `npm test` (42 QR decode tests with ZXing + jsQR), `npm run build`.
