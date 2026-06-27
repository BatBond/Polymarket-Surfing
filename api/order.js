// api/order.js
// ---------------------------------------------------------------------------
// Authenticated Kalshi order placement.
//
// POST /api/order
// {
//   market: "<kalshi ticker, e.g. KXBTC-26DEC31-B500000>",
//   side:   "yes" | "no",
//   price:  <1..99 in cents>,
//   size:   <number of contracts>
// }
//
// The $30 minimum / $50 maximum per-order guardrail
// (MIN_POSITION_USD / MAX_POSITION_USD in keys.js) is enforced BEFORE any
// network call. A browser cannot bypass this; it lives on the server.
// ---------------------------------------------------------------------------

import { kalshiHeaders, getKalshiCreds, MIN_POSITION_USD, MAX_POSITION_USD, enforceCap } from './keys.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { market, side, price, size } = req.body || {};

  if (!market || !side || price == null || size == null) {
    return res.status(400).json({ error: 'Missing required fields: market, side, price, size' });
  }

  // Kalshi requires integer cents (1-99). Floor the price before any check
  // or submission. This also prevents decimal-price exploits from the browser.
  const intPrice = Math.floor(Number(price));
  const intSize = Math.floor(Number(size));
  if (!isFinite(intPrice) || !isFinite(intSize) || intPrice < 1 || intPrice > 99 || intSize < 1) {
    return res.status(400).json({ error: 'price must be 1-99 (integer cents), size must be ≥ 1 (integer contracts)' });
  }

  // --- $30-40 guardrail (server-side, unbypassable) -----------------------
  const cap = enforceCap(intPrice, intSize);
  if (!cap.ok) {
    return res.status(400).json({ error: cap.error, notional: cap.notional, min: MIN_POSITION_USD, max: MAX_POSITION_USD });
  }

  const creds = getKalshiCreds();
  if (!creds.keyId || !creds.privateKeyPem) {
    return res.status(500).json({
      error: 'Kalshi credentials not set on server. Set KALSHI_KEY_ID and KALSHI_PRIVATE_KEY_PEM in Vercel env vars and redeploy.',
    });
  }

  // Kalshi accepts "yes" / "no" natively.
  const kalshiSide = String(side).toLowerCase();
  if (kalshiSide !== 'yes' && kalshiSide !== 'no') {
    return res.status(400).json({ error: 'side must be "yes" or "no"' });
  }

  const path = '/portfolio/orders';
  const body = JSON.stringify({
    ticker: market,
    side: kalshiSide,
    action: 'buy',
    type: 'limit',
    price: intPrice,        // integer cents (1-99)
    count: intSize,         // integer contracts
  });

  try {
    const headers = {
      'Content-Type': 'application/json',
      ...kalshiHeaders(creds, 'POST', path),
    };

    const r = await fetch('https://api.kalshi.com/trade-api/v2' + path, {
      method: 'POST',
      headers,
      body,
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: 'Kalshi rejected order', detail: data });
    }
    return res.status(200).json({ ok: true, platform: 'kalshi', order: data });
  } catch (err) {
    console.error('[order]', err);
    // Surface the actual cause — Node fetch's "fetch failed" is useless alone.
    const cause = err.cause ? (err.cause.code || err.cause.message) : null;
    return res.status(502).json({
      error: 'Network error reaching Kalshi',
      message: err.message,
      cause: cause,
      hint: cause === 'ENOTFOUND' ? 'DNS resolution failed for api.kalshi.com — Vercel network issue' :
            cause === 'ECONNREFUSED' ? 'Kalshi refused connection' :
            cause === 'CERT_HAS_EXPIRED' || cause === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ? 'SSL/TLS certificate issue' :
            cause === 'UND_ERR_CONNECT_TIMEOUT' || cause === 'ETIMEDOUT' ? 'Connection timeout — Kalshi may be slow or blocking Vercel IPs' :
            'Check Vercel function logs for details',
    });
  }
}
