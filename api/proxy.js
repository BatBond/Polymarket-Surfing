const API_URLS = {
  'poly-clob': 'https://clob.polymarket.com',
  'poly-gamma': 'https://gamma-api.polymarket.com',
  'poly-data': 'https://data-api.polymarket.com',
  'kalshi': 'https://api.kalshi.com/trade-api/v2'
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { platform, endpoint } = req.query;

  if (!platform || !endpoint) {
    return res.status(400).json({ error: 'Missing platform or endpoint' });
  }

  const baseUrl = API_URLS[platform];
  if (!baseUrl) {
    return res.status(400).json({ error: 'Invalid platform' });
  }

  try {
    const url = `${baseUrl}/${endpoint}`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'FableElite/6.0',
      },
    });

    const data = await response.json();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=10');
    return res.status(200).json(data);
  } catch (error) {
    return res.status(502).json({ error: 'Upstream request failed' });
  }
}