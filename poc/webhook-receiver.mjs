#!/usr/bin/env node
/**
 * POC-2 — real TradingView webhook receiver (see docs/ARCHITECTURE.md §17).
 * Minimum code, zero dependencies. Tests REAL alert delivery from the owner's
 * TradingView plan: payload shape, content-type, and duplicate detection.
 * Every delivery is appended verbatim to poc/webhook-received.log.jsonl.
 */
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync, existsSync } from 'node:fs';

const envPath = new URL('./.env.local', import.meta.url).pathname;
let token = 'poc-secret-change-me';
if (existsSync(envPath)) {
  const m = readFileSync(envPath, 'utf8').match(/^WEBHOOK_TOKEN=(.+)$/m);
  if (m) token = m[1].trim();
}
const PORT = Number(process.env.POC_PORT || 8790);
const DEDUPE_TTL_MS = 120_000;
const seen = new Map(); // fingerprint -> first-seen timestamp
const LOG = new URL('./webhook-received.log.jsonl', import.meta.url).pathname;

const server = http.createServer((req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true, service: 'ntt-poc2-webhook-receiver' });
  if (req.method === 'GET' && (req.url === '/' || req.url === '')) {
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:8790';
    const base = (host.startsWith('localhost') || host.startsWith('127.0.0.1')) ? `http://${host}` : `https://${host}`;
    const webhookUrl = `${base}/webhook/${token}`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><html><head><title>NTT POC-2 Webhook Receiver</title>
<style>body{font-family:system-ui,sans-serif;background:#0e1116;color:#e6e6e6;max-width:720px;margin:3rem auto;padding:0 1rem}
h1{font-size:1.3rem}.ok{color:#3fb950;font-weight:600}.copy{color:#79c0ff}code,pre{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:.15rem .4rem;font-size:.9rem}
pre{padding:.8rem;overflow-x:auto}.big{font-size:1.05em}table{border-collapse:collapse;margin-top:1rem}td,th{border:1px solid #30363d;padding:.4rem .7rem;text-align:left}
ol li{margin:.5rem 0}</style></head>
<body><h1>✅ NoAds Trade Tracker — POC-2 Webhook Receiver</h1>
<p class="ok">Service is LIVE and listening.</p>

<h2>1️⃣ Copy this webhook URL</h2>
<pre class="big copy" id="u">${webhookUrl}</pre>
<p class="copy">↑ This is YOUR public URL — paste it into TradingView's alert <b>Notifications → Webhook URL</b>.</p>

<h2>2️⃣ Paste this alert message</h2>
<pre>{"v":1,"action":"buy","symbol":"{{ticker}}","entry":"{{close}}","sl":"2640","tp":"2670"}</pre>

<h2>3️⃣ Make it fire immediately</h2>
<ol>
<li>Open any chart on tradingview.com (e.g. XAUUSD).</li>
<li><b>Alt+A</b> → Create Alert.</li>
<li>Condition: <b>Price → Greater Than</b> a value safely BELOW the current price (e.g. current 2650 → use 2600). It fires within seconds.</li>
<li>Message tab: paste the JSON from step 2.</li>
<li>Notifications tab: ✅ tick <b>Webhook URL</b>, paste the URL from step 1.</li>
<li>Create → come back to Arena and say "it fired".</li>
</ol>

<table><tr><th>Route</th><th>Purpose</th></tr>
<tr><td><code>GET /health</code></td><td>Liveness check (JSON)</td></tr>
<tr><td><code>POST /webhook/${token}</code></td><td>TradingView alert delivery endpoint</td></tr></table>
<p>Deliveries this run: <b>${seen.size}</b> unique fingerprint(s) in the dedupe window — every delivery is appended verbatim to <code>poc/webhook-received.log.jsonl</code>.</p>
</body></html>`);
  }

  const m = req.method === 'POST' && req.url?.match(/^\/webhook\/([^/?]+)/);
  if (!m) return send(404, { error: 'not found — POST /webhook/:token' });

  let body = '';
  req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
  req.on('end', () => {
    const urlToken = decodeURIComponent(m[1]);
    const fingerprint = createHash('sha256').update(body).digest('hex').slice(0, 16);
    const now = Date.now();
    for (const [k, t] of seen) if (now - t > DEDUPE_TTL_MS) seen.delete(k);
    const duplicate = seen.has(fingerprint);
    if (!duplicate) seen.set(fingerprint, now);

    let parsed = null, parseError = null;
    try { parsed = JSON.parse(body); } catch (e) { parseError = String(e.message); }

    const record = {
      id: randomUUID(), receivedAt: new Date().toISOString(), fingerprint, duplicate,
      tokenMatch: urlToken === token,                       // POC logs it; production rejects on mismatch
      contentType: req.headers['content-type'] ?? null,
      userAgent: req.headers['user-agent'] ?? null,
      rawBody: body.slice(0, 10_000), parsed, parseError,
    };
    appendFileSync(LOG, JSON.stringify(record) + '\n');
    console.log(`[${record.receivedAt}] ${duplicate ? 'DUPLICATE ' : 'received  '} json=${parsed ? 'yes' : 'NO'} tokenMatch=${record.tokenMatch} len=${body.length}`);

    // TradingView expects a fast 2xx; mirror what production will do:
    if (!record.tokenMatch) return send(401, { error: 'bad token' });
    if (parseError) return send(400, { error: 'invalid JSON', detail: parseError });
    return send(200, { status: duplicate ? 'duplicate_ignored' : 'received', fingerprint });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`POC-2 webhook receiver listening on 0.0.0.0:${PORT}`);
  console.log(`POST alerts to /webhook/${token} — deliveries logged to ${LOG}`);
});
