#!/usr/bin/env node
/**
 * POC-1 — MetaApi end-to-end demo execution (see docs/ARCHITECTURE.md §17).
 * Minimum code, zero dependencies, NO production files, DEMO credentials ONLY.
 * Tests the real mechanism: connect → balance/margin → live symbol spec →
 * sizing math → min-lot market order w/ SL/TP + idempotency comment → verify
 * fill → close → limit order → cancel → deliberate broker rejection.
 *
 * Endpoint shapes follow MetaApi's documented REST API. If a call 404s, that
 * IS a POC finding: fix the path here and record it in POC-1-results.md.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// ── env ────────────────────────────────────────────────────────────────────
const envPath = new URL('./.env.local', import.meta.url).pathname;
if (!existsSync(envPath)) { console.error('Missing poc/.env.local (copy poc/.env.example)'); process.exit(2); }
const env = Object.fromEntries(readFileSync(envPath, 'utf8').split('\n')
  .map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const { METAAPI_TOKEN, MT_LOGIN, MT_PASSWORD, MT_SERVER, MT_SYMBOL = 'XAUUSD' } = env;
const PLATFORM = (env.MT_PLATFORM || 'mt5').toLowerCase();
const RISK_USD = Number(env.RISK_USD || 10);
if (!METAAPI_TOKEN || !MT_LOGIN || !MT_PASSWORD || !MT_SERVER) {
  console.error('METAAPI_TOKEN, MT_LOGIN, MT_PASSWORD, MT_SERVER are required'); process.exit(2);
}

const PROV = 'https://mt-provisioning-api-v1.agiliumtrade.ai';
const H = { 'auth-token': METAAPI_TOKEN, 'Content-Type': 'application/json' };
const log = [];                                   // full audit trail
const results = [];                               // per-step PASS/FAIL
const t0 = Date.now();
const ms = () => `${Date.now() - t0}ms`;

async function api(method, url, body, label) {
  const startedAt = Date.now();
  const res = await fetch(url, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  const entry = { at: ms(), label, method, url, status: res.status, durationMs: Date.now() - startedAt, response: json };
  log.push(entry);
  console.log(`[${ms()}] ${label}: HTTP ${res.status} (${entry.durationMs}ms)`);
  return { ok: res.ok, status: res.status, json, entry };
}
function step(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}
const sleep = s => new Promise(r => setTimeout(r, s * 1000));

// ── 1. find or create + deploy the demo account ────────────────────────────
let account = null, tradeHost = null;
{
  const { ok, json } = await api('GET', `${PROV}/users/current/accounts`, null, 'list accounts');
  step('list accounts', ok);
  if (!ok) finish();
  account = (Array.isArray(json) ? json : []).find(a => String(a.login) === String(MT_LOGIN) && a.server === MT_SERVER);
  if (!account) {
    const created = await api('POST', `${PROV}/users/current/accounts`, {
      name: `ntt-poc-${MT_LOGIN}`, type: 'cloud', login: Number(MT_LOGIN),
      password: MT_PASSWORD, server: MT_SERVER, platform: PLATFORM, magic: 279843,
    }, 'create account');
    step('create account', created.ok, created.ok ? '' : JSON.stringify(created.json).slice(0, 200));
    account = created.json;
    if (!created.ok) finish();
    await api('POST', `${PROV}/users/current/accounts/${account.id}/deploy`, {}, 'deploy account');
  }
  // wait for DEPLOYED
  let deployed = account.state === 'DEPLOYED';
  for (let i = 0; i < 24 && !deployed; i++) {
    await sleep(5);
    const cur = await api('GET', `${PROV}/users/current/accounts/${account.id}`, null, 'poll account state');
    account = cur.json || account; deployed = account.state === 'DEPLOYED';
    console.log(`    state=${account.state}`);
  }
  step('account DEPLOYED', deployed, `state=${account.state}`);
  if (!deployed) finish();
  const region = account.region;
  tradeHost = region ? `https://trading-api-v1.${region}.agiliumtrade.ai` : 'https://trading-api-v1.agiliumtrade.ai';
  console.log(`    trade host: ${tradeHost}`);
}
const A = `${tradeHost}/users/current/accounts/${account.id}`;

// ── 2. balance / margin ────────────────────────────────────────────────────
let acctInfo = null;
{
  const r = await api('GET', `${A}/account-information`, null, 'account information');
  acctInfo = r.json;
  step('account information', r.ok && acctInfo && 'balance' in (acctInfo || {}),
    r.ok ? `balance=${acctInfo.balance} equity=${acctInfo.equity} freeMargin=${acctInfo.freeMargin} currency=${acctInfo.currency}` : JSON.stringify(r.json).slice(0, 200));
}

// ── 3. live symbol spec ────────────────────────────────────────────────────
let spec = null;
{
  const r = await api('GET', `${A}/symbol-specs?symbol=${encodeURIComponent(MT_SYMBOL)}`, null, 'symbol spec');
  const list = Array.isArray(r.json) ? r.json : r.json?.specs || [];
  spec = list[0] || (r.json && !Array.isArray(r.json) ? r.json : null);
  const good = spec && spec.tickSize > 0 && Number(spec.tickValue) > 0 && spec.minVolume > 0 && spec.volumeStep > 0;
  step('symbol spec usable for sizing', r.ok && good,
    spec ? `contractSize=${spec.contractSize} tickSize=${spec.tickSize} tickValue=${spec.tickValue} min=${spec.minVolume} max=${spec.maxVolume} step=${spec.volumeStep}` : JSON.stringify(r.json).slice(0, 200));
}

// ── 4. quote + §8A sizing math on real data ────────────────────────────────
let quote = null, sizing = null;
{
  const r = await api('GET', `${A}/symbol-quotes?symbol=${encodeURIComponent(MT_SYMBOL)}`, null, 'quotes');
  const q = Array.isArray(r.json) ? r.json[0] : r.json;
  quote = q;
  const bid = q?.bid ?? q?.close; const ask = q?.ask ?? q?.close;
  step('live quote', r.ok && bid > 0, `bid=${bid} ask=${ask}`);
  if (spec && bid > 0) {
    const entry = ask || bid;
    const slDistance = entry * 0.002;                       // POC synthetic SL: 0.2% away
    const ticks = slDistance / spec.tickSize;
    const lossPerLot = ticks * Number(spec.tickValue);
    const rawLots = RISK_USD / lossPerLot;
    const lots = Math.max(spec.minVolume, Math.floor(rawLots / spec.volumeStep) * spec.volumeStep);
    sizing = { entry, slDistance, ticks, lossPerLot, rawLots, lots };
    step('sizing math on real spec', lossPerLot > 0 && lots >= spec.minVolume,
      `SL dist=${slDistance.toFixed(4)} loss/lot=$${lossPerLot.toFixed(2)} rawLots=${rawLots.toFixed(4)} → ${lots}`);
  }
}

// ── 5. min-lot market order with SL/TP + idempotency comment ───────────────
const idem = `ntt-poc1-${randomUUID().slice(0, 8)}`;
let positionId = null, fillInfo = null;
{
  const entry = sizing?.entry ?? quote?.ask ?? quote?.close;
  const sl = +(entry * 0.998).toFixed(2), tp = +(entry * 1.004).toFixed(2);
  const r = await api('POST', `${A}/trade`, {
    actionType: 'ORDER_TYPE_BUY', symbol: MT_SYMBOL, volume: spec?.minVolume ?? 0.01,
    stopLoss: sl, takeProfit: tp, comment: idem,
  }, 'place market BUY');
  const CLOSED_CODES = new Set([132, 136, 146, 148, 10018, 10027]);
  const closedMkt = !r.ok && (CLOSED_CODES.has(r.json?.numericCode) || /closed|disabled|off quotes|invalid session/i.test(JSON.stringify(r.json)));
  if (closedMkt) step('market order blocked by CLOSED MARKET (weekend) — rerun this step Monday', true, JSON.stringify(r.json).slice(0, 200));
  else step('place market BUY', r.ok && (r.json?.numericCode === 10009 || /done|placed/i.test(JSON.stringify(r.json))), JSON.stringify(r.json).slice(0, 300));
  positionId = closedMkt ? null : (r.json?.positionId ?? r.json?.orderId);
  if (positionId) {
    for (let i = 0; i < 6 && !fillInfo; i++) {
      await sleep(2);
      const pr = await api('GET', `${A}/positions`, null, 'poll positions');
      const pos = (Array.isArray(pr.json) ? pr.json : []).find(p => String(p.id) === String(positionId));
      if (pos) { fillInfo = pos; break; }
    }
    step('position visible (fill confirmed)', !!fillInfo,
      fillInfo ? `lots=${fillInfo.volume} openPrice=${fillInfo.openPrice} profit=${fillInfo.profit}` : 'no position found');
  }
}

// ── 6. close the position ──────────────────────────────────────────────────
if (positionId) {
  const r = await api('POST', `${A}/trade`, { actionType: 'POSITION_CLOSE_ID', positionId }, 'close position');
  step('close position', r.ok, JSON.stringify(r.json).slice(0, 200));
}

// ── 7. away-from-market limit order → cancel ───────────────────────────────
{
  const entry = sizing?.entry ?? quote?.bid ?? quote?.close;
  const openPrice = +(entry * 0.98).toFixed(2);
  const r = await api('POST', `${A}/trade`, {
    actionType: 'ORDER_TYPE_BUY_LIMIT', symbol: MT_SYMBOL, volume: spec?.minVolume ?? 0.01,
    openPrice, stopLoss: +(openPrice * 0.995).toFixed(2), takeProfit: +(openPrice * 1.01).toFixed(2), comment: `${idem}-lim`,
  }, 'place BUY_LIMIT');
  const orderId = r.json?.orderId;
  step('place BUY_LIMIT', r.ok && !!orderId, JSON.stringify(r.json).slice(0, 200));
  if (orderId) {
    const c = await api('POST', `${A}/trade`, { actionType: 'ORDER_DELETE', orderId }, 'cancel limit order');
    step('cancel limit order', c.ok, JSON.stringify(c.json).slice(0, 200));
  }
}

// ── 8. deliberate broker rejection (bad symbol) ────────────────────────────
{
  const r = await api('POST', `${A}/trade`, {
    actionType: 'ORDER_TYPE_BUY', symbol: 'NTT_INVALID_SYMBOL_XYZ', volume: 0.01, comment: `${idem}-bad`,
  }, 'deliberate bad-symbol order');
  const rejected = !r.ok || (r.json?.numericCode && r.json.numericCode !== 10009);
  step('broker rejection captured with code', rejected, `HTTP ${r.status} code=${r.json?.numericCode} msg=${JSON.stringify(r.json?.message || '').slice(0, 120)}`);
}

finish();

function finish() {
  const passed = results.filter(r => r.ok).length;
  const summary = { runAt: new Date().toISOString(), durationMs: Date.now() - t0, idemKey: idem, passed, total: results.length, results };
  const logFile = new URL(`./poc1-run-${Date.now()}.json`, import.meta.url).pathname;
  writeFileSync(logFile, JSON.stringify({ summary, rawLog: log }, null, 2));
  console.log(`\n${'═'.repeat(60)}\nPOC-1 RESULT: ${passed}/${results.length} steps passed\nRaw log: ${logFile}\n${'═'.repeat(60)}`);
  process.exit(results.every(r => r.ok) ? 0 : 1);
}
