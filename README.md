# Kalshi Surfing — FABLE ELITE v7.0

Quantitative trading dashboard for **Kalshi** (CFTC-registered, US-legal). Polymarket has been removed entirely — this build is Kalshi-only.

---

## ⚠️ Read this first — why your trades weren't showing up on Kalshi

If you ran the previous version, pressed "Start Bot", and saw trades appear in the dashboard but **nothing showed up in your Kalshi account**, the reason is:

1. **The previous bot was in PAPER mode by default** — it simulated trades locally in your browser's memory and never made any network call to Kalshi. The "trades" you saw were animations.
2. **Even in LIVE mode, the previous version never called `/api/order`** — the bot's trade loop only updated local state. It was a UI demo, not a real trading client.
3. **Your Kalshi API keys were probably not set** — without `KALSHI_KEY_ID` and `KALSHI_PRIVATE_KEY_PEM` in Vercel env vars, the `/api/order` route returns a 500 error before any order can be placed.

**This version fixes all three:**
- The bot now actually calls `POST /api/order` when in LIVE mode
- The "Manual Order" tab has a **Submit to Kalshi** button that fires a real order immediately
- The dashboard fetches your real Kalshi balance on page load (and shows a clear error if keys are missing)

---

## What's in this repo

```
.
├── index.html           Dashboard UI (Kalshi-only, real order submission)
├── package.json         No runtime deps — Vercel builds the API natively
├── vercel.json          Tells Vercel: no framework, no build step
├── .gitignore
├── .env.example         Template for Kalshi API keys
├── api/
│   ├── proxy.js         Public Kalshi market data (no auth needed)
│   ├── order.js         Authenticated order placement  ← $30-50 guardrail
│   ├── balance.js       Authenticated balance + positions fetch
│   └── keys.js          Kalshi RSA-SHA256 signing + cap enforcement
└── README.md
```

---

## Deploy to Vercel

1. Push this folder to a GitHub repo.
2. Import the repo at <https://vercel.com/new>.
3. **Framework Preset** → *Other*.
4. Leave **Build Command**, **Output Directory**, and **Install Command** empty.
5. Click **Deploy**.

No `npm install` is needed — the API routes use only Node's built-in `crypto` module.

---

## Kalshi API key setup (required for real trading)

1. Create an account at <https://kalshi.com> and complete KYC (SSN + ID). Usually takes under an hour.
2. Generate an RSA keypair locally:
   ```bash
   openssl genrsa -out kalshi_private.pem 2048
   openssl rsa -in kalshi_private.pem -pubout -out kalshi_public.pem
   ```
3. In your Kalshi dashboard, go to **Profile → API Keys → Add Key**, upload `kalshi_public.pem`, and copy the **Key ID** it returns.
4. In your Vercel project, go to **Settings → Environment Variables** and add:
   - `KALSHI_KEY_ID` — the Key ID from step 3
   - `KALSHI_PRIVATE_KEY_PEM` — full contents of `kalshi_private.pem` (paste as one string, you can keep the `\n` newlines)
5. **Redeploy** (Vercel → Deployments → click the menu on the latest → Redeploy). Env var changes do NOT apply to already-running deployments.

**Funding Kalshi:** Bank transfer only (no crypto). The $30–50 cap is on per-order notional — your account balance is separate. Fund with however much you want; each order is still capped.

---

## How to verify your keys are working

After redeploying with the env vars set:

