// api/proxy.js
// ---------------------------------------------------------------------------
// Kalshi market data proxy.
//
// GET /api/proxy?endpoint=markets?status=open&limit=50
//
// The `endpoint` query param is appended verbatim to
// https://api.elections.kalshi.com/trade-api/v2/
//
// Kalshi's /v2/markets endpoint requires authentication in practice. We
// include the Kalshi RSA auth headers if env vars are set.
// ---------------------------------------------------------------------------

import { kalshiHeaders, getKalshiCreds, fetchWithRetry } from './keys.js';

const BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2';

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
  const [pathOnly, queryString] = endpoint.split('?');
  const fullPath = queryString ? `${pathOnly}?${queryString}` : pathOnly;
  const url = `${BASE_URL}${fullPath.startsWith('/') ? fullPath : '/' + fullPath}`;

  // Kalshi requires the FULL path (including /trade-api/v2/) for signing
  const signPath = '/trade-api/v2/' + pathOnly.replace(/^\//, '');

  const headers = {
    'Accept': 'application/json',
    'User-Agent': 'FableElite/8.1',
  };

  // Attach Kalshi auth headers if creds are configured.
  const creds = getKalshiCreds();
  if (creds.keyId && creds.privateKeyPem) {
    try {
      Object.assign(headers, kalshiHeaders(creds, 'GET', signPath));
    } catch (e) {
      console.error('[proxy] signing failed:', e.message);
    }
  }

  const result = await fetchWithRetry(url, { headers });

  if (result.networkError) {
    const cause = result.lastError ? result.lastError.cause : null;
    return res.status(502).json({
      error: 'Network error reaching Kalshi',
      cause: cause,
      attempts: result.attempts,
      hint: cause === 'ENOTFOUND' ? 'DNS resolution failed. Try redeploying.' : 'Check Vercel function logs.',
      ok: false,
      status: 0,
      endpoint: endpoint,
      auth_used: !!(creds.keyId && creds.privateKeyPem),
      data: null,
    });
  }

  res.setHeader('Cache-Control', 's-maxage=10');
  return res.status(result.ok ? 200 : result.status).json({
    ok: result.ok,
    status: result.status,
    endpoint: endpoint,
    auth_used: !!(creds.keyId && creds.privateKeyPem),
    data: result.data,
  });
}
