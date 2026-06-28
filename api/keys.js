// api/keys.js
// ---------------------------------------------------------------------------
// Kalshi authentication helpers + position-size guardrails.
// Kalshi secrets are read from environment variables on the server and NEVER
// exposed to the browser. The browser only ever talks to /api/* routes.
// ---------------------------------------------------------------------------

import crypto from 'crypto';
import https from 'node:https';
import { URL } from 'node:url';

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
// fetchWithRetry — wraps fetch() with:
//   • 10s timeout per attempt (Vercel Hobby's 10s function limit)
//   • Up to 3 attempts with exponential backoff (500ms, 1500ms)
//   • Detailed error reporting including err.cause
//   • Fallback to node:https direct call if fetch() keeps failing with
//     network errors (works around Node's built-in fetch TLS issues)
//
// Returns { ok, status, data, attempts, lastError }
// ---------------------------------------------------------------------------

export async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  let lastError = null;
  const attempts = [];

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    attempts.push({ attempt, started: new Date().toISOString() });
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10s per attempt

      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }

      attempts[attempts.length - 1].status = res.status;
      attempts[attempts.length - 1].ok = res.ok;

      // Any HTTP response (even 4xx/5xx) means network is working — return it
      return { ok: res.ok, status: res.status, data, attempts };
    } catch (err) {
      const cause = err.cause ? (err.cause.code || err.cause.message) : null;
      lastError = {
        message: err.message,
        cause: cause,
        attempt: attempt,
      };
      attempts[attempts.length - 1].error = lastError;

      console.error(`[fetchWithRetry] attempt ${attempt}/${maxRetries} failed:`, err.message, cause ? `(cause: ${cause})` : '');

      // If this isn't the last attempt, wait before retrying
      if (attempt < maxRetries) {
        const backoffMs = attempt === 1 ? 500 : 1500;
        await new Promise(r => setTimeout(r, backoffMs));
      }
    }
  }

  // All fetch() attempts failed — try DoH-resolved IP first, then node:https
  // (works around cloud platform DNS blocks for api.elections.kalshi.com specifically)
  if (lastError && (lastError.cause === 'ENOTFOUND' || lastError.cause === 'ECONNREFUSED' ||
      lastError.cause === 'UND_ERR_CONNECT_TIMEOUT' || lastError.cause === 'ETIMEDOUT' ||
      lastError.message.includes('fetch failed'))) {

    // ATTEMPT A: Try DNS-over-HTTPS resolution + fetch with custom agent
    // This bypasses the platform's local DNS entirely.
    try {
      const { makeDoHAgent } = await import('./doh-client.js');
      const urlObj = new URL(url);
      const agentResult = await makeDoHAgent(urlObj.hostname);
      if (agentResult) {
        console.log(`[fetchWithRetry] Trying DoH-resolved IP ${agentResult.ip} for ${urlObj.hostname}...`);
        const dohRes = await fetch(url, {
          ...options,
          agent: agentResult.agent,
        });
        const text = await dohRes.text();
        let data;
        try { data = JSON.parse(text); } catch { data = text; }
        attempts.push({ attempt: 'doh-fallback', ip: agentResult.ip, status: dohRes.status, ok: dohRes.ok });
        return { ok: dohRes.ok, status: dohRes.status, data, attempts, dohUsed: true, ip: agentResult.ip };
      }
    } catch (dohErr) {
      console.log('[fetchWithRetry] DoH fallback failed:', dohErr.message);
      attempts.push({ attempt: 'doh-fallback', error: dohErr.message });
    }

    // ATTEMPT B: node:https direct call (bypasses undici entirely)
    console.log('[fetchWithRetry] Trying node:https fallback...');
    try {
      const fallback = await fetchWithNodeHttps(url, options);
      attempts.push({ attempt: 'node-https-fallback', status: fallback.status, ok: fallback.ok });
      return { ...fallback, attempts };
    } catch (fallbackErr) {
      attempts.push({ attempt: 'node-https-fallback', error: { message: fallbackErr.message } });
      lastError.fallbackTried = true;
      lastError.fallbackError = fallbackErr.message;
    }
  }

  return {
    ok: false,
    status: 0,
    data: null,
    attempts,
    lastError,
    networkError: true,
  };
}

// Fallback: use node:https directly. This bypasses Node's built-in fetch
// (undici) which has known issues with some TLS configurations.
function fetchWithNodeHttps(url, options) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const bodyData = options.body || null;

    const req = https.request({
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data: parsed });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out (10s)')); });
    if (bodyData) req.write(bodyData);
    req.end();
  });
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
