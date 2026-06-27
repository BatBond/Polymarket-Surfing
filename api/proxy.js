// api/proxy.js
// ---------------------------------------------------------------------------
// Kalshi market data proxy.
//
// GET /api/proxy?endpoint=markets?status=open&limit=50
//
// The `endpoint` query param is appended verbatim to
// https://api.kalshi.com/trade-api/v2/
//
// Kalshi's /v2/markets endpoint requires authentication in practice (even
// though some docs say it's public). We include the Kalshi RSA auth headers
// if env vars are set. If they're not set, we still try unauthenticated —
// Kalshi may return data for some endpoints without auth.
// ---------------------------------------------------------------------------

import { kalshiHeaders, getKalshiCreds } from './keys.js';

const BASE_URL = 'https://api.kalshi.com/trade-api/v2';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { endpoint } = req.query;
  if (!endpoint) {
    return res.status(400).json({ error: 'Missing ?endpoint=' });
  }

  // Split path from query string so we sign the path only (Kalshi requirement)
  const [path, queryString] = endpoint.split('?');
  const fullPath = queryString ? `${path}?${queryString}` : path;
  const url = `${BASE_URL}${fullPath.startsWith('/') ? fullPath : '/' + fullPath}`;

  const headers = {
    'Accept': 'application/json',
    'User-Agent': 'FableElite/8.1',
  };

  // Attach Kalshi auth headers if creds are configured.
  const creds = getKalshiCreds();
  if (creds.keyId && creds.privateKeyPem) {
    try {
      Object.assign(headers, kalshiHeaders(creds, 'GET', path));
    } catch (e) {
      // Signing failed (bad PEM?) — continue without auth so user sees
      // Kalshi's 401 response and can debug
      console.error('[proxy] signing failed:', e.message);
    }
  }

  try {
    const response = await fetch(url, { headers });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    res.setHeader('Cache-Control', 's-maxage=10');
    return res.status(response.ok ? 200 : response.status).json({
      ok: response.ok,
      status: response.status,
      endpoint: endpoint,
      auth_used: !!(creds.keyId && creds.privateKeyPem),
      data: data,
    });
  } catch (error) {
    // Surface the actual cause (DNS, timeout, SSL, etc.) — Node's fetch
    // otherwise just says "fetch failed" which is useless.
    const cause = error.cause ? (error.cause.code || error.cause.message) : null;
    return res.status(502).json({
      error: 'Upstream request failed',
      message: error.message,
      cause: cause,
      url: url,
    });
  }
}