1. Open your deployed dashboard.
2. Look at the **System Log** (bottom right of the Manual Order tab, or any tab's log section).
3. On page load, you should see one of:
   - ✅ `Live Kalshi balance loaded on startup: $X.XX` — keys work, balance fetched
   - ⚠️ `Kalshi API reachable but account balance is $0 — fund your account` — keys work, account empty
   - ❌ `Kalshi API not configured. Set KALSHI_KEY_ID and KALSHI_PRIVATE_KEY_PEM...` — env vars missing or wrong
4. Click **"Fetch Live Kalshi Markets"** in the Markets tab — you should see real market tickers populate the table.

If you see the ❌ message, your env vars are either not set, set on the wrong environment (Production vs Preview), or you didn't redeploy after setting them.

---

## How to actually place a real trade

### Option A — Manual order (recommended for your first trade)

1. Open the **Markets** tab → click **Fetch Live Kalshi Markets**.
2. Find a market you want to trade → click the **→** button on its row. This loads the ticker into the Manual Order form and switches you to that tab.
3. Pick **YES** or **NO**, set the **Price** (in cents, 1–99), and the **Size** (number of contracts).
4. The **Order Notional** preview updates live. It must land between **$30 and $50** — the box turns green when it's in range, red when it's not.
5. Click **Submit to Kalshi**.
6. Watch the **Execution Log** on the right:
   - `ACCEPTED` → order went through, check your Kalshi dashboard to confirm
   - `REJECTED: <reason>` → the server's guardrail blocked it OR Kalshi rejected it (insufficient funds, invalid ticker, market closed, etc.)
7. Cross-check in your Kalshi account at <https://kalshi.com/portfolio> — the order should appear within a few seconds.

### Option B — Bot in LIVE mode

1. In the **Bot Control** tab, toggle from **PAPER** to **LIVE**. The mode banner at the top turns red and warns you.
2. Click **Start Bot**.
3. Every 4 seconds, if the bot's signal logic finds a trade opportunity, it will POST a real order to `/api/order`. Each order is bounded to $30–50 by the server.
4. Live orders appear in the Positions tab with a gold **LIVE** badge and **SUBMITTED** status.
5. Watch the System Log for `[LIVE OK]` (accepted) or `[LIVE FAIL]` (rejected) messages.

⚠️ **LIVE mode will spend real money.** Start in PAPER mode first to verify the bot's signal logic isn't doing anything crazy. When you switch to LIVE, monitor the first few orders closely.

---

## The $30–$50 per-order guardrail

Enforced in `api/keys.js` → `enforceCap(price, size)` and called at the top of `api/order.js`. The check runs **before** any network call, and the constants (`MIN_POSITION_USD = 30`, `MAX_POSITION_USD = 50`) live server-side — there are no env vars or query params to override them from the browser.

- Orders with notional `< $30` → rejected (prevents dust / test orders)
- Orders with notional `> $50` → rejected (hard cap)
- The dashboard's "Max Position ($)" input is clamped to `min=30 max=50` and defaults to `$30`

To change the range, edit both constants in `api/keys.js` and redeploy.

---

## Starting portfolio

The dashboard ships with **$0** starting balance. On page load, it tries to fetch your real Kalshi balance via `/api/balance`:

- **If keys are set and account is funded** → the Portfolio stat card shows your real Kalshi USD balance.
- **If keys are not set or fetch fails** → stays at $0, and the System Log explains what to fix.
- **In PAPER mode** → paper trades adjust the local balance; live balance is shown for reference only.
- **In LIVE mode** → real orders hit Kalshi; rebalance by clicking **Refresh Balance** to re-pull from the API.

---

## API routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/proxy?endpoint=…` | GET | none | Public Kalshi market data |
| `/api/balance` | GET | RSA | Wallet balance + open positions |
| `/api/order` | POST | RSA | Place a limit order (subject to $30–50 cap) |

### Place an order via curl

```bash
# ✅ Allowed — notional $35.00 is inside the $30–50 range
curl -X POST https://your-app.vercel.app/api/order \
  -H "Content-Type: application/json" \
  -d '{
    "market": "KXBTC-26DEC31-B500000",
    "side": "yes",
    "price": 35,
    "size": 1
  }'

# ❌ Rejected — notional $25.00 is below the $30 minimum
curl -X POST https://your-app.vercel.app/api/order \
  -H "Content-Type: application/json" \
  -d '{
    "market": "KXBTC-26DEC31-B500000",
    "side": "yes",
    "price": 25,
    "size": 1
  }'

# ❌ Rejected — notional $60.00 is above the $50 maximum
curl -X POST https://your-app.vercel.app/api/order \
  -H "Content-Type: application/json" \
  -d '{
    "market": "KXBTC-26DEC31-B500000",
    "side": "yes",
    "price": 60,
    "size": 1
  }'
```

---

## Troubleshooting — "I clicked submit but nothing happened on Kalshi"

| Symptom | Likely cause | Fix |
|---|---|---|
| Dashboard shows ❌ "Kalshi API not configured" | Env vars not set, or set on Preview but not Production | Vercel → Settings → Environment Variables → ensure both `KALSHI_KEY_ID` and `KALSHI_PRIVATE_KEY_PEM` exist for **Production** environment. Then Redeploy. |
| Order returns 500 with "Kalshi credentials not set on server" | Same as above | Same as above |
| Order returns 400 with "below the $30 minimum" or "exceeds the $50 hard cap" | Your price × size notional is outside $30–50 | Adjust price or size until the notional preview turns green |
| Order returns 4xx with `detail` from Kalshi | Insufficient funds, invalid ticker, market closed, or signature error | Read the `detail` field in the response — Kalshi tells you exactly what's wrong |
| Order returns 401 / "Invalid signature" | Your private key doesn't match the public key uploaded to Kalshi, or the key was regenerated | Regenerate keypair, re-upload public key to Kalshi, update `KALSHI_PRIVATE_KEY_PEM` env var |
| Bot in LIVE mode shows `[LIVE FAIL]` repeatedly | Same causes as above | Check the System Log — each failure has the reason |
| Bot in PAPER mode shows no trades | Signals not confident enough, or already at max concurrent positions | Lower the `Max Concurrent` value or wait — the bot only trades when its signal threshold is met |
| Dashboard loads but markets tab is empty | You haven't clicked "Fetch Live Kalshi Markets" yet | Click the button |

---

## License

MIT
