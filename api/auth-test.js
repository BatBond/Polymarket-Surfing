// api/auth-test.js
// ---------------------------------------------------------------------------
// Comprehensive Kalshi authentication diagnostic.
//
// Tries MULTIPLE signing path formats to figure out exactly which one Kalshi
// expects. Kalshi's docs are ambiguous about whether the signing path should
// be the short path (/portfolio/balance) or the full path
// (/trade-api/v2/portfolio/balance). This endpoint tests both (plus a few
// other variations) and reports which one gets HTTP 200.
//
// If ALL formats return 401, the issue is NOT the signing path — it's either:
//   - Wrong Key ID
//   - Private key doesn't match the public key uploaded to Kalshi
//   - PEM was corrupted during upload (newline stripping)
//
// GET /api/auth-test
// ---------------------------------------------------------------------------

import crypto from 'crypto';
import { getKalshiCreds, hasKalshiCreds, kalshiHeaders } from './keys.js';

const BASE = 'https://api.elections.kalshi.com';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  res.setHeader('Access-Control-Allow-Origin', '*');

  const report = {
    timestamp: new Date().toISOString(),
    tests: [],
    verdict: 'unknown',
  };

  // STEP 1: Check credentials exist and are valid
  if (!hasKalshiCreds()) {
    const c = getKalshiCreds();
    return res.status(200).json({
      ...report,
      verdict: 'no_creds',
      summary: 'Kalshi credentials not set or malformed.',
      detail: {
        hasKeyId: !!c.keyId,
        hasPem: !!c.privateKeyPem,
        pemContainsBegin: c.privateKeyPem ? c.privateKeyPem.includes('BEGIN') : false,
        pemContainsPrivateKey: c.privateKeyPem ? c.privateKeyPem.includes('PRIVATE KEY') : false,
        pemContainsPublicKey: c.privateKeyPem ? c.privateKeyPem.includes('PUBLIC KEY') : false,
      },
      hint: c.privateKeyPem && c.privateKeyPem.includes('PUBLIC KEY')
        ? 'You uploaded a PUBLIC key, not a PRIVATE key. Download kalshi_private.pem (the one you generated locally) and upload that instead.'
        : 'Set KALSHI_KEY_ID and KALSHI_PRIVATE_KEY_PEM env vars. The PEM must include -----BEGIN PRIVATE KEY----- or -----BEGIN RSA PRIVATE KEY-----.',
    });
  }

  const creds = getKalshiCreds();
  report.keyId = creds.keyId;
  report.pemLength = creds.privateKeyPem ? creds.privateKeyPem.length : 0;
  report.pemFirstLine = creds.privateKeyPem ? creds.privateKeyPem.split('\n')[0] : null;

  // STEP 2: Try multiple signing path formats
  // The endpoint we're testing: GET /portfolio/balance
  const signingFormats = [
    {
      name: 'A. Short path: /portfolio/balance',
      signPath: '/portfolio/balance',
      urlPath: '/trade-api/v2/portfolio/balance',
    },
    {
      name: 'B. Full path: /trade-api/v2/portfolio/balance',
      signPath: '/trade-api/v2/portfolio/balance',
      urlPath: '/trade-api/v2/portfolio/balance',
    },
    {
      name: 'C. Path without leading slash: portfolio/balance',
      signPath: 'portfolio/balance',
      urlPath: '/trade-api/v2/portfolio/balance',
    },
    {
      name: 'D. Path with /v2/ prefix: /v2/portfolio/balance',
      signPath: '/v2/portfolio/balance',
      urlPath: '/trade-api/v2/portfolio/balance',
    },
  ];

  let workingFormat = null;

  for (const fmt of signingFormats) {
    const test = { name: fmt.name, signPath: fmt.signPath };
    try {
      // Sign with this path format
      const headers = kalshiHeaders(creds, 'GET', fmt.signPath);

      // Make the actual request
      const r = await fetch(`${BASE}${fmt.urlPath}`, { headers });
      const text = await r.text();
      let body;
      try { body = JSON.parse(text); } catch { body = text; }

      test.status = r.status;
      test.ok = r.ok;
      test.response = typeof body === 'object' ? JSON.stringify(body).substring(0, 300) : String(body).substring(0, 300);

      if (r.ok) {
        test.verdict = 'PASS — Kalshi accepted this signing format!';
        workingFormat = fmt;
      } else if (r.status === 401) {
        test.verdict = 'FAIL — 401 Unauthorized (signature rejected)';
      } else {
        test.verdict = `FAIL — HTTP ${r.status}`;
      }
    } catch (e) {
      test.error = e.message;
      test.verdict = `ERROR — ${e.message}`;
    }
    report.tests.push(test);

    // If we found a working format, we can stop testing
    if (workingFormat) break;
  }

  // STEP 3: Verdict
  if (workingFormat) {
    report.verdict = 'auth_working';
    report.workingFormat = workingFormat.name;
    report.summary = `Auth works with signing format: ${workingFormat.signPath}. The app should use this path format for all Kalshi API calls.`;
  } else {
    // All formats failed — the issue is NOT the signing path
    const all401 = report.tests.every(t => t.status === 401);
    if (all401) {
      report.verdict = 'key_mismatch';
      report.summary = 'ALL signing formats returned 401. The signing path is NOT the issue. The problem is one of: (1) wrong Key ID, (2) private key does not match the public key uploaded to Kalshi, or (3) PEM was corrupted during upload.';
      report.hints = [
        '1. Verify KALSHI_KEY_ID matches the Key ID shown in your Kalshi dashboard (Profile → API Keys).',
        '2. Regenerate the keypair: openssl genrsa -out kalshi_private.pem 2048 && openssl rsa -in kalshi_private.pem -pubout -out kalshi_public.pem',
        '3. Re-upload the NEW kalshi_public.pem to Kalshi dashboard (delete the old key first).',
        '4. Copy the new Key ID from Kalshi into your KALSHI_KEY_ID env var.',
        '5. Update KALSHI_PRIVATE_KEY_PEM with the new kalshi_private.pem contents (including -----BEGIN----- and -----END----- lines).',
        '6. Redeploy and run this test again.',
      ];
    } else {
      report.verdict = 'mixed_errors';
      report.summary = 'Signing tests returned mixed results. Check individual test results above.';
    }
  }

  return res.status(200).json(report);
}
