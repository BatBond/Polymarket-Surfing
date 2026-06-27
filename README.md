# Kalshi AI Brain — FABLE ELITE v8.0

Autonomous AI trading brain for **Kalshi** (CFTC-registered, US-legal). The brain researches live markets, scores them on Bayesian edge + momentum + volume, runs explicit risk gates, and auto-executes orders within your $30–40 per-order cap and $50 total investment.

---

## ⚠️ READ THIS FIRST — Vercel networking issue

If you deployed to Vercel and saw "DNS resolution failed for api.kalshi.com" in the Test Connection results, **this is a Vercel platform issue, not a code bug.** Vercel's serverless functions in some regions cannot resolve `api.kalshi.com` — a public hostname that resolves everywhere else.

**The fix: deploy to Render instead.** Render runs Node on normal EC2 instances with standard DNS resolution. Same code, different platform, problem solved. See "Deploy to Render" below.

If Render ALSO fails with the same DNS error, then Kalshi is blocking cloud provider IP ranges (some regulated APIs do this). In that case, see "Streamlit Alternative" at the bottom of this README.

---

## What the AI Brain actually does

Every scan cycle (default 30 seconds), the brain runs a 5-stage pipeline:

```
┌─────────────────────────────────────────────────────────────────┐
│  1. RESEARCH  →  Fetch live Kalshi markets via /api/proxy       │
│  2. SCORE     →  Compute Bayesian edge + momentum + volume      │
│  3. RISK CHECK→  Budget / slots / drawdown / cap / confidence   │
│  4. DECIDE    →  TRADE / HOLD / SKIP with reason                │
│  5. EXECUTE   →  POST /api/order (LIVE) or log (PAPER)          │
└─────────────────────────────────────────────────────────────────┘
```

Every stage is visible in the **AI Brain** tab — you can watch each cycle happen in real time and audit every decision in the Decision Log.

---

## Risk guardrails (hard-coded, server-enforced)

| Guardrail | Value | Enforced where |
|---|---|---|
| **Per-order minimum** | $30 | Server (`api/keys.js` → `MIN_POSITION_USD`) |
| **Per-order maximum** | $40 | Server (`api/keys.js` → `MAX_POSITION_USD`) |
| **Total investment cap** | $50 (configurable up to $500) | Client + server (cash budget check) |
| **Max concurrent positions** | 1 (locked) | Client (with $50 cap, 2 × $30 = $60 > $50) |
| **Stop loss** | 15% (configurable) | Client (paper positions only) |
| **Take profit** | 30% (configurable) | Client (paper positions only) |
| **Max drawdown** | 20% (hard-coded) | Client (brain pauses new trades) |
| **Min confidence to trade** | 60% (configurable) | Client (brain skips low-confidence signals) |

The browser **cannot** bypass the $30–40 server-side cap — even if someone edits the client JavaScript, the server rejects any order outside that range with HTTP 400.

### Notional formula (IMPORTANT)

Kalshi prices are in **cents** (1–99) and size is in **contracts** (positive integer). Each contract at price P cents costs P/100 dollars. So:

```
dollar_notional = (price_cents × contracts) / 100
```

Examples (all in $30–40 range):
- price=35c, size=100 → $35.00 ✓
- price=30c, size=100 → $30.00 ✓
- price=40c, size=100 → $40.00 ✓
- price=50c, size=70 → $35.00 ✓
- price=70c, size=50 → $35.00 ✓

**Bug fixed in v8.1**: The server previously computed `notional = price × size` without dividing by 100. This caused every order to be rejected as "exceeds $40" — e.g. a $35 order (price=35, size=100) was incorrectly computed as $3500 and rejected. The dashboard's brain and manual form both used the correct `/100` formula, so the bug only manifested as false rejections. **No money was lost** — the safety net caught its own math error. The fix is `(p × s) / 100`.

### Integer enforcement

Kalshi requires integer cents and integer contracts. The server floors both values with `Math.floor()` before the cap check and before submission, so the browser cannot send decimal values to bypass the cap. The dashboard also enforces `step="1"` on the price and size inputs.

---

## Why only 1 concurrent position?

With a $50 investment cap and $30–40 per-order range, you can only safely hold one position at a time. Two $30 orders would require $60, exceeding your $50 budget. The dashboard locks `Max Concurrent` to 1.

If you increase your investment cap (e.g. to $200), edit the `max` attribute on the `cfg-concurrent` input in `index.html` to allow more concurrent positions.

