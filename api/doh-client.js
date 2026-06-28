// api/doh-client.js
// ---------------------------------------------------------------------------
// DNS-over-HTTPS client — resolves api.elections.kalshi.com via Google/Cloudflare DoH
// instead of the platform's local DNS. Works around cloud platform DNS blocks.
//
// Used by order.js / balance.js / proxy.js when local DNS fails.
// ---------------------------------------------------------------------------

import https from 'node:https';
import http from 'node:http';

const DNS_CACHE = new Map(); // host -> { ips, expires }
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Resolve a hostname via Google DNS-over-HTTPS, with Cloudflare as fallback.
// Returns array of IP addresses, or null if both fail.
export async function resolveViaDoH(hostname) {
  // Check cache first
  const cached = DNS_CACHE.get(hostname);
  if (cached && cached.expires > Date.now()) {
    return cached.ips;
  }

  let ips = null;

  // Try Google DoH first
  try {
    const r = await fetch('https://dns.google/resolve?name=' + hostname + '&type=A', {
      headers: { 'Accept': 'application/dns-json' },
      signal: AbortSignal.timeout(5000),
    });
    const d = await r.json();
    ips = (d.Answer || []).filter(a => a.type === 1).map(a => a.data);
    if (ips.length === 0) ips = null;
  } catch (e) {
    // Google DoH failed — fall through to Cloudflare
  }

  // Fall back to Cloudflare DoH
  if (!ips) {
    try {
      const r = await fetch('https://cloudflare-dns.com/dns-query?name=' + hostname + '&type=A', {
        headers: { 'Accept': 'application/dns-json' },
        signal: AbortSignal.timeout(5000),
      });
      const d = await r.json();
      ips = (d.Answer || []).filter(a => a.type === 1).map(a => a.data);
      if (ips.length === 0) ips = null;
    } catch (e) {
      // Both DoH providers failed
    }
  }

  if (ips) {
    DNS_CACHE.set(hostname, { ips, expires: Date.now() + CACHE_TTL_MS });
  }

  return ips;
}

// Create a custom https.Agent that uses DoH-resolved IPs.
// This bypasses the platform's local DNS entirely.
export async function makeDoHAgent(hostname) {
  const ips = await resolveViaDoH(hostname);
  if (!ips || ips.length === 0) {
    return null; // DoH also failed — caller should fall back to normal fetch
  }
  // Pick a random IP for load balancing
  const ip = ips[Math.floor(Math.random() * ips.length)];

  // Create an agent that connects to the IP directly, but sends the
  // correct Host header / SNI for TLS.
  const agent = new https.Agent({
    lookup: (host, options, callback) => {
      // Always return our DoH-resolved IP, ignoring the platform's DNS
      callback(null, ip, 4);
    },
    // Don't keep connections alive too long — Kalshi may rotate IPs
    keepAlive: true,
    keepAliveMsecs: 30000,
    // Accept Kalshi's TLS cert even though we're connecting to an IP
    rejectUnauthorized: true,
    servername: hostname, // SNI must match the cert
  });

  return { agent, ip, allIps: ips };
}

// Test if DoH resolution works at all (used by /api/dns-test)
export async function testDoH(hostname) {
  const ips = await resolveViaDoH(hostname);
  return { works: !!ips, ips };
}
