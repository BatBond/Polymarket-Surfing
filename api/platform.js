// api/platform.js
// ---------------------------------------------------------------------------
// Returns the current deployment platform. The dashboard uses this to show
// a giant red banner if it detects Vercel (which blocks Kalshi DNS).
//
// GET /api/platform
// ---------------------------------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  let platform = 'local';
  let region = null;
  let kalshiBlocked = false;

  if (process.env.RENDER) {
    platform = 'render';
    region = process.env.RENDER_REGION || 'unknown';
  } else if (process.env.VERCEL) {
    platform = 'vercel';
    region = process.env.VERCEL_REGION || 'unknown';
    kalshiBlocked = true; // Known issue: Vercel blocks DNS for api.elections.kalshi.com
  } else if (process.env.RAILWAY_PROJECT_ID) {
    platform = 'railway';
    region = process.env.RAILWAY_REGION || 'unknown';
  }

  // Actually test DNS to confirm
  let dnsResolves = null;
  let dnsError = null;
  try {
    const { lookup } = await import('node:dns/promises');
    const result = await lookup('api.elections.kalshi.com', { all: true });
    dnsResolves = result.map(a => a.address);
  } catch (e) {
    dnsError = e.code || e.message;
    if (platform !== 'vercel') kalshiBlocked = true; // DNS fails elsewhere too
  }

  return res.status(200).json({
    platform,
    region,
    kalshiBlocked,
    dns: {
      resolves: dnsResolves !== null,
      addresses: dnsResolves,
      error: dnsError,
    },
    timestamp: new Date().toISOString(),
  });
}
