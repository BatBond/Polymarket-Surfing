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
  let privateKeyPem = process.env.KALSHI_PRIVATE_KEY_PEM || '';
  // Vercel (and most env var UIs) often strip literal newlines from multi-line
  // PEM values. If the PEM contains the literal sequence "\n", replace it with
  // an actual newline so crypto.createSign().sign() can parse it.
  if (privateKeyPem.includes('\\n')) {
    privateKeyPem = privateKeyPem.replace(/\\n/g, '\n');
  }
  // Some UIs also strip the leading/trailing newlines around the BEGIN/END markers
  if (!privateKeyPem.startsWith('-----BEGIN')) {
    const m = privateKeyPem.match(/-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*-----END[A-Z ]*PRIVATE KEY-----/);
    if (m) privateKeyPem = m[0];
  }
  return {
    keyId: process.env.KALSHI_KEY_ID,
    privateKeyPem: privateKeyPem || undefined,
  };
}

// Sanity check used by /api/health — returns true if creds look complete
// (without actually trying to use them). Does NOT verify the key matches Kalshi.
export function hasKalshiCreds() {
  const c = getKalshiCreds();
  return !!(c.keyId && c.privateKeyPem &&
    c.privateKeyPem.includes('BEGIN') && c.privateKeyPem.includes('END'));
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
