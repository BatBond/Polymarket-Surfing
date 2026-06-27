// api/keys.js
// ---------------------------------------------------------------------------
// Authentication helpers for Polymarket CLOB (L2 HMAC) and Kalshi (RSA-SHA256).
// Both secrets are read from environment variables on the server and NEVER
// exposed to the browser. The browser only ever talks to /api/* routes.
// ---------------------------------------------------------------------------

import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Polymarket CLOB — L2 header signing
// https://docs.polymarket.com/developers/CLOB/authentication
// ---------------------------------------------------------------------------
// Credentials come from your wallet (see README "Polymarket Setup").
// POLY_API_KEY      — string
// POLY_SECRET       — base64 string (keep this secret!)
// POLY_PASSPHRASE   — string
// POLY_ADDRESS      — your EVM wallet address (0x...)
//
// L2 signature = HMAC-SHA256(secret_b64_decoded, timestamp + METHOD + path + body)
//               -> base64
// ---------------------------------------------------------------------------

export function polyL2Headers({ apiKey, secret, passphrase, address }, method, path, body = '') {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = `${timestamp}${method.toUpperCase()}${path}${body || ''}`;
  const sig = crypto
    .createHmac('sha256', Buffer.from(secret, 'base64'))
    .update(message)
    .digest('base64');

  return {
    'POLY_ADDRESS': address,
    'POLY_SIGNATURE': sig,
    'POLY_TIMESTAMP': timestamp,
    'POLY_API_KEY': apiKey,
    'POLY_PASSPHRASE': passphrase,
  };
}

export function getPolyCreds() {
  return {
    apiKey: process.env.POLY_API_KEY,
    secret: process.env.POLY_SECRET,
    passphrase: process.env.POLY_PASSPHRASE,
    address: process.env.POLY_ADDRESS,
  };
}

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
// Hard $30 position cap — enforced in BOTH api/order.js and any client.
// This is a server-side gate so the browser cannot bypass it.
// ---------------------------------------------------------------------------

export const MAX_POSITION_USD = 30;

export function enforceCap(price, size) {
  const p = Number(price);
  const s = Number(size);
  if (!isFinite(p) || !isFinite(s) || p <= 0 || s <= 0) {
    return { ok: false, error: 'Invalid price or size', notional: NaN };
  }
  const notional = p * s;
  if (notional > MAX_POSITION_USD) {
    return {
      ok: false,
      error: `Order notional $${notional.toFixed(2)} exceeds the $${MAX_POSITION_USD} hard cap. Reduce size or price.`,
      notional,
    };
  }
  return { ok: true, notional };
}
