#!/usr/bin/env node
// Minimal Node server (no deps) serving a Langfuse Session Viewer UI
// - Serves static files from ./web
// - Proxies /api/sessions and /api/sessions/:id to Langfuse Public API

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// Lightweight .env loader (same as in scripts)
(function loadDotEnv() {
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return;
    const content = fs.readFileSync(envPath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const cleaned = line.startsWith('export ')? line.slice(7) : line;
      const eq = cleaned.indexOf('=');
      if (eq === -1) continue;
      const key = cleaned.slice(0, eq).trim();
      let val = cleaned.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      val = val.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {}
})();

const PORT = Number(process.env.PORT || 5173);
const BASE_URL = (process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com').replace(/\/$/, '');

function requireEnv(name, val) {
  if (!val) {
    console.error(`Missing env ${name}. Set it in .env`);
    process.exit(1);
  }
  return val;
}
requireEnv('LANGFUSE_PUBLIC_KEY', process.env.LANGFUSE_PUBLIC_KEY);
requireEnv('LANGFUSE_SECRET_KEY', process.env.LANGFUSE_SECRET_KEY);

const WEB_DIR = path.join(process.cwd(), 'web');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  let filePath = new URL(req.url, `http://${req.headers.host}`).pathname;
  if (filePath === '/') filePath = '/index.html';
  const fullPath = path.join(WEB_DIR, path.normalize(filePath));
  if (!fullPath.startsWith(WEB_DIR)) {
    res.writeHead(403).end('Forbidden');
    return true;
  }
  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) return false;
  const ext = path.extname(fullPath);
  const mime = MIME[ext] || 'application/octet-stream';
  try {
    const content = fs.readFileSync(fullPath);
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' });
    res.end(content);
    return true;
  } catch (e) {
    res.writeHead(500).end('Static file error');
    return true;
  }
}

function basicAuthHeader() {
  const pk = process.env.LANGFUSE_PUBLIC_KEY || '';
  const sk = process.env.LANGFUSE_SECRET_KEY || '';
  const token = Buffer.from(`${pk}:${sk}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

async function proxySessions(req, res) {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const limit = u.searchParams.get('limit') || '50';
  const page = u.searchParams.get('page') || '1';
  const langfuseUrl = `${BASE_URL}/api/public/sessions?limit=${encodeURIComponent(limit)}&page=${encodeURIComponent(page)}`;
  await proxyGet(langfuseUrl, res);
}

async function proxySessionById(req, res, id) {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const limit = u.searchParams.get('limit') || '50';
  const page = u.searchParams.get('page') || '1';
  const langfuseUrl = `${BASE_URL}/api/public/sessions/${encodeURIComponent(id)}?limit=${encodeURIComponent(limit)}&page=${encodeURIComponent(page)}`;
  await proxyGet(langfuseUrl, res);
}

async function proxyGet(url, res) {
  try {
    const r = await fetch(url, {
      headers: {
        Authorization: basicAuthHeader(),
        Accept: 'application/json',
      },
    });
    const text = await r.text();
    res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' });
    res.end(text);
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Upstream fetch failed', detail: String(e) }));
  }
}

const server = http.createServer(async (req, res) => {
  // API routes
  if (req.url.startsWith('/api/')) {
    if (req.method !== 'GET') {
      res.writeHead(405).end('Method Not Allowed');
      return;
    }
    if (req.url.startsWith('/api/sessions/')) {
      const id = decodeURIComponent(req.url.replace(/^\/api\/sessions\//, '').split('?')[0]);
      return void proxySessionById(req, res, id);
    }
    if (req.url.startsWith('/api/sessions')) {
      return void proxySessions(req, res);
    }
    res.writeHead(404).end('Not Found');
    return;
  }
  // Static
  const served = serveStatic(req, res);
  if (!served) {
    // Fallback to index for SPA-ish routing
    const indexPath = path.join(WEB_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      const html = fs.readFileSync(indexPath);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
    } else {
      res.writeHead(404).end('Not Found');
    }
  }
});

server.listen(PORT, () => {
  console.log(`Langfuse Viewer running on http://localhost:${PORT}`);
});
