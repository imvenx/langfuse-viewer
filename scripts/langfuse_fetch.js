#!/usr/bin/env node
/**
 * Minimal CLI to fetch resources from Langfuse Public API.
 * Defaults to fetching `sessions` as a PoC for a session viewer.
 *
 * Requirements: Node.js 18+ (for built-in fetch).
 * Env vars:
 * - LANGFUSE_BASE_URL (default: https://cloud.langfuse.com)
 * - LANGFUSE_PUBLIC_KEY (required)
 * - LANGFUSE_SECRET_KEY (required)
 *
 * Examples:
 *   LANGFUSE_PUBLIC_KEY=pk LANGFUSE_SECRET_KEY=sk node scripts/langfuse_fetch.js
 *   LANGFUSE_PUBLIC_KEY=pk LANGFUSE_SECRET_KEY=sk node scripts/langfuse_fetch.js --resource traces --limit 25
 *   LANGFUSE_PUBLIC_KEY=pk LANGFUSE_SECRET_KEY=sk node scripts/langfuse_fetch.js --format table
 *   LANGFUSE_PUBLIC_KEY=pk LANGFUSE_SECRET_KEY=sk node scripts/langfuse_fetch.js --resource sessions --id 123 --format table
 */

const { argv } = process;
const fs = require('fs');
const path = require('path');

// Lightweight .env loader (no deps). Loads only if file exists.
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
      // Basic unescape for common sequences
      val = val.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');
      if (!process.env[key]) process.env[key] = val;
    }
  } catch (e) {
    // Non-fatal: continue without .env
  }
})();

function parseArgs(args) {
  const out = {};
  for (let i = 2; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) continue;
    const [k, v] = a.slice(2).split("=");
    // Next arg as value if not provided via =
    if (v === undefined) {
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        out[k] = next;
        i++;
      } else {
        out[k] = true;
      }
    } else {
      out[k] = v;
    }
  }
  return out;
}

function requireEnv(name) {
  const val = process.env[name];
  if (!val) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return val;
}

async function main() {
  const args = parseArgs(argv);

  const baseUrl = process.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com";
  const publicKey = requireEnv("LANGFUSE_PUBLIC_KEY");
  const secretKey = requireEnv("LANGFUSE_SECRET_KEY");

  const resource = (args.resource || process.env.LANGFUSE_RESOURCE || "sessions").toString();
  const limit = Number(args.limit || process.env.LANGFUSE_LIMIT || 50);
  const page = Number(args.page || process.env.LANGFUSE_PAGE || 1);
  const id = args.id || undefined;

  // Additional query params via JSON string
  let extra = {};
  if (args.query || process.env.LANGFUSE_QUERY) {
    try {
      extra = JSON.parse(args.query || process.env.LANGFUSE_QUERY);
    } catch (e) {
      console.error("Failed to parse --query JSON:", e.message);
      process.exit(1);
    }
  }

  const params = new URLSearchParams({ limit: String(limit), page: String(page) });
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined || v === null) continue;
    params.set(k, String(v));
  }

  const pathSuffix = id ? `${resource}/${encodeURIComponent(id)}` : resource;
  const url = `${baseUrl.replace(/\/$/, "")}/api/public/${pathSuffix}?${params.toString()}`;

  const auth = Buffer.from(`${publicKey}:${secretKey}`, "utf8").toString("base64");

  const headers = {
    Authorization: `Basic ${auth}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  const start = Date.now();
  const res = await fetch(url, { headers });
  const elapsed = Date.now() - start;

  let bodyText = await res.text();
  const contentType = res.headers.get("content-type") || "";
  let body;
  if (contentType.includes("application/json")) {
    try { body = JSON.parse(bodyText); } catch { /* keep text */ }
  }

  if (!res.ok) {
    console.error(`HTTP ${res.status} ${res.statusText} in ${elapsed}ms`);
    if (body) {
      console.error(JSON.stringify(body, null, 2));
    } else {
      console.error(bodyText);
    }
    process.exit(2);
  }

  // Pretty-print with small summary
  console.error(`Fetched ${id ? `${resource}/${id}` : resource} OK in ${elapsed}ms`);
  if (Array.isArray(body?.data)) {
    console.error(`Items: ${body.data.length}${body.total ? ` / total ${body.total}` : ""}`);
  }

  const format = (args.format || '').toString();
  if (format.toLowerCase() === 'table') {
    printAsTable(body ?? JSON.parse(bodyText), { columns: (args.columns || '').split(',').filter(Boolean) });
  } else {
    try {
      const out = body ?? JSON.parse(bodyText);
      console.log(JSON.stringify(out, null, 2));
    } catch {
      console.log(bodyText);
    }
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});

function printAsTable(payload, opts = {}) {
  const columns = Array.isArray(opts.columns) && opts.columns.length
    ? opts.columns
    : inferColumns(payload);

  const rows = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload)
      ? payload
      : payload ? [payload] : [];

  const stringRows = rows.map((r) => columns.map((c) => stringify(getProp(r, c))));
  const header = columns;
  const allRows = [header, ...stringRows];
  const widths = columns.map((_, i) => Math.min(40, Math.max(...allRows.map(row => (row[i]?.length || 0)), columns[i].length)));

  const line = (row) => row.map((cell, i) => pad(cell, widths[i])).join('  ');
  console.log(line(header));
  console.log(widths.map(w => '-'.repeat(w)).join('  '));
  for (const row of stringRows) console.log(line(row));
}

function inferColumns(payload) {
  const sample = Array.isArray(payload?.data) ? payload.data[0] : Array.isArray(payload) ? payload[0] : payload || {};
  const preferred = ['id', 'name', 'sessionId', 'traceId', 'environment', 'createdAt', 'updatedAt'];
  const keys = Object.keys(sample || {});
  const cols = preferred.filter(k => keys.includes(k));
  if (cols.length) return cols;
  return keys.slice(0, 6);
}

function getProp(obj, path) {
  if (!path) return undefined;
  return path.split('.').reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), obj);
}

function stringify(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    // Encode short JSON for objects/arrays
    const s = JSON.stringify(v);
    return s.length > 80 ? s.slice(0, 77) + '...' : s;
  }
  return String(v);
}

function pad(s, width) {
  s = s || '';
  if (s.length >= width) return s.slice(0, width);
  return s + ' '.repeat(width - s.length);
}
