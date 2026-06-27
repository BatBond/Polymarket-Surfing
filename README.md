# Polymarket Surfing — FABLE ELITE v6.0

Autonomous quantitative trading system for **Kalshi** (US-legal) and **Polymarket** (non-US only).

---

## ⚠️ Region notice — read first

| Platform   | US residents | Non-US residents |
|------------|--------------|------------------|
| **Kalshi** | ✅ Fully supported (CFTC-registered DCM) | ✅ Supported |
| **Polymarket** | ❌ Blocked (CFTC 2022 settlement — Polymarket geofences the US and bans US persons in its ToS) | ✅ Supported |

If you are in the US, **use Kalshi only**. Trying to reach Polymarket from the US via VPN violates Polymarket's terms and can get your funds frozen; this repo will not help you do that. The Polymarket code paths are kept in place so the same dashboard works for users in supported regions.

---

## What's in this repo

```
.
├── index.html           Dashboard UI (Tailwind + vanilla JS)
├── package.json         Declares @polymarket/clob-client + ethers
├── vercel.json          Tells Vercel: no framework, no build step
├── .gitignore
├── .env.example         Template for all API keys (DO NOT commit the real .env)
├── api/
│   ├── proxy.js         Public market data (read-only, no keys)
│   ├── order.js         Authenticated order placement  ← $30–50 guardrail lives here
│   ├── balance.js       Authenticated balance fetch
│   └── keys.js          Polymarket L2 HMAC + Kalshi RSA signing helpers
└── README.md
```

---

## Deploy to Vercel

1. Push this folder to a GitHub repo.
2. Import the repo at <https://vercel.com/new>.
3. **Framework Preset** → *Other*.
4. Leave **Build Command**, **Output Directory**, and **Install Command** empty (Vercel auto-installs from `package.json`).
5. Click **Deploy**.

Vercel will install `@polymarket/clob-client` and `ethers` from `package.json` automatically — these are needed server-side for Polymarket EIP-712 order signing.

---

## Kalshi setup (US residents start here)

1. Create an account at <https://kalshi.com> and complete KYC (SSN + ID). This usually takes under an hour.
2. Generate an RSA keypair locally:
   ```bash
   openssl genrsa -out kalshi_private.pem 2048
   openssl rsa -in kalshi_private.pem -pubout -out kalshi_public.pem
   ```
3. In your Kalshi dashboard, go to **Profile → API Keys → Add Key**, upload `kalshi_public.pem`, and copy the **Key ID** it returns.
4. In your Vercel project, go to **Settings → Environment Variables** and add:
   - `KALSHI_KEY_ID` — the Key ID from step 3
   - `KALSHI_PRIVATE_KEY_PEM` — full contents of `kalshi_private.pem` (paste as one string, you can keep the `\n` newlines)
5. Redeploy. The dashboard's `/api/balance?platform=kalshi` and `/api/order` (with `platform: "kalshi"`) routes are now live.

**Funding Kalshi:** Kalshi takes USD deposits via bank transfer only — no crypto. Trades settle in USD. The $30–50 cap in this repo is on per-order notional; your Kalshi account balance is separate. Fund the account with however much you want — the per-order guardrail still applies.

---

## Polymarket setup (non-US residents only)

Polymarket order placement requires **two** signing layers:

1. **L2 HMAC headers** — authenticate the API call (handled in `api/keys.js`).
2. **EIP-712 order signature** — binds the order to your EVM wallet so the CLOB can verify it (produced by `@polymarket/clob-client`).

To get your L2 credentials:

```js
// One-time setup script — run locally with: node scripts/gen-poly-creds.js
import { ClobClient } from '@polymarket/clob-client';
import { ethers } from 'ethers';

const wallet = new ethers.Wallet(process.env.POLY_PRIVATE_KEY);
const client = new ClobClient('https://clob.polymarket.com', 137, wallet);
const creds = await client.createOrDeriveApiCreds();
console.log(creds); // { apiKey, secret, passphrase }
```

Then set these env vars in Vercel:

- `POLY_API_KEY`
- `POLY_SECRET`
- `POLY_PASSPHRASE`
- `POLY_ADDRESS` — your wallet address (0x…)
- `POLY_PRIVATE_KEY` — your EVM private key (server-only, never sent to the browser)

**Funding Polymarket:** Deposit USDC on Polygon to your wallet address. Trades settle in USDC.

---

## The $30–$50 per-order guardrail

Enforced in `api/keys.js` → `enforceCap(price, size)` and called at the top of `api/order.js`. The check runs **before** any network call, and the constants (`MIN_POSITION_USD = 30`, `MAX_POSITION_USD = 50`) live server-side — there are no env vars or query params to override them from the browser.

- Orders with notional `< $30` are rejected (prevents dust / test orders)
- Orders with notional `> $50` are rejected (hard cap)
- The dashboard's "Max Position ($)" input is clamped to `min=30 max=50` and defaults to `$30`

If you want a different range, edit both constants in `api/keys.js` and redeploy. Don't expose them as env vars; if you do, anyone with browser access can change them client-side.

## Starting portfolio

The dashboard ships with **$0** starting paper balance — no fake $50K seed, no pre-loaded positions, no trade history. Press **Start Bot** and it begins cleanly from zero. The displayed Portfolio value reflects realized P&L as the paper bot opens and closes positions.

For live mode, your real wallet balance is fetched via `/api/balance?platform=kalshi` once your Kalshi keys are set.

---

## API routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/proxy?platform=…&endpoint=…` | GET | none | Public market data (markets, prices, order books) |
| `/api/balance?platform=kalshi\|polymarket` | GET | L2 / RSA | Wallet balance |
| `/api/order` | POST | L2 / RSA | Place a limit order (subject to $30–50 guardrail) |

### Place an order (example)

```bash
# ✅ Allowed — notional $35.00 is inside the $30–50 range
curl -X POST https://your-app.vercel.app/api/order \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "kalshi",
    "market": "KXBTC-26DEC31-B500000",
    "side": "yes",
    "price": 35,
    "size": 1
  }'

# ❌ Rejected — notional $25.00 is below the $30 minimum
curl -X POST https://your-app.vercel.app/api/order \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "kalshi",
    "market": "KXBTC-26DEC31-B500000",
    "side": "yes",
    "price": 25,
    "size": 1
  }'

# ❌ Rejected — notional $60.00 is above the $50 maximum
curl -X POST https://your-app.vercel.app/api/order \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "kalshi",
    "market": "KXBTC-26DEC31-B500000",
    "side": "yes",
    "price": 60,
    "size": 1
  }'
```

---

## Why is Polymarket not working from the US?

A few things people commonly try, and why none of them are sustainable:

1. **VPN to a non-US IP** — Polymarket logs IP at signup and at every CLOB auth; their ToS bans US persons regardless of IP. Detected accounts are frozen and USDC clawed back. Not worth it.
2. **Using a non-US friend's wallet** — that's their account, not yours; they own the funds legally.
3. **Self-hosting the proxy on a non-US server** — same problem; Polymarket still sees the wallet's KYC/registration region.

The repo's Polymarket code is correct and will work the moment you're physically and legally in a supported region. For US trading, Kalshi is the answer.

---

## License

MIT
