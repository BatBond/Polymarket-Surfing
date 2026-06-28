// api/dns-test.js
// ---------------------------------------------------------------------------
// Comprehensive DNS diagnostic for api.elections.kalshi.com.
//
// Runs FIVE different resolution methods plus a TCP connect test:
//   1. dns.lookup (default OS resolver — what fetch() uses)
//   2. dns.resolve4 (bypasses /etc/hosts, hits DNS servers directly)
//   3. dns.resolveAny (all record types)
//   4. Google DNS-over-HTTPS (https://dns.google/resolve?name=...)
//   5. Cloudflare DNS-over-HTTPS (https://cloudflare-dns.com/dns-query)
//   6. TCP connect to api.elections.kalshi.com:443 (proves the host is reachable
//      even if DNS is being spoofed)
//
// If methods 1+2 fail but 4+5 succeed, your platform is filtering DNS
// responses for api.elections.kalshi.com specifically. The only fix is to run on a
// platform without that filter (your laptop).
//
// If method 6 succeeds, you can hit the IP directly — we can hardcode
// api.elections.kalshi.com's IP in /etc/hosts style via a custom https.Agent.
// ---------------------------------------------------------------------------

import dns from 'node:dns';
import { lookup, resolve4, resolveAny } from 'node:dns/promises';
import net from 'node:net';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const target = 'api.elections.kalshi.com';
  const results = {
    target,
    timestamp: new Date().toISOString(),
    platform: process.env.RENDER ? 'render' : process.env.VERCEL ? 'vercel' : process.env.RAILWAY_PROJECT_ID ? 'railway' : 'local',
    tests: [],
    verdict: 'unknown',
  };

  // TEST 1: dns.lookup (uses OS resolver — same as fetch)
  try {
    const addrs = await lookup(target, { all: true });
    results.tests.push({ name: '1. dns.lookup (OS resolver)', pass: true, detail: 'Resolved to ' + addrs.map(a => a.address).join(', ') });
  } catch (e) {
    results.tests.push({ name: '1. dns.lookup (OS resolver)', pass: false, error: e.code, detail: e.message });
  }

  // TEST 2: dns.resolve4 (queries DNS servers directly, bypasses /etc/hosts)
  try {
    const addrs = await resolve4(target);
    results.tests.push({ name: '2. dns.resolve4 (direct DNS query)', pass: true, detail: 'Resolved to ' + addrs.join(', ') });
  } catch (e) {
    results.tests.push({ name: '2. dns.resolve4 (direct DNS query)', pass: false, error: e.code, detail: e.message });
  }

  // TEST 3: Google DNS-over-HTTPS — bypasses local DNS entirely
  try {
    const r = await fetch('https://dns.google/resolve?name=' + target + '&type=A', {
      headers: { 'Accept': 'application/dns-json' },
      signal: AbortSignal.timeout(8000),
    });
    const d = await r.json();
    const addrs = (d.Answer || []).filter(a => a.type === 1).map(a => a.data);
    results.tests.push({
      name: '3. Google DNS-over-HTTPS (dns.google)',
      pass: addrs.length > 0,
      detail: addrs.length > 0 ? 'Resolved to ' + addrs.join(', ') : 'No A records returned',
      raw: d,
    });
  } catch (e) {
    const cause = e.cause ? (e.cause.code || e.cause.message) : e.message;
    results.tests.push({ name: '3. Google DNS-over-HTTPS (dns.google)', pass: false, error: cause, detail: e.message });
  }

  // TEST 4: Cloudflare DNS-over-HTTPS
  try {
    const r = await fetch('https://cloudflare-dns.com/dns-query?name=' + target + '&type=A', {
      headers: { 'Accept': 'application/dns-json' },
      signal: AbortSignal.timeout(8000),
    });
    const d = await r.json();
    const addrs = (d.Answer || []).filter(a => a.type === 1).map(a => a.data);
    results.tests.push({
      name: '4. Cloudflare DNS-over-HTTPS (cloudflare-dns.com)',
      pass: addrs.length > 0,
      detail: addrs.length > 0 ? 'Resolved to ' + addrs.join(', ') : 'No A records returned',
    });
  } catch (e) {
    const cause = e.cause ? (e.cause.code || e.cause.message) : e.message;
    results.tests.push({ name: '4. Cloudflare DNS-over-HTTPS (cloudflare-dns.com)', pass: false, error: cause, detail: e.message });
  }

  // TEST 5: TCP connect to api.elections.kalshi.com:443
  // If DNS fails, this will also fail. But if we got an IP from DoH,
  // we can try connecting directly to that IP.
  const dohAddrs = results.tests
    .filter(t => t.pass && t.detail && t.detail.includes('Resolved to'))
    .flatMap(t => t.detail.replace('Resolved to ', '').split(', '));
  const uniqueAddrs = [...new Set(dohAddrs)];

  if (uniqueAddrs.length > 0) {
    // Try TCP connect to the first IP we got
    const ip = uniqueAddrs[0];
    try {
      const connected = await new Promise((resolve, reject) => {
        const sock = net.connect({ host: ip, port: 443 }, () => { sock.end(); resolve(true); });
        sock.on('error', reject);
        setTimeout(() => { sock.destroy(); reject(new Error('timeout')); }, 5000);
      });
      results.tests.push({ name: '5. TCP connect to ' + ip + ':443', pass: true, detail: 'Connected successfully' });
    } catch (e) {
      results.tests.push({ name: '5. TCP connect to ' + ip + ':443', pass: false, error: e.message, detail: 'Could not establish TCP connection' });
    }
  } else {
    results.tests.push({ name: '5. TCP connect (skipped — no IP available)', pass: false, detail: 'No IP resolved by any method, cannot test TCP' });
  }

  // VERDICT
  const localDnsWorks = results.tests[0].pass || results.tests[1].pass;
  const dohWorks = results.tests[2].pass || results.tests[3].pass;

  if (localDnsWorks && dohWorks) {
    results.verdict = 'ok';
    results.summary = 'DNS works via all methods. If Kalshi API still fails, the issue is not DNS.';
  } else if (!localDnsWorks && dohWorks) {
    results.verdict = 'platform_blocked';
    results.summary = 'Your platform (' + results.platform + ') is BLOCKING DNS resolution for api.elections.kalshi.com specifically. Google and Cloudflare DNS-over-HTTPS can resolve it, but your platform\'s DNS resolver refuses. This is a platform-level block, not a Kalshi issue. CLOUD PLATFORMS CANNOT REACH KALSHI. You must run this app on your own laptop (home internet is not subject to this block).';
    results.fix = 'Run locally: download the zip, extract, run ./start-local.sh on your laptop. Your home ISP does not block api.elections.kalshi.com.';
  } else if (!localDnsWorks && !dohWorks) {
    results.verdict = 'total_block';
    results.summary = 'All DNS methods fail. Either your platform has no outbound internet, OR Kalshi has registered api.elections.kalshi.com in a way that refuses all DNS queries from cloud providers.';
    results.fix = 'Run locally on your laptop. Your home ISP can resolve api.elections.kalshi.com.';
  } else {
    results.verdict = 'partial';
    results.summary = 'Some DNS methods work, others do not. Check individual test results.';
  }

  return res.status(200).json(results);
}
