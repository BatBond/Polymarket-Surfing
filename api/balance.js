// api/balance.js
// ---------------------------------------------------------------------------
// Authenticated balance + open positions fetch for Kalshi and Polymarket.
//
// GET /api/balance?platform=kalshi
// GET /api/balance?platform=polymarket
//
// Useful for the dashboard header so it shows real wallet balances instead
// of the $50,000 mock figure once you wire live keys in.
// ---------------------------------------------------------------------------

import { polyL2Headers, getPolyCreds, kalshiHeaders, getKalshiCreds } from './keys.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { platform } = req.query;
  if (!platform) return res.status(400).json({ error: 'Missing ?platform=' });

  try {
    if (platform === 'kalshi') return await kalshiBalance(req, res);
    if (platform === 'polymarket') return await polyBalance(req, res);
    return res.status(400).json({ error: `Unknown platform: ${platform}` });
  } catch (err) {
    console.error('[balance]', err);
    return res.status(502).json({ error: err.message || 'Balance fetch failed' });
  }
}

async function kalshiBalance(_req, res) {
  const creds = getKalshiCreds();
  if (!creds.keyId || !creds.privateKeyPem) {
    return res.status(500).json({ error: 'Kalshi credentials not set on server.' });
  }
  const path = '/portfolio/balances';
  const headers = kalshiHeaders(creds, 'GET', path);
  const r = await fetch('https://api.kalshi.com/trade-api/v2' + path, { headers });
  const data = await r.json();
  if (!r.ok) return res.status(r.status).json({ error: 'Kalshi rejected balance', detail: data });
  return res.status(200).json({ platform: 'kalshi', balance: data });
}

async function polyBalance(_req, res) {
  const creds = getPolyCreds();
  if (!creds.apiKey || !creds.secret) {
    return res.status(500).json({ error: 'Polymarket credentials not set on server.' });
  }
  // L2-authed GET — no body
  const path = '/collateral';
  const headers = polyL2Headers(creds, 'GET', path, '');
  const r = await fetch('https://clob.polymarket.com' + path, { headers });
  const data = await r.json();
  if (!r.ok) return res.status(r.status).json({ error: 'Polymarket rejected balance', detail: data });
  return res.status(200).json({ platform: 'polymarket', balance: data });
}
