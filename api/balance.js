// api/balance.js
// ---------------------------------------------------------------------------
// Authenticated Kalshi balance + open positions fetch.
//
// GET /api/balance
// ---------------------------------------------------------------------------

import { kalshiHeaders, getKalshiCreds, hasKalshiCreds } from './keys.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (!hasKalshiCreds()) {
    return res.status(500).json({
      error: 'Kalshi credentials not set on server. Set KALSHI_KEY_ID and KALSHI_PRIVATE_KEY_PEM in Vercel env vars (Production environment) and redeploy.',
      hint: 'If you already set them, check that KALSHI_PRIVATE_KEY_PEM contains the full PEM including -----BEGIN----- and -----END----- lines.',
    });
  }

  const creds = getKalshiCreds();

  try {
    // Test signing works (bad PEM throws here)
    let balHeaders;
    try {
      balHeaders = kalshiHeaders(creds, 'GET', '/portfolio/balances');
    } catch (signErr) {
      return res.status(500).json({
        error: 'Failed to sign request with KALSHI_PRIVATE_KEY_PEM',
        detail: signErr.message,
        hint: 'The PEM is malformed. Make sure it includes newlines between lines. If you pasted it with literal \\n in Vercel, the server should auto-convert them — but if the PEM was edited, it may be invalid.',
      });
    }

    const balRes = await fetch('https://api.kalshi.com/trade-api/v2/portfolio/balances', { headers: balHeaders });
    const balance = await balRes.json();
    if (!balRes.ok) {
      return res.status(balRes.status).json({ error: 'Kalshi rejected balance fetch', detail: balance });
    }

    // Try to also fetch positions (non-fatal if it fails)
    let positions = null;
    try {
      const posHeaders = kalshiHeaders(creds, 'GET', '/portfolio/positions');
      const posRes = await fetch('https://api.kalshi.com/trade-api/v2/portfolio/positions', { headers: posHeaders });
      if (posRes.ok) positions = await posRes.json();
    } catch (e) {
      // positions fetch is best-effort
    }

    return res.status(200).json({ platform: 'kalshi', balance, positions });
  } catch (err) {
    console.error('[balance]', err);
    const cause = err.cause ? (err.cause.code || err.cause.message) : null;
    return res.status(502).json({
      error: 'Network error reaching Kalshi',
      message: err.message,
      cause: cause,
      hint: cause === 'ENOTFOUND' ? 'DNS resolution failed for api.kalshi.com' :
            cause === 'UND_ERR_CONNECT_TIMEOUT' || cause === 'ETIMEDOUT' ? 'Connection timeout — Kalshi may be blocking Vercel IPs' :
            'Check Vercel function logs',
    });
  }
}
