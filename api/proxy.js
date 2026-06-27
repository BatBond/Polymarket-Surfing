// api/proxy.js
// ---------------------------------------------------------------------------
// Public, unauthenticated Kalshi market data proxy.
//
// GET /api/proxy?endpoint=markets?limit=50&status=open
//
// The `endpoint` query param is appended verbatim to
// https://api.kalshi.com/trade-api/v2/  — include query string params as
// part of the endpoint (URL-encoded if needed).
// ---------------------------------------------------------------------------

const BASE_URL = 'https://api.kalshi.com/trade-api/v2';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { endpoint } = req.query;
  if (!endpoint) {
    return res.status(400).json({ error: 'Missing ?endpoint=' });
  }

  try {
    const url = `${BASE_URL}/${endpoint}`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'FableElite/6.0',
      },
    });

    const data = await response.json();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=10');
    return res.status(response.ok ? 200 : response.status).json(data);
  } catch (error) {
    return res.status(502).json({ error: 'Upstream request failed', detail: String(error) });
  }
}
