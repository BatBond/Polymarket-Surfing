// api/auth-test.js
// ---------------------------------------------------------------------------
// Comprehensive Kalshi authentication diagnostic.
//
// Tests 8 combinations: {PKCS1v15, PSS padding} × {4 path formats}
// Reports which one (if any) Kalshi accepts.
//
// Common issues this detects:
//   - Wrong padding scheme (PKCS1v15 vs PSS) — Kalshi uses PSS
//   - Wrong signing path (short vs full vs no-slash)
//   - Key mismatch (private key doesn't match public key on Kalshi)
//   - Public key uploaded by mistake instead of private key
//
// GET /api/auth-test
// ---------------------------------------------------------------------------

import { getKalshiCreds, hasKalshiCreds, kalshiHeaders, kalshiHeadersPkcs1v15 } from './keys.js';

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
        : 'Set KALSHI_KEY_ID and KALSHI_PRIVATE_KEY_PEM env vars in Railway. The PEM must include -----BEGIN PRIVATE KEY----- or -----BEGIN RSA PRIVATE KEY-----.',
    });
  }

  const creds = getKalshiCreds();
  report.keyId = creds.keyId;
  report.pemLength = creds.privateKeyPem ? creds.privateKeyPem.length : 0;
  report.pemFirstLine = creds.privateKeyPem ? creds.privateKeyPem.split('\n')[0] : null;

  // STEP 2: Test 8 combinations: 2 paddings × 4 path formats
  const pathFormats = [
    { name: 'short path', signPath: '/portfolio/balance' },
    { name: 'full path', signPath: '/trade-api/v2/portfolio/balance' },
    { name: 'no leading slash', signPath: 'portfolio/balance' },
    { name: '/v2/ prefix', signPath: '/v2/portfolio/balance' },
  ];

  const paddings = [
    { name: 'PSS (Kalshi SDK default)', fn: kalshiHeaders },
    { name: 'PKCS1v15 (older spec)', fn: kalshiHeadersPkcs1v15 },
  ];

  let workingCombo = null;

  for (const pad of paddings) {
    for (const pf of pathFormats) {
      const testName = `${pad.name} + ${pf.name}`;
      const test = { name: testName, padding: pad.name, signPath: pf.signPath };
      try {
        const headers = pad.fn(creds, 'GET', pf.signPath);
        const r = await fetch(`${BASE}/trade-api/v2/portfolio/balance`, { headers });
        const text = await r.text();
        let body;
        try { body = JSON.parse(text); } catch { body = text; }

        test.status = r.status;
        test.ok = r.ok;
        test.response = typeof body === 'object' ? JSON.stringify(body).substring(0, 200) : String(body).substring(0, 200);

        if (r.ok) {
          test.verdict = 'PASS — Kalshi accepted this combination!';
          workingCombo = { padding: pad.name, signPath: pf.signPath, ...test };
        } else if (r.status === 401) {
          test.verdict = 'FAIL — 401 (signature rejected)';
        } else {
          test.verdict = `FAIL — HTTP ${r.status}`;
        }
      } catch (e) {
        test.error = e.message;
        test.verdict = `ERROR — ${e.message}`;
      }
      report.tests.push(test);
      if (workingCombo) break;
    }
    if (workingCombo) break;
  }

  // STEP 3: Verdict
  if (workingCombo) {
    report.verdict = 'auth_working';
    report.workingCombination = workingCombo;
    report.summary = `Auth works with: ${workingCombo.padding} + ${workingCombo.signPath}. The app should use this combination.`;
  } else {
    const all401 = report.tests.every(t => t.status === 401);
    if (all401) {
      report.verdict = 'key_mismatch';
      report.summary = 'ALL 8 combinations returned 401. Padding and path are NOT the issue. The problem is your private key does not match the public key uploaded to Kalshi.';
      report.hints = [
        'STEP 1: Regenerate the keypair locally (do NOT reuse the old one):',
        '  openssl genrsa -out kalshi_private.pem 2048',
        '  openssl rsa -in kalshi_private.pem -pubout -out kalshi_public.pem',
        '',
        'STEP 2: In Kalshi dashboard (Profile → API Keys):',
        '  - DELETE the existing key',
        '  - Click "Add Key" and upload the NEW kalshi_public.pem',
        '  - Copy the new Key ID shown',
        '',
        'STEP 3: In Railway (Variables tab):',
        '  - Update KALSHI_KEY_ID to the new Key ID from Kalshi',
        '  - Update KALSHI_PRIVATE_KEY_PEM with the contents of the NEW kalshi_private.pem',
        '  - The PEM must include -----BEGIN RSA PRIVATE KEY----- through -----END RSA PRIVATE KEY----- with real newlines',
        '',
        'STEP 4: Railway auto-redeploys when variables change. Open the dashboard and click "Test Auth" again.',
        '',
        'IMPORTANT: Both the public key on Kalshi AND the private key in Railway must come from the SAME keypair generation. If you regenerated one without the other, they will not match.',
      ];
    } else {
      report.verdict = 'mixed_errors';
      report.summary = 'Tests returned mixed results. Check individual test results.';
    }
  }

  return res.status(200).json(report);
}
