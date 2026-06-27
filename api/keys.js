// api/keys.js
// ---------------------------------------------------------------------------
// Kalshi authentication helpers + position-size guardrails.
// Kalshi secrets are read from environment variables on the server and NEVER
// exposed to the browser. The browser only ever talks to /api/* routes.
// ---------------------------------------------------------------------------

import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Kalshi — RSA-SHA256 request signing
// https://kalshi.com/docs/api/trading-api
// ---------------------------------------------------------------------------
// Generate a keypair locally (see README "Kalshi Setup"):
//   openssl genrsa -out kalshi_private.pem 2048
//   openssl rsa -in kalshi_private.pem -pubout -out kalshi_public.pem
// Upload kalshi_public.pem to your Kalshi account dashboard.
// Store kalshi_private.pem contents in KALSHI_PRIVATE_KEY_PEM env var.
//
// Signature = base64( RSA-SHA256( `${timestamp}\n${METHOD}\n${path}` ) )
// ---------------------------------------------------------------------------

export function kalshiHeaders({ keyId, privateKeyPem }, method, path) {
  const timestamp = new Date().toISOString();
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${timestamp}\n${method.toUpperCase()}\n${path}`);
  signer.end();
  const signature = signer.sign(privateKeyPem, 'base64');

  return {
    'Kalshi-Access-Key-Id': keyId,
    'Kalshi-Signature': signature,
    'Kalshi-Timestamp': timestamp,
  };
}

export function getKalshiCreds() {
  return {
    keyId: process.env.KALSHI_KEY_ID,
    privateKeyPem: process.env.KALSHI_PRIVATE_KEY_PEM,
  };
}

// ---------------------------------------------------------------------------
// Position size guardrails — enforced in api/order.js before any network
// call. Server-side constants, so the browser cannot bypass them.
//
// MIN_POSITION_USD = 30   -> reject dust / test orders below this
// MAX_POSITION_USD = 40   -> reject any order above this
//
// With a $50 total investment, this means at most ONE open position at a
// time (2 × $30 = $60 > $50). The dashboard enforces max_concurrent=1.
//
// To change the range, edit these two numbers and redeploy. Do NOT expose
// them as env vars — that would let the browser override them.
// ---------------------------------------------------------------------------

export const MIN_POSITION_USD = 30;
export const MAX_POSITION_USD = 40;

export function enforceCap(price, size) {
  const p = Number(price);
  const s = Number(size);
  if (!isFinite(p) || !isFinite(s) || p <= 0 || s <= 0) {
    return { ok: false, error: 'Invalid price or size', notional: NaN };
  }
  // Kalshi prices are in CENTS (1-99), size is in CONTRACTS (positive integer).
  // Each contract at price P cents costs P/100 dollars.
  // Therefore: dollar notional = (price_cents * contracts) / 100
  const notional = (p * s) / 100;
  if (notional < MIN_POSITION_USD) {
    return {
      ok: false,
      error: `Order notional $${notional.toFixed(2)} is below the $${MIN_POSITION_USD} minimum. Increase size or price.`,
      notional,
      min: MIN_POSITION_USD,
      max: MAX_POSITION_USD,
    };
  }
  if (notional > MAX_POSITION_USD) {
    return {
      ok: false,
      error: `Order notional $${notional.toFixed(2)} exceeds the $${MAX_POSITION_USD} hard cap. Reduce size or price.`,
      notional,
      min: MIN_POSITION_USD,
      max: MAX_POSITION_USD,
    };
  }
  return { ok: true, notional, min: MIN_POSITION_USD, max: MAX_POSITION_USD };
}