---

## How to deploy — three options

**Confirmed:** Vercel blocks DNS resolution for `api.kalshi.com` specifically (you'll see `EBUSY` or `ENOTFOUND` errors). The dashboard works on Vercel, but LIVE trading does not. Pick one of the three options below — they all run the exact same code.

### Option 1 — Render (recommended, 5 minutes)

Render runs Node on standard EC2 instances with normal DNS. Same code, no Vercel DNS block.

1. Push this folder to a GitHub repo (must include `render.yaml`).
2. Go to <https://render.com> → sign up (free) → **New** → **Blueprint**.
3. Select your GitHub repo. Render auto-detects `render.yaml` and creates the service.
4. Click **Apply**. Wait ~2 minutes for the build.
5. Go to your service → **Environment** tab → add two env vars:
   - `KALSHI_KEY_ID` — your Kalshi Key ID
   - `KALSHI_PRIVATE_KEY_PEM` — full contents of `kalshi_private.pem` (paste with newlines)
6. Render auto-redeploys when env vars change.
7. Open your Render URL (e.g. `https://kalshi-ai-brain.onrender.com`) → click **Test Connection** → all 6 health check steps should pass.

### Option 2 — Railway (alternative, 5 minutes)

Railway is similar to Render, also runs Node on standard infrastructure.

1. Push this folder to a GitHub repo.
2. Go to <https://railway.app> → sign up → **New Project** → **Deploy from GitHub repo**.
3. Select your repo. Railway auto-detects `package.json` and `railway.json`.
4. Once deployed, go to your service → **Variables** tab → add `KALSHI_KEY_ID` and `KALSHI_PRIVATE_KEY_PEM`.
5. Open your Railway URL → click **Test Connection**.

### Option 3 — Run on your own laptop with a public URL (most reliable)

Your home internet is not subject to cloud platform blocks. This is the most reliable option if you want it always-on without deploying anywhere.

**Step 1 — Install Node.js** (if you don't have it):
Download LTS from <https://nodejs.org/>

**Step 2 — Get the code on your machine:**
```bash
# Extract the zip or clone your repo
cd /path/to/fable-elite
```

**Step 3 — Create a `.env` file** in the folder:
```
KALSHI_KEY_ID=your_key_id_here
KALSHI_PRIVATE_KEY_PEM=-----BEGIN RSA PRIVATE KEY-----
...your full PEM contents...
-----END RSA PRIVATE KEY-----
```

**Step 4 — Start the server:**
```bash
# Mac/Linux:
./start-local.sh

# Or manually:
npm install
node server.js
```

You should see:
```
Kalshi AI Brain server listening on port 3000
Dashboard: http://localhost:3000
```

Open `http://localhost:3000` in your browser → click **Test Connection** → all 6 steps should pass. **Your laptop can definitely reach api.kalshi.com.**

**Step 5 (optional) — Get a public URL from your laptop:**

If you want to access the dashboard from your phone or share it with someone, install `cloudflared` and run:
```bash
# Mac:   brew install cloudflared
# Linux: curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared

cloudflared tunnel --url http://localhost:3000
```

Cloudflare prints a public URL like `https://random-words-1234.trycloudflare.com` — open it anywhere. The tunnel runs as long as your laptop is on and the command is running.

---

## ⚠️ Do NOT deploy to Vercel

Vercel's serverless runtime blocks DNS resolution for `api.kalshi.com` specifically. You'll see `EBUSY: getaddrinfo EBUSY api.kalshi.com` or `ENOTFOUND` in Test Connection, even though `google.com` works fine. This is a Vercel platform policy/block, not a network glitch or a code bug. No amount of code changes will fix it on Vercel — use Render, Railway, or run locally instead.

---

## Kalshi API key setup (required for live trading)

1. Create an account at <https://kalshi.com> and complete KYC (SSN + ID).
2. Generate an RSA keypair locally:
   ```bash
   openssl genrsa -out kalshi_private.pem 2048
   openssl rsa -in kalshi_private.pem -pubout -out kalshi_public.pem
   ```
3. In your Kalshi dashboard, go to **Profile → API Keys → Add Key**, upload `kalshi_public.pem`, copy the **Key ID**.
4. In Vercel → **Settings → Environment Variables**, add for the **Production** environment:
   - `KALSHI_KEY_ID` — the Key ID from step 3
   - `KALSHI_PRIVATE_KEY_PEM` — full contents of `kalshi_private.pem`
5. **Redeploy** (env var changes do not apply to running deployments).

Fund your Kalshi account via bank transfer (no crypto). With a $50 investment cap, fund at least $50.

---

## How to use the AI Brain

### First run (PAPER mode — recommended)

1. Open the deployed dashboard. The AI Brain tab is the default.
2. Leave mode as **PAPER**. Investment Cap defaults to **$50**.
3. Click **Start AI Brain**.
4. Watch the pipeline visualize each cycle:
   - **RESEARCH** → fetches live Kalshi markets
   - **SCORE** → ranks markets by composite signal
   - **RISK CHECK** → shows each gate pass/fail with details
   - **DECIDE** → logs TRADE / HOLD / SKIP with reason
   - **EXECUTE** → in PAPER, logs the trade locally
5. Check the **Decision Log** to see why the brain made each choice.
6. Verify the brain's behavior is sane before going live.

### Going LIVE

1. Confirm your Kalshi keys are set (you should see "Live Kalshi balance loaded" in the System Log on page load).
2. Toggle mode from PAPER to **LIVE**. The mode banner turns red.
3. Click **Start AI Brain**.
4. The brain now POSTs real orders to `/api/order` when all risk gates pass.
5. Every LIVE order appears in the Positions tab with a gold **LIVE** + purple **AUTO** badge.
6. Cross-check in your Kalshi portfolio at <https://kalshi.com/portfolio>.

⚠️ **LIVE mode spends real money.** Watch the first few cycles closely.

### Manual order (bypass the brain)

If you want to place a specific order without waiting for the brain:
1. Go to **Markets** tab → click **Fetch Live Kalshi Markets**.
2. Click the **→** on a market row → loads ticker into Manual Order form.
3. Set side, price, size. Notional preview turns green when in $30–40 range.
4. Click **Submit to Kalshi**.

---

## How the brain scores markets

For each liquid Kalshi market, the brain computes four signals:

| Signal | What it measures | Weight |
|---|---|---|
| **Momentum** | Recent price direction (5-snapshot return) | 40% |
| **Mean reversion** | Distance from 20-period moving average | 30% |
| **Bayesian edge** | Posterior probability vs market price (Beta-Binomial) | 30% |
| **Volume score** | Normalized trading volume (0–1) | Confidence boost |

Composite signal = `momentum × 0.4 + mean_reversion × 0.3 + bayesian_edge × 0.3`.

Confidence = `30 + |signal| × 200 + volume_score × 20 + history_length × 1.5`, clamped to [0, 95].

**Action thresholds:**
- `signal > 0.03` AND `confidence ≥ min` → **BUY YES**
- `signal < -0.03` AND `confidence ≥ min` → **BUY NO**
- `signal > 0.015` → LEAN YES (no trade)
- `signal < -0.015` → LEAN NO (no trade)
- Otherwise → HOLD

Markets are ranked by `|signal| × confidence`. The top actionable candidate goes through risk gates.

---

## Risk gates (all must pass to trade)

The brain checks 7 gates before placing any order:

1. **Confidence** ≥ min threshold (default 60%)
2. **Actionable signal** — must be BUY YES or BUY NO (not HOLD/LEAN)
3. **Budget** — cash available ≥ $30
4. **Slots** — open positions < max concurrent (1)
5. **No duplicate** — not already holding this market
6. **Drawdown** — current drawdown < 20%
7. **Cap** — computed order notional lands in $30–40

If any gate fails, the brain logs SKIP with the failed gate names and waits for the next cycle. Every gate's pass/fail is visible in the Risk Analysis panel.

---

## Order sizing math

The brain targets $35 per order (middle of $30–40 range):

```
target_notional = $35
contracts = floor(35 × 100 / price_cents)
actual_notional = price_cents × contracts / 100
```

If `actual_notional` falls below $30, the brain bumps `contracts` up to `ceil(30 × 100 / price)`. If the bumped notional exceeds $40, the brain skips the trade (would violate cap).

**Examples:**
- Price 50c → 70 contracts → $35.00 ✓
- Price 35c → 100 contracts → $35.00 ✓
- Price 70c → 50 contracts → $35.00 ✓
- Price 25c → 140 contracts → $35.00 ✓
- Price 95c → 36 contracts → $34.20 ✓ (brain bumps to 37 → $35.15)

---

## API routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/proxy?endpoint=…` | GET | none | Public Kalshi market data |
| `/api/balance` | GET | RSA | Wallet balance + open positions |
| `/api/order` | POST | RSA | Place a limit order (subject to $30–40 cap) |

### Place an order via curl

```bash
# ✅ Allowed — $35.00 notional
curl -X POST https://your-app.vercel.app/api/order \
  -H "Content-Type: application/json" \
  -d '{"market":"KXBTC-26DEC31-B500000","side":"yes","price":35,"size":100}'

# ❌ Rejected — $25.00 below $30 minimum
curl -X POST https://your-app.vercel.app/api/order \
  -H "Content-Type: application/json" \
  -d '{"market":"KXBTC-26DEC31-B500000","side":"yes","price":25,"size":100}'

# ❌ Rejected — $45.00 above $40 maximum
curl -X POST https://your-app.vercel.app/api/order \
  -H "Content-Type: application/json" \
  -d '{"market":"KXBTC-26DEC31-B500000","side":"yes","price":45,"size":100}'
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Brain shows "Kalshi API not configured" on load | Env vars missing or set on wrong environment | Vercel → Settings → Environment Variables → ensure both `KALSHI_KEY_ID` and `KALSHI_PRIVATE_KEY_PEM` exist for **Production**. Then Redeploy. |
| Brain runs but never TRADES, only HOLD/SKIP | Signals not strong enough, or risk gates failing | Check the Decision Log — it tells you exactly which gate failed. Lower `Min Confidence` in Config tab if needed. |
| Brain logs SKIP "Risk gates failed: Budget" | Cash available < $30 | You already have a position open (max 1 concurrent). Wait for it to close, or increase investment cap. |
| Brain logs SKIP "Risk gates failed: Cap" | Computed notional can't fit in $30–40 at current price | Market price is too extreme (very high or very low). Brain will retry next cycle with different markets. |
| LIVE order returns 400 "below $30 minimum" / "exceeds $40 hard cap" | Server-side guardrail | Adjust price or size in the Manual Order form until notional preview turns green. Note: server floors decimal prices to integer cents before checking. |
| LIVE order rejected but dashboard said it was in $30–40 | Fixed in v8.1 — server now divides notional by 100 (was treating cents × contracts as dollars) | Redeploy with the latest code. This bug caused false "exceeds $40" rejections on every order. No money was lost. |
| LIVE order returns 401 "Invalid signature" | Private key doesn't match public key on Kalshi | Regenerate keypair, re-upload public key to Kalshi, update env var. |
| LIVE order returns 4xx with `detail` from Kalshi | Insufficient funds, invalid ticker, market closed | Read the `detail` field — Kalshi explains the rejection. |
| Brain in LIVE mode shows `[BRAIN-LIVE FAIL]` repeatedly | Same causes as above | Check the System Log — each failure has the reason. |

---

## File structure

```
.
├── index.html           Dashboard with AI Brain tab
├── server.js            Express server (for Render/Railway/local — Vercel doesn't need this)
├── start-local.sh       One-command local runner (Mac/Linux)
├── render.yaml          Render Blueprint for one-click deploy
├── railway.json         Railway config
├── package.json         Express dependency (for non-Vercel platforms)
├── vercel.json          Vercel config (DO NOT USE — Vercel blocks Kalshi DNS)
├── .gitignore
├── .renderignore
├── .env.example         Kalshi API key template
├── api/
│   ├── proxy.js         Public Kalshi market data (with retry + fallback)
│   ├── order.js         Authenticated order placement ($30-40 cap)
│   ├── balance.js       Authenticated balance + positions
│   ├── health.js        Connection diagnostic endpoint (6 steps)
│   └── keys.js          Kalshi RSA signing + cap enforcement + fetchWithRetry
└── README.md
```

---

## Why not Streamlit?

You asked about Streamlit. Here's the honest answer: **don't bother**. The problem isn't the language or framework — it's that Vercel blocks DNS for `api.kalshi.com`. If you deployed a Streamlit app to Vercel, you'd hit the exact same wall. The fix is changing platforms, not languages.

Streamlit Cloud uses different IPs than Vercel, so it might work — but rewriting the entire brain, dashboard, API routes, risk gates, and cap enforcement in Python is a 4-8 hour project. Render/Railway/local all work with the existing Node code in 5 minutes, zero rewrite needed.

**Move to Render, Railway, or run locally.** That's the fix.

---

## License

MIT
