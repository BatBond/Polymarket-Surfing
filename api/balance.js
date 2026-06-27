// api/balance.js
// ---------------------------------------------------------------------------
// Authenticated Kalshi balance + open positions fetch.
//
// GET /api/balance
// ---------------------------------------------------------------------------

import { kalshiHeaders, getKalshiCreds, hasKalshiCreds, fetchWithRetry } from './keys.js';

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

    const balResult = await fetchWithRetry(
      'https://api.kalshi.com/trade-api/v2/portfolio/balances',
      { headers: balHeaders }
    );

    if (balResult.networkError) {
      const cause = balResult.lastError ? balResult.lastError.cause : null;
      return res.status(502).json({
        error: 'Network error reaching Kalshi after 3 retries + fallback',
        cause: cause,
        attempts: balResult.attempts,
        hint: cause === 'ENOTFOUND' ?
          'DNS resolution failed for api.kalshi.com after multiple attempts. Try redeploying.' :
          'Check Vercel function logs.',
      });
    }

    if (!balResult.ok) {
      return res.status(balResult.status).json({ error: 'Kalshi rejected balance fetch', detail: balResult.data });
    }

    // Try to also fetch positions (non-fatal if it fails)
    let positions = null;
    try {
      const posHeaders = kalshiHeaders(creds, 'GET', '/portfolio/positions');
      const posResult = await fetchWithRetry(
        'https://api.kalshi.com/trade-api/v2/portfolio/positions',
        { headers: posHeaders }
      );
      if (posResult.ok) positions = posResult.data;
    } catch (e) {
      // positions fetch is best-effort
    }

    return res.status(200).json({ platform: 'kalshi', balance: balResult.data, positions });
  } catch (err) {
    console.error('[balance]', err);
    return res.status(502).json({
      error: 'Unexpected error in balance handler',
      message: err.message,
    });
  }
}
