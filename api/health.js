// api/health.js
// ---------------------------------------------------------------------------
// Health check endpoint that tests:
//   1. Whether Kalshi API is reachable from the server
//   2. Whether Kalshi credentials are configured and parseable
//   3. Whether auth headers can be signed (PEM is valid)
//   4. Whether Kalshi accepts the auth (balance fetch succeeds)
//
// GET /api/health
//
// Returns a structured status report. The dashboard uses this to give the
// user a clear "what's wrong" message instead of generic errors.
// ---------------------------------------------------------------------------

import { kalshiHeaders, getKalshiCreds, hasKalshiCreds } from './keys.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  res.setHeader('Access-Control-Allow-Origin', '*');

  const report = {
    timestamp: new Date().toISOString(),
    steps: [],
    overall: 'unknown',
  };

  // STEP 1: Kalshi API reachable?
  try {
    const r = await fetch('https://api.kalshi.com/trade-api/v2/markets?limit=1', {
      headers: { 'Accept': 'application/json', 'User-Agent': 'FableElite/8.1-health' },
    });
    report.steps.push({
      name: 'Kalshi API reachable',
      pass: r.ok || r.status === 401, // 401 means reachable but needs auth — still reachable
      status: r.status,
      detail: r.ok ? 'Yes — markets endpoint responded' :
              r.status === 401 ? 'Reachable but requires auth (expected)' :
              'HTTP ' + r.status,
    });
  } catch (err) {
    const cause = err.cause ? (err.cause.code || err.cause.message) : err.message;
    report.steps.push({
      name: 'Kalshi API reachable',
      pass: false,
      detail: 'No — ' + cause,
      hint: cause === 'ENOTFOUND' ? 'DNS resolution failed. Vercel may be having network issues.' :
            cause === 'ETIMEDOUT' || cause === 'UND_ERR_CONNECT_TIMEOUT' ? 'Connection timed out. Kalshi may be blocking Vercel IPs.' :
            'Network error: ' + cause,
    });
    report.overall = 'fail';
    return res.status(200).json(report);
  }

  // STEP 2: Kalshi credentials configured?
  if (!hasKalshiCreds()) {
    report.steps.push({
      name: 'Kalshi credentials set',
      pass: false,
      detail: 'No — KALSHI_KEY_ID or KALSHI_PRIVATE_KEY_PEM is missing or malformed',
      hint: 'In Vercel → Settings → Environment Variables → Production, ensure both vars are set. KALSHI_PRIVATE_KEY_PEM must include -----BEGIN RSA PRIVATE KEY----- and -----END RSA PRIVATE KEY----- lines.',
    });
    report.overall = 'fail';
    return res.status(200).json(report);
  }
  report.steps.push({ name: 'Kalshi credentials set', pass: true, detail: 'Yes' });

  // STEP 3: Can we sign a request with the PEM?
  const creds = getKalshiCreds();
  let testHeaders;
  try {
    testHeaders = kalshiHeaders(creds, 'GET', '/portfolio/balances');
    report.steps.push({ name: 'PEM signs request', pass: true, detail: 'Yes — RSA signature generated' });
  } catch (e) {
    report.steps.push({
      name: 'PEM signs request',
      pass: false,
      detail: 'No — ' + e.message,
      hint: 'KALSHI_PRIVATE_KEY_PEM is malformed. Most common cause: Vercel stripped newlines. The server tries to fix \\n literals automatically, but if the PEM was edited or truncated, it needs to be re-pasted.',
    });
    report.overall = 'fail';
    return res.status(200).json(report);
  }

  // STEP 4: Does Kalshi accept our auth?
  try {
    const r = await fetch('https://api.kalshi.com/trade-api/v2/portfolio/balances', { headers: testHeaders });
    const data = await r.json();
    if (r.ok) {
      report.steps.push({
        name: 'Kalshi accepts auth',
        pass: true,
        detail: 'Yes — balance: ' + JSON.stringify(data).substring(0, 200),
      });
      report.overall = 'ok';
    } else {
      report.steps.push({
        name: 'Kalshi accepts auth',
        pass: false,
        status: r.status,
        detail: 'No — Kalshi returned ' + r.status + ': ' + JSON.stringify(data).substring(0, 200),
        hint: r.status === 401 ? 'Private key does not match the public key uploaded to Kalshi. Regenerate keypair, re-upload public key to Kalshi dashboard, update KALSHI_PRIVATE_KEY_PEM env var.' :
              r.status === 403 ? 'Account may not have trading permissions enabled. Check Kalshi account status.' :
              'Kalshi rejected the request. Check the detail field.',
      });
      report.overall = 'fail';
    }
  } catch (err) {
    const cause = err.cause ? (err.cause.code || err.cause.message) : err.message;
    report.steps.push({
      name: 'Kalshi accepts auth',
      pass: false,
      detail: 'Network error: ' + cause,
    });
    report.overall = 'fail';
  }

  return res.status(200).json(report);
}
