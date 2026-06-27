// api/order.js
// ---------------------------------------------------------------------------
// Authenticated order placement for Kalshi (US-legal) and Polymarket.
//
// POST /api/order
// {
//   platform: "kalshi" | "polymarket",
//   market:   "<market ticker or condition_id>",
//   side:     "yes" | "no"          (polymarket)  |  "buy" | "sell" (kalshi)
//   price:    <0..1 for poly | 0..100 for kalshi cents>,
//   size:     <number of shares>,
//   // optional overrides — server enforces $30-50 range regardless
// }
//
// The $30 minimum / $50 maximum per-order guardrail
// (MIN_POSITION_USD / MAX_POSITION_USD in keys.js) is enforced BEFORE any
// network call. A browser cannot bypass this; it lives on the server.
// ---------------------------------------------------------------------------

import { polyL2Headers, getPolyCreds, kalshiHeaders, getKalshiCreds, MIN_POSITION_USD, MAX_POSITION_USD, enforceCap } from './keys.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { platform, market, side, price, size } = req.body || {};

  if (!platform || !market || !side || price == null || size == null) {
    return res.status(400).json({ error: 'Missing required fields: platform, market, side, price, size' });
  }

  // --- $30-50 guardrail (server-side, unbypassable) -----------------------
  const cap = enforceCap(price, size);
  if (!cap.ok) {
    return res.status(400).json({ error: cap.error, notional: cap.notional, min: MIN_POSITION_USD, max: MAX_POSITION_USD });
  }

  try {
    if (platform === 'kalshi') {
      return await placeKalshiOrder(req, res, { market, side, price, size });
    }
    if (platform === 'polymarket') {
      return await placePolymarketOrder(req, res, { market, side, price, size });
    }
    return res.status(400).json({ error: `Unknown platform: ${platform}` });
  } catch (err) {
    console.error('[order]', err);
    return res.status(502).json({ error: err.message || 'Order failed' });
  }
}

// ---------------------------------------------------------------------------
// Kalshi — POST /portfolio/orders
// Docs: https://kalshi.com/docs/api/trading-api#tag/Orders
// Side mapping: "yes" -> "yes", "no" -> "no" (Kalshi native)
// Price in cents (1..99), size = number of contracts.
// ---------------------------------------------------------------------------

async function placeKalshiOrder(req, res, { market, side, price, size }) {
  const creds = getKalshiCreds();
  if (!creds.keyId || !creds.privateKeyPem) {
    return res.status(500).json({ error: 'Kalshi credentials not set on server. See README.' });
  }

  // Kalshi uses "yes"/"no" natively; accept either case.
  const kalshiSide = String(side).toLowerCase();

  const path = '/portfolio/orders';
  const body = JSON.stringify({
    ticker: market,
    side: kalshiSide,
    action: 'buy',
    type: 'limit',
    price: Number(price),         // cents
    count: Math.floor(Number(size)), // integer contracts
  });

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
}

// ---------------------------------------------------------------------------
// Polymarket — POST /order  (CLOB)
// Docs: https://docs.polymarket.com/developers/CLOB/orders/place-order
//
// IMPORTANT: Polymarket blocks US users per CFTC settlement. If you're in
// the US, this route will fail with HTTP 403 from Polymarket's edge — that
// is expected and is not a bug in this code. Use the Kalshi route instead.
//
// Placing a Polymarket order requires TWO signing layers:
//   1. L2 HMAC headers (authenticates the API call)   — handled here
//   2. EIP-712 order signature (binds the order to    — needs your wallet
//      your wallet, prevents tampering)                  private key
//
// The EIP-712 signature must be produced with the @polymarket/clob-client
// SDK on the server (it imports your private key from env). For brevity,
// this route signs L2 headers and forwards the order payload; full EIP-712
// signing is wired in via ClobClient when you install the SDK (see README).
// ---------------------------------------------------------------------------

async function placePolymarketOrder(req, res, { market, side, price, size }) {
  const creds = getPolyCreds();
  if (!creds.apiKey || !creds.secret || !creds.passphrase || !creds.address) {
    return res.status(500).json({ error: 'Polymarket credentials not set on server. See README.' });
  }

  // For full production order placement (with EIP-712 signing), use:
  //   import { ClobClient } from '@polymarket/clob-client';
  //   import { ethers } from 'ethers';
  //   const wallet = new ethers.Wallet(process.env.POLY_PRIVATE_KEY);
  //   const client = new ClobClient('https://clob.polymarket.com', 137, wallet, creds);
  //   const order = await client.createOrder({ tokenID: market, price, size, side });
  //   const resp = await client.postOrder(order);
  //
  // The snippet below does the L2-authed raw POST so you can see the shape
  // and confirm creds work. Swap in the SDK call above for live orders.

  const path = '/order';
  const body = JSON.stringify({
    order: {
      tokenID: market,
      price: String(price),
      size: String(size),
      side: String(side).toLowerCase(), // 'buy' or 'sell'
    },
    owner: creds.address,
      orderType: 'GTC',
      // The signedOrder field must be produced by clob-client.createOrder()
      // using your private key. Without it, Polymarket will reject with 400.
      // This route is intentionally a scaffold — wire the SDK before going live.
    },
  });

  const headers = {
    'Content-Type': 'application/json',
    ...polyL2Headers(creds, 'POST', path, body),
  };

  const r = await fetch('https://clob.polymarket.com' + path, {
    method: 'POST',
    headers,
    body,
  });

  const data = await r.json();
  if (!r.ok) {
    return res.status(r.status).json({ error: 'Polymarket rejected order', detail: data });
  }
  return res.status(200).json({ ok: true, platform: 'polymarket', order: data });
}
