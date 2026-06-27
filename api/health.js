// api/health.js
// ---------------------------------------------------------------------------
// Health check endpoint that tests:
//   1. Whether Kalshi API is reachable from the server (markets endpoint)
//   2. Whether Kalshi credentials are configured and parseable
//   3. Whether auth headers can be signed (PEM is valid)
//   4. Whether Kalshi accepts the auth (balance fetch succeeds)
//   5. Whether the order endpoint URL is reachable (POST with empty body)
//
// GET /api/health
// ---------------------------------------------------------------------------

import { kalshiHeaders, getKalshiCreds, hasKalshiCreds, fetchWithRetry } from './keys.js';
import dns from 'node:dns';
import { lookup } from 'node:dns/promises';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  res.setHeader('Access-Control-Allow-Origin', '*');

  const report = {
    timestamp: new Date().toISOString(),
    steps: [],
    overall: 'unknown',
    vercel_region: process.env.VERCEL_REGION || 'unknown',
    platform: process.env.RENDER ? 'render' : process.env.VERCEL ? 'vercel' : 'unknown',
  };

  // STEP 0: DNS diagnostic — try to resolve api.kalshi.com directly
  // This tells us if the issue is DNS-specific or network-wide
  try {
    const addresses = await lookup('api.kalshi.com', { all: true });
    report.steps.push({
      name: 'DNS resolves api.kalshi.com',
      pass: true,
      detail: 'Yes — resolved to: ' + addresses.map(a => a.address).join(', '),
    });
  } catch (dnsErr) {
    report.steps.push({
      name: 'DNS resolves api.kalshi.com',
      pass: false,
      detail: 'No — ' + dnsErr.code + ': ' + dnsErr.message,
      hint: 'DNS resolution failed. This could be: (1) a platform network restriction, (2) Kalshi blocking cloud provider IP ranges, (3) a regional DNS issue. Try deploying to a different platform (Render, Railway) or region.',
    });
  }

  // STEP 0b: Test if general internet works (try google.com)
  try {
    const testRes = await fetch('https://www.google.com', { signal: AbortSignal.timeout(5000) });
    report.steps.push({
      name: 'General internet reachable (google.com)',
      pass: testRes.ok,
      detail: testRes.ok ? 'Yes — google.com responded' : 'HTTP ' + testRes.status,
    });
  } catch (err) {
    const cause = err.cause ? (err.cause.code || err.cause.message) : err.message;
    report.steps.push({
      name: 'General internet reachable (google.com)',
      pass: false,
      detail: 'No — ' + cause,
      hint: 'If google.com also fails, the platform has no outbound internet. If google.com works but api.kalshi.com fails, Kalshi is specifically blocking this platform/region.',
    });
  }

  // STEP 1: Kalshi API reachable (markets endpoint, no auth needed for this test)
  try {
    const r = await fetch('https://api.kalshi.com/trade-api/v2/markets?limit=1', {
      headers: { 'Accept': 'application/json', 'User-Agent': 'FableElite/8.1-health' },
    });
    report.steps.push({
      name: 'Kalshi API reachable (markets endpoint)',
      pass: r.ok || r.status === 401,
      status: r.status,
      detail: r.ok ? 'Yes — markets endpoint responded' :
              r.status === 401 ? 'Reachable but requires auth (expected)' :
              'HTTP ' + r.status,
    });
  } catch (err) {
    const cause = err.cause ? (err.cause.code || err.cause.message) : err.message;
    report.steps.push({
      name: 'Kalshi API reachable (markets endpoint)',
      pass: false,
      detail: 'No — ' + cause,
      hint: cause === 'ENOTFOUND' ? 'DNS resolution failed for api.kalshi.com. If google.com works above but this fails, Kalshi is blocking your platform. Try Render (different IP range) or a Vercel US region.' :
            cause === 'ETIMEDOUT' || cause === 'UND_ERR_CONNECT_TIMEOUT' ? 'Connection timed out. Kalshi may be blocking Vercel IPs in your region (' + report.vercel_region + ').' :
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

  // STEP 4: Does Kalshi accept our auth? (uses fetchWithRetry now)
  try {
    const balResult = await fetchWithRetry(
      'https://api.kalshi.com/trade-api/v2/portfolio/balances',
      { headers: testHeaders }
    );

    if (balResult.networkError) {
      const cause = balResult.lastError ? balResult.lastError.cause : null;
      report.steps.push({
        name: 'Kalshi accepts auth (balance fetch)',
        pass: false,
        detail: 'Network error after 3 retries: ' + cause,
        hint: 'Despite step 1 passing, the balance fetch failed. This suggests intermittent network issues. Try again, or check Vercel region: ' + report.vercel_region,
      });
      report.overall = 'fail';
      return res.status(200).json(report);
    }

    if (balResult.ok) {
      report.steps.push({
        name: 'Kalshi accepts auth (balance fetch)',
        pass: true,
        detail: 'Yes — balance: ' + JSON.stringify(balResult.data).substring(0, 200),
      });
    } else {
      report.steps.push({
        name: 'Kalshi accepts auth (balance fetch)',
        pass: false,
        status: balResult.status,
        detail: 'No — Kalshi returned ' + balResult.status + ': ' + JSON.stringify(balResult.data).substring(0, 200),
        hint: balResult.status === 401 ? 'Private key does not match the public key uploaded to Kalshi. Regenerate keypair, re-upload public key to Kalshi dashboard, update KALSHI_PRIVATE_KEY_PEM env var.' :
              balResult.status === 403 ? 'Account may not have trading permissions enabled. Check Kalshi account status.' :
              'Kalshi rejected the request. Check the detail field.',
      });
      report.overall = 'fail';
      return res.status(200).json(report);
    }
  } catch (err) {
    const cause = err.cause ? (err.cause.code || err.cause.message) : err.message;
    report.steps.push({
      name: 'Kalshi accepts auth (balance fetch)',
      pass: false,
      detail: 'Network error: ' + cause,
    });
    report.overall = 'fail';
    return res.status(200).json(report);
  }

  // STEP 5: Test the order endpoint URL specifically (POST with empty body)
  // This will fail with 400/401 but if it returns ANY HTTP response, the
  // URL is reachable. If it throws, we have a network issue specific to POST.
  try {
    const orderHeaders = {
      'Content-Type': 'application/json',
      ...kalshiHeaders(creds, 'POST', '/portfolio/orders'),
    };
    const orderResult = await fetchWithRetry(
      'https://api.kalshi.com/trade-api/v2/portfolio/orders',
      { method: 'POST', headers: orderHeaders, body: JSON.stringify({}) }
    );

    if (orderResult.networkError) {
      const cause = orderResult.lastError ? orderResult.lastError.cause : null;
      report.steps.push({
        name: 'Order endpoint reachable (POST)',
        pass: false,
        detail: 'Network error after retries: ' + cause,
        hint: 'GET requests work but POST fails. This can be a Vercel network issue with POST bodies, or Kalshi rate-limiting. Try again in a few minutes.',
      });
      report.overall = 'fail';
    } else {
      // Any HTTP response (even 400 for bad body) means the URL is reachable
      report.steps.push({
        name: 'Order endpoint reachable (POST)',
        pass: true,
        detail: 'Yes — HTTP ' + orderResult.status + ' (expected 400 for empty body, this confirms the endpoint is reachable)',
      });
      report.overall = 'ok';
    }
  } catch (err) {
    report.steps.push({
      name: 'Order endpoint reachable (POST)',
      pass: false,
      detail: 'Error: ' + err.message,
    });
    report.overall = 'fail';
  }

  return res.status(200).json(report);
}
