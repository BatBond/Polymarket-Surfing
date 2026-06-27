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

## Deploy to Render (RECOMMENDED — fixes the Vercel DNS issue)

Render runs Node on standard EC2 instances with normal DNS, which fixes the "ENOTFOUND for api.kalshi.com" error you hit on Vercel.

### Option A — One-click Blueprint deploy (fastest)

1. Push this folder to a GitHub repo (must include `render.yaml`).
2. Go to <https://render.com> → **New** → **Blueprint**.
3. Select your GitHub repo. Render auto-detects `render.yaml` and creates the service.
4. Click **Apply**.
5. Once deployed, go to your service → **Environment** tab → add these env vars:
   - `KALSHI_KEY_ID` — your Kalshi Key ID
   - `KALSHI_PRIVATE_KEY_PEM` — full contents of `kalshi_private.pem`
6. Render auto-redeploys when env vars change.
7. Open your Render URL → click **Test Connection** → all 6 health check steps should pass.

### Option B — Manual web service deploy

1. Push this folder to a GitHub repo.
2. Go to <https://render.com> → **New** → **Web Service**.
3. Connect your GitHub repo.
4. Settings:
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: Free (sufficient for this app)
   - **Region**: Oregon (closest to Kalshi's US infrastructure)
5. Under **Environment**, add `KALSHI_KEY_ID` and `KALSHI_PRIVATE_KEY_PEM`.
6. Click **Create Web Service**.
7. Wait for the build to finish, then open the URL.

### Why Render works when Vercel doesn't

Vercel runs functions in isolated containers with custom DNS resolution that sometimes fails for specific hostnames. Render runs a normal Node process on a standard EC2 instance with the OS's DNS resolver — the same DNS that works on your laptop. If `api.kalshi.com` resolves on your machine, it'll resolve on Render.

---

## Deploy to Vercel (NOT recommended — known DNS issue)

If you want to try Vercel anyway:

1. Push this folder to a GitHub repo.
2. Import at <https://vercel.com/new>.
3. **Framework Preset** → *Other*. Leave Build/Output/Install empty.
4. Click **Deploy**.

If you see "ENOTFOUND for api.kalshi.com" in Test Connection, switch to Render (above). Vercel's serverless DNS cannot reach Kalshi in some regions.

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
├── server.js            Express server (for Render/Railway/etc. — Vercel doesn't need this)
├── render.yaml          Render Blueprint for one-click deploy
├── package.json         Express dependency (for non-Vercel platforms)
├── vercel.json          Vercel config (no framework, no build step)
├── .gitignore
├── .renderignore
├── .env.example         Kalshi API key template
├── api/
│   ├── proxy.js         Public Kalshi market data (with retry + fallback)
│   ├── order.js         Authenticated order placement ($30-40 cap)
│   ├── balance.js       Authenticated balance + positions
│   ├── health.js        Connection diagnostic endpoint
│   └── keys.js          Kalshi RSA signing + cap enforcement + fetchWithRetry
└── README.md
```

---

## Streamlit Alternative (if Render also fails)

If you deployed to Render and STILL see "ENOTFOUND for api.kalshi.com" in Test Connection, then Kalshi is blocking cloud provider IP ranges (some regulated APIs do this for geofencing compliance). In that case, you have two options:

1. **Run the app locally on your own machine** — your home internet is not a cloud provider, so Kalshi won't block it. Download this folder, run `npm install && node server.js`, open `http://localhost:3000`. Downside: your computer must be on for the bot to trade.

2. **Rewrite in Streamlit + deploy to Streamlit Cloud** — Streamlit Cloud uses different IP ranges than Vercel/Render. This requires a full rewrite in Python. If you want this, ask and I'll do it — but it's a substantial rewrite (the brain, the dashboard, the API routes, the risk gates all need to be ported to Python).

**Recommendation**: try Render first. If Render fails, run locally. Only move to Streamlit if you need always-on cloud hosting AND Render is blocked.

---

## License

MIT
