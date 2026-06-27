// api/balance.js
// ---------------------------------------------------------------------------
// Authenticated Kalshi balance + open positions fetch.
//
// GET /api/balance
//
// Use this from the dashboard header to show the real wallet balance instead
// of the $0 mock figure once Kalshi keys are configured.
// ---------------------------------------------------------------------------

import { kalshiHeaders, getKalshiCreds } from './keys.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  res.setHeader('Access-Control-Allow-Origin', '*');

  const creds = getKalshiCreds();
  if (!creds.keyId || !creds.privateKeyPem) {
    return res.status(500).json({
      error: 'Kalshi credentials not set on server. Set KALSHI_KEY_ID and KALSHI_PRIVATE_KEY_PEM in Vercel env vars and redeploy.',
    });
  }

  try {
    // Get balance
    const balPath = '/portfolio/balances';
    const balHeaders = kalshiHeaders(creds, 'GET', balPath);
    const balRes = await fetch('https://api.kalshi.com/trade-api/v2' + balPath, { headers: balHeaders });
    const balance = await balRes.json();
    if (!balRes.ok) {
      return res.status(balRes.status).json({ error: 'Kalshi rejected balance fetch', detail: balance });
    }

    // Get open positions
    const posPath = '/portfolio/positions';
    const posHeaders = kalshiHeaders(creds, 'GET', posPath);
    const posRes = await fetch('https://api.kalshi.com/trade-api/v2' + posPath, { headers: posHeaders });
    const positions = await posRes.json();
    if (!posRes.ok) {
      // Non-fatal — return balance alone
      return res.status(200).json({ platform: 'kalshi', balance, positions: null });
    }

    return res.status(200).json({ platform: 'kalshi', balance, positions });
  } catch (err) {
    console.error('[balance]', err);
    return res.status(502).json({ error: err.message || 'Balance fetch failed' });
  }
}
