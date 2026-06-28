// server.js
// ---------------------------------------------------------------------------
// Tiny Express server that serves the static dashboard and the API routes
// from a single process. Required for Render (and any non-Vercel platform).
//
// Vercel doesn't need this file — Vercel uses file-based routing in /api/.
// Render, Railway, Heroku, Fly.io, etc. all need this entry point.
// ---------------------------------------------------------------------------

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

import orderHandler from './api/order.js';
import balanceHandler from './api/balance.js';
import proxyHandler from './api/proxy.js';
import healthHandler from './api/health.js';
import platformHandler from './api/platform.js';
import dnsTestHandler from './api/dns-test.js';
import authTestHandler from './api/auth-test.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON bodies for POST routes
app.use(express.json());

// Serve static files (index.html, favicon, etc.)
app.use(express.static(__dirname));

// API routes
app.get('/api/health', healthHandler);
app.get('/api/platform', platformHandler);
app.get('/api/dns-test', dnsTestHandler);
app.get('/api/auth-test', authTestHandler);
app.get('/api/balance', balanceHandler);
app.get('/api/proxy', proxyHandler);
app.post('/api/order', orderHandler);

// Catch-all: serve index.html for any non-API, non-static route
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  const indexPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Not found');
  }
});

app.listen(PORT, () => {
  console.log(`Kalshi AI Brain server listening on port ${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});
