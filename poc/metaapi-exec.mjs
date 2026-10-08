#!/usr/bin/env node
/**
 * POC-1 — MetaApi end-to-end demo execution (see docs/ARCHITECTURE.md §17).
 * Minimum code, zero dependencies, NO production files, DEMO credentials ONLY.
 * Tests the real mechanism: connect → balance/margin → live symbol spec →
 * sizing math → min-lot market order w/ SL/TP + idempotency comment → verify
 * fill → broker P&L vs spec math → close → limit + stop orders → cancel →
 * deliberate broker rejection.
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
const cancelOnly = process.argv.length === 4 && process.argv[2] === '--cancel-order' && /^\d+$/.test(process.argv[3]);
const cancelOrderId = cancelOnly ? process.argv[3] : null;
if (process.argv.length !== 2 && !cancelOnly) {
  console.error('Usage: node metaapi-exec.mjs [--cancel-order <numeric order id>]'); process.exit(2);
}
if (!METAAPI_TOKEN || !MT_LOGIN || !MT_PASSWORD || !MT_SERVER) {
  console.error('METAAPI_TOKEN, MT_LOGIN, MT_PASSWORD, MT_SERVER are required'); process.exit(2);
}
if (!/demo/i.test(MT_SERVER) || !(RISK_USD > 0 && Number.isFinite(RISK_USD))) {
  console.error('POC requires a DEMO MT_SERVER and positive, finite RISK_USD. No orders sent.'); process.exit(2);
}

const H = { 'auth-token': METAAPI_TOKEN, 'Content-Type': 'application/json' };
// MetaApi retired old hosts (POC finding 2026-10-04): probe candidates, use first that answers.
const PROV_CANDIDATES = [
  'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai',
  'https://mt-provisioning-api-v1.agiliumtrade.ai',
];
let PROV = null;
for (const c of PROV_CANDIDATES) {
  try {
    const r = await fetch(`${c}/users/current/accounts`, { headers: H });
    PROV = c; console.log(`provisioning host: ${c} (HTTP ${r.status})`); break;
  } catch (e) { console.log(`  ${c} unreachable (${e.cause?.code || e.message})`); }
}
if (!PROV) { console.error('No MetaApi provisioning host reachable from this network.'); process.exit(2); }
const log = [];                                   // full audit trail
const results = [];                               // per-step PASS/FAIL
const t0 = Date.now();
const ms = () => `${Date.now() - t0}ms`;
const idem = `ntt-poc1-${randomUUID().slice(0, 8)}`;

// Safety net: an unexpected exception must still write the audit log and say what to check.
for (const ev of ['uncaughtException', 'unhandledRejection']) {
  process.on(ev, err => {
    console.error(`UNEXPECTED ${ev}: ${err?.stack || err}`);
    console.error(`Check MT5 for open ${MT_SYMBOL} orders/positions before rerunning.`);
    step('unexpected exception (check MT5)', false, String(err?.message || err).slice(0, 200));
    finish();
  });
}

async function api(method, url, body, label, extraHeaders) {
  const startedAt = Date.now();
  let res, text;
  try {
    res = await fetch(url, { method, headers: { ...H, ...extraHeaders }, body: body ? JSON.stringify(body) : undefined });
    text = await res.text();
  } catch (e) {
    // Timeout or reset: a trade POST may still have been processed by the broker.
    // Record it and fail the step loudly ("outcome UNKNOWN"); never crash mid-trade without an audit log.
    const reason = String(e.cause?.code || e.message);
    log.push({ at: ms(), label, method, url, status: 0, durationMs: Date.now() - startedAt, networkError: reason });
    console.log(`[${ms()}] ${label}: NETWORK ERROR (${reason}) — outcome UNKNOWN for trade calls; check MT5`);
    return { ok: false, status: 0, json: { networkError: reason }, entry: log[log.length - 1] };
  }
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
const tradeDone = r => r.ok && r.json?.numericCode === 10009;

// ── 1. find or create + deploy the demo account ────────────────────────────
let account = null, tradeHost = null;
{
  const { ok, json } = await api('GET', `${PROV}/users/current/accounts`, null, 'list accounts');
  step('list accounts', ok);
  if (!ok) finish();
  const allAccounts = Array.isArray(json) ? json : [];
  // Never adopt an arbitrary first account: this POC must trade on ONE known demo server.
  account = allAccounts.find(a => String(a.login) === String(MT_LOGIN) && a.server === MT_SERVER)
    || (allAccounts.length === 1 && allAccounts[0].server === MT_SERVER ? allAccounts[0] : null);
  if (allAccounts.length && !account) {
    step('select demo account', false, 'No unique account on MT_SERVER; set MT_LOGIN to the correct demo login. No orders sent.'); finish();
  }
  if (account && String(account.login) !== String(MT_LOGIN)) {
    console.log(`    adopting sole demo account: login=${account.login} server=${account.server} platform=${account.platform || '?'} state=${account.state}`);
  }
  if (account) {
    account.id = account.id || account._id;   // MetaApi list records may key the id as _id
    if (!account.id || !/demo/i.test(account.server)) {
      step('account id and demo server', false, 'Missing id or not a demo account; no orders sent.'); finish();
    }
    console.log(`    account id=${account.id} region=${account.region || '?'}`);
  }
  if (cancelOnly && !account) {
    step('select existing account for cleanup', false, 'No account found; refusing to create one in cancellation-only mode.'); finish();
  }
  if (!account) {
    const txid = randomUUID().replace(/-/g, '');
    const body = {
      name: `ntt-poc-${MT_LOGIN}`, type: 'cloud', login: String(MT_LOGIN),
      password: MT_PASSWORD, server: MT_SERVER, platform: PLATFORM, magic: 279843,
    };
    const created = await api('POST', `${PROV}/users/current/accounts`, body, 'create account', { 'transaction-id': txid });
    step('create account', created.ok, created.ok ? `status ${created.status}` : JSON.stringify(created.json).slice(0, 200));
    if (!created.ok) finish();
    // MetaApi async protocol: 202 = re-send the SAME request with the SAME
    // transaction-id until the real result (account or error) surfaces.
    account = null;   // NEVER trust the 202 body id — it can be a phantom.
    for (let i = 0; i < 30 && !account?.id; i++) {
      await sleep(5);
      const poll = await api('POST', `${PROV}/users/current/accounts`, body, 'poll create (same transaction-id)', { 'transaction-id': txid });
      if (poll.ok && poll.status !== 202 && poll.json && poll.json.id) { account = poll.json; break; }
      if (!poll.ok && poll.status !== 202) {
        step('async create finished with error', false, JSON.stringify(poll.json).slice(0, 400));
        finish();
      }
      const l = await api('GET', `${PROV}/users/current/accounts`, null, 'list check during tx poll');
      const found = (Array.isArray(l.json) ? l.json : []).find(a => String(a.login) === String(MT_LOGIN) && a.server === MT_SERVER);
      if (found?.id) { account = found; console.log(`    found account id=${account.id} state=${account.state}`); break; }
    }
    // Fallback: resolve via the account list.
    for (let i = 0; i < 12 && !account?.id; i++) {
      await sleep(5);
      const l = await api('GET', `${PROV}/users/current/accounts`, null, 'poll list for new account id');
      account = (Array.isArray(l.json) ? l.json : []).find(a => String(a.login) === String(MT_LOGIN) && a.server === MT_SERVER) || null;
      if (account?.id) console.log(`    found account id=${account.id} state=${account.state}`);
    }
    if (!account?.id) { step('created account id resolvable', false, 'no account with our login appeared in list'); finish(); }
    if (account.state !== 'DEPLOYED') {
      await api('POST', `${PROV}/users/current/accounts/${account.id}/deploy`, {}, 'deploy account');
    }
  }
  // wait for DEPLOYED
  let deployed = account.state === 'DEPLOYED';
  for (let i = 0; i < 24 && !deployed; i++) {
    await sleep(5);
    const cur = await api('GET', `${PROV}/users/current/accounts/${account.id}`, null, 'poll account state');
    if (cur.status === 404) {
      const l = await api('GET', `${PROV}/users/current/accounts`, null, 're-resolve via list (404 on id)');
      account = (Array.isArray(l.json) ? l.json : []).find(a => String(a.login) === String(MT_LOGIN) && a.server === MT_SERVER) || account;
    } else account = cur.json || account;
    deployed = account.state === 'DEPLOYED';
    console.log(`    state=${account.state}`);
  }
  step('account DEPLOYED', deployed, `state=${account.state}`);
  if (!deployed) finish();
  const region = account.region || 'new-york';
  for (const prefix of ['mt-client-api-v1', 'trading-api-v1']) {
    const host = `https://${prefix}.${region}.agiliumtrade.ai`;
    try {
      const pr = await fetch(`${host}/users/current/accounts/${account.id}/account-information`, { headers: H });
      console.log(`    trade host candidate: ${host} (HTTP ${pr.status})`);
      if (pr.ok) { tradeHost = host; break; }
    } catch (e) { console.log(`    ${host} unreachable (${e.cause?.code || e.message})`); }
  }
  if (!tradeHost) { step('trade host resolves account', false, 'No candidate returned HTTP 200; no orders sent.'); finish(); }
}
const A = `${tradeHost}/users/current/accounts/${account.id}`;

async function confirmOrderAbsent(ticket, label) {
  for (let i = 0; i < 4; i++) {
    if (i) await sleep(2);
    const v = await api('GET', `${A}/orders?refreshTerminalState=true`, null, label);
    if (!v.ok || !Array.isArray(v.json)) return { ok: false, detail: 'Cannot read orders; check MT5.' };
    if (!v.json.some(o => String(o.id) === String(ticket))) return { ok: true, detail: `ticket ${ticket} no longer pending` };
  }
  return { ok: false, detail: `ticket ${ticket} still pending; check MT5.` };
}

// Away-from-market pending order (§17 U1): place min-lot → broker cancel → verify absent → verify no fill.
// Whenever the broker returned a ticket, cancellation is attempted even if the send result was unclear.
async function pendingCycle(name, actionType, openPrice, suffix) {
  const sl = +(openPrice * 0.998).toFixed(spec.digits);
  const tp = +(openPrice * 1.004).toFixed(spec.digits);
  const sideOk = actionType === 'ORDER_TYPE_BUY_STOP' ? openPrice > quote.ask : openPrice < quote.bid;
  const plannedLoss = (openPrice - sl) / spec.tickSize * quote.lossTickValue * spec.minVolume;
  if (!(sideOk && sl > 0 && sl < openPrice && tp > openPrice && Number.isFinite(plannedLoss)
    && plannedLoss > 0 && plannedLoss <= RISK_USD + 1e-8)) {
    step(`${name} risk gate`, false, `planned loss=$${plannedLoss}; risk budget=$${RISK_USD}. No order sent.`); finish();
  }
  console.log(`    ${name} min-lot=${spec.minVolume} entry=${openPrice} SL=${sl} TP=${tp} planned loss=$${plannedLoss.toFixed(2)} (budget=$${RISK_USD})`);
  const r = await api('POST', `${A}/trade`, {
    actionType, symbol: MT_SYMBOL, volume: spec.minVolume,
    openPrice, stopLoss: sl, takeProfit: tp, comment: `${idem}-${suffix}`,
  }, `place ${name}`);
  const orderId = r.json?.orderId;
  const placed = r.ok && [10008, 10009].includes(r.json?.numericCode) && !!orderId;
  step(`place ${name}`, placed, JSON.stringify(r.json).slice(0, 200));
  if (!orderId) {
    if (!placed) console.error(`${name} outcome unclear. Check MT5 pending orders before rerunning.`);
    finish();
  }
  const c = await api('POST', `${A}/trade`, { actionType: 'ORDER_CANCEL', orderId }, `cancel ${name}`);
  step(`cancel ${name}`, tradeDone(c), JSON.stringify(c.json).slice(0, 200));
  const v = await confirmOrderAbsent(orderId, `verify ${name} absent`);
  step(`${name} absent after cancellation`, v.ok, v.detail);
  if (!tradeDone(c) || !v.ok || !placed) {
    console.error('Check pending orders AND positions in MT5 before another run.'); finish();
  }
  const p = await api('GET', `${A}/positions?refreshTerminalState=true`, null, `check ${name} did not fill`);
  const noFill = p.ok && Array.isArray(p.json) && !p.json.some(x => x.symbol === MT_SYMBOL);
  step(`${name} did not become a position`, noFill, noFill ? 'no new position' : 'Check MT5: order may have filled.');
  if (!noFill) finish();
}

// Reconcile an orphan from an earlier run WITHOUT creating a new order.
// Never cancel an unrelated ticket and never assume an absent ticket was cancelled.
{
  const r = await api('GET', `${A}/orders?refreshTerminalState=true`, null, 'read open orders');
  if (!r.ok || !Array.isArray(r.json)) {
    step('read open orders', false, JSON.stringify(r.json).slice(0, 200)); finish();
  }
  if (cancelOnly) {
    const order = r.json.find(o => String(o.id) === cancelOrderId);
    if (!order) {
      const p = await api('GET', `${A}/positions?refreshTerminalState=true`, null, 'check if ticket became a position');
      const filled = (Array.isArray(p.json) ? p.json : []).some(x => String(x.id) === cancelOrderId);
      step('target pending limit located', false, filled
        ? `Ticket ${cancelOrderId} is now an OPEN POSITION. Check/close it in MT5; no new order sent.`
        : `Ticket ${cancelOrderId} is not pending. Check MT5 Positions and History; no new order sent.`);
      finish();
    }
    const ours = order.type === 'ORDER_TYPE_BUY_LIMIT' && order.symbol === MT_SYMBOL;
    step('target pending limit located', ours,
      `ticket=${order.id} type=${order.type} symbol=${order.symbol} price=${order.openPrice} lots=${order.volume}`);
    if (!ours) finish();
    const c = await api('POST', `${A}/trade`, { actionType: 'ORDER_CANCEL', orderId: cancelOrderId }, 'cancel old limit order');
    step('broker acknowledged ORDER_CANCEL', tradeDone(c), JSON.stringify(c.json).slice(0, 200));
    const v = await confirmOrderAbsent(cancelOrderId, 'verify old order absent');
    step('verify old order absent', v.ok, v.detail);
    if (v.ok) {
      const p = await api('GET', `${A}/positions?refreshTerminalState=true`, null, 'check old limit did not fill');
      const positions = Array.isArray(p.json) ? p.json.filter(x => x.symbol === MT_SYMBOL).map(x => x.id) : [];
      step('no open symbol position after cleanup', p.ok && Array.isArray(p.json) && !positions.length,
        `open ${MT_SYMBOL} positions=${positions.join(',') || 'none'}; check MT5 if any remain`);
    }
    finish();  // cancellation-only mode NEVER proceeds to new trades
  }
  const p = await api('GET', `${A}/positions?refreshTerminalState=true`, null, 'read open positions');
  if (!p.ok || !Array.isArray(p.json)) {
    step('read open positions', false, JSON.stringify(p.json).slice(0, 200)); finish();
  }
  const pending = r.json.filter(o => o.symbol === MT_SYMBOL).map(o => o.id);
  const positions = p.json.filter(x => x.symbol === MT_SYMBOL).map(x => x.id);
  step('clean demo symbol before test', !pending.length && !positions.length,
    `pending=${pending.join(',') || 'none'} positions=${positions.join(',') || 'none'}`);
  if (pending.length || positions.length) finish();
}

// ── 2. balance / margin ────────────────────────────────────────────────────
let acctInfo = null;
{
  const r = await api('GET', `${A}/account-information`, null, 'account information');
  acctInfo = r.json;
  const infoOk = r.ok && Number.isFinite(acctInfo?.balance) && Number.isFinite(acctInfo?.freeMargin)
    && acctInfo.freeMargin > 0 && acctInfo.currency === 'USD';  // RISK_USD is a USD POC budget
  step('account information', infoOk,
    r.ok ? `balance=${acctInfo?.balance} equity=${acctInfo?.equity} freeMargin=${acctInfo?.freeMargin} currency=${acctInfo?.currency}` : JSON.stringify(r.json).slice(0, 200));
  if (!infoOk) finish(); // no test trades without known funds/currency
}

// ── 3. live symbol spec ────────────────────────────────────────────────────
let spec = null, specOk = false;
{
  const r = await api('GET', `${A}/symbols/${encodeURIComponent(MT_SYMBOL)}/specification`, null, 'symbol spec');
  spec = r.ok && r.json && !Array.isArray(r.json) ? r.json : null;
  specOk = !!spec && [spec.contractSize, spec.tickSize, spec.minVolume, spec.maxVolume, spec.volumeStep]
    .every(n => Number.isFinite(n) && n > 0)
    && spec.maxVolume >= spec.minVolume
    && Number.isInteger(spec.digits) && spec.digits >= 0 && spec.digits <= 8;
  step('symbol spec usable for sizing', specOk,
    specOk ? `contractSize=${spec.contractSize} tickSize=${spec.tickSize} min=${spec.minVolume} max=${spec.maxVolume} step=${spec.volumeStep} digits=${spec.digits}`
      : JSON.stringify(r.json).slice(0, 200));
}

// ── 4. quote + §8A sizing math on real data ────────────────────────────────
let quote = null, sizing = null;
{
  const r = await api('GET', `${A}/symbols/${encodeURIComponent(MT_SYMBOL)}/current-price`, null, 'quotes');
  quote = r.json;
  const quoteOk = r.ok && Number.isFinite(quote?.bid) && quote.bid > 0
    && Number.isFinite(quote?.ask) && quote.ask > 0
    && Number.isFinite(quote?.lossTickValue) && quote.lossTickValue > 0;
  // MetaApi REST returns tickSize/volume limits in /specification, but the
  // account-currency LOSS tick value in /current-price (not in the spec).
  step('live quote + loss tick value', quoteOk,
    r.ok ? `bid=${quote?.bid} ask=${quote?.ask} lossTickValue=${quote?.lossTickValue}` : JSON.stringify(r.json).slice(0, 200));
  if (!specOk || !quoteOk) {
    step('sizing math on real broker data', false, 'Spec or account-currency lossTickValue missing; NO orders sent.'); finish();
  }
  const entry = quote.ask;
  const slDistance = entry * 0.002;                       // POC synthetic SL: 0.2% away
  const ticks = slDistance / spec.tickSize;
  const lossPerLot = ticks * quote.lossTickValue;
  const rawLots = RISK_USD / lossPerLot;
  // Always round DOWN; never silently clamp UP to the broker minimum.
  const lots = Number((Math.floor(rawLots / spec.volumeStep + 1e-10) * spec.volumeStep).toFixed(8));
  const canSize = Number.isFinite(lossPerLot) && lossPerLot > 0 && Number.isFinite(lots)
    && lots >= spec.minVolume && lots <= spec.maxVolume && lots * lossPerLot <= RISK_USD + 1e-8;
  step('sizing math on real broker data', canSize,
    `riskBudget=$${RISK_USD} SL dist=${slDistance.toFixed(4)} loss/lot=$${lossPerLot.toFixed(2)} rawLots=${rawLots.toFixed(4)} → ${lots}; min-lot planned loss=$${(spec.minVolume * lossPerLot).toFixed(2)} (POC trades min-lot per §17); contractSize×tickSize=${(spec.contractSize * spec.tickSize).toFixed(4)} (expected tick value per lot if USD-quoted) vs lossTickValue=${quote.lossTickValue}`);
  if (!canSize) finish();   // min lot unaffordable or broker limits unsatisfiable
  sizing = { entry, slDistance, ticks, lossPerLot, rawLots, lots };
}

// ── 5. min-lot market order with SL/TP + idempotency comment ───────────────
let positionId = null, fillInfo = null;
{
  const entry = sizing.entry;
  const sl = +(entry * 0.998).toFixed(spec.digits);
  const tp = +(entry * 1.004).toFixed(spec.digits);
  const plannedLoss = (entry - sl) / spec.tickSize * quote.lossTickValue * spec.minVolume;
  if (!(sl > 0 && sl < quote.bid && tp > entry && Number.isFinite(plannedLoss)
    && plannedLoss > 0 && plannedLoss <= RISK_USD + 1e-8)) {
    step('market min-lot risk gate', false, `planned loss=$${plannedLoss}; risk budget=$${RISK_USD}. No order sent.`); finish();
  }
  console.log(`    market BUY min-lot=${spec.minVolume} SL=${sl} TP=${tp} planned loss=$${plannedLoss.toFixed(2)} (budget=$${RISK_USD})`);
  const r = await api('POST', `${A}/trade`, {
    actionType: 'ORDER_TYPE_BUY', symbol: MT_SYMBOL, volume: spec.minVolume,
    stopLoss: sl, takeProfit: tp, comment: idem,
  }, 'place market BUY');
  const closedMkt = [132, 10018].includes(r.json?.numericCode)
    || /market (?:is )?closed|invalid session/i.test(r.json?.message || '');
  if (closedMkt) {
    step('place market BUY', false, 'Market closed; a real fill is required for this POC. Rerun when open.'); finish();
  }
  positionId = r.json?.positionId ?? r.json?.orderId;
  step('place market BUY', tradeDone(r) && !!positionId, JSON.stringify(r.json).slice(0, 300));
  if (!tradeDone(r) || !positionId) {
    console.error('Order outcome not verified. Check MT5 for an open position BEFORE rerunning.'); finish();
  }
  for (let i = 0; i < 6 && !fillInfo; i++) {
    await sleep(2);
    const pr = await api('GET', `${A}/positions?refreshTerminalState=true`, null, 'poll positions');
    fillInfo = (Array.isArray(pr.json) ? pr.json : []).find(p => String(p.id) === String(positionId)) || null;
  }
  step('position visible (fill confirmed)', !!fillInfo,
    fillInfo ? `lots=${fillInfo.volume} openPrice=${fillInfo.openPrice} slippageVsQuotedAsk=${(fillInfo.openPrice - entry).toFixed(spec.digits)} profit=${fillInfo.profit}` : 'no position found; will attempt close by broker ticket');
  // POC-1 U4: reconcile by the idempotency comment ALONE (no ticket), as an unknown-state lookup must.
  const lookup = await api('GET', `${A}/positions?refreshTerminalState=true`, null, 'lookup by idempotency comment');
  const byComment = Array.isArray(lookup.json) ? lookup.json.filter(x => x.comment === idem) : [];
  step('idempotency comment lookup finds exactly our position (U4)',
    lookup.ok && byComment.length === 1 && String(byComment[0].id) === String(positionId),
    `matches=${byComment.length} ids=${byComment.map(x => x.id).join(',') || 'none'} brokerComment=${JSON.stringify(byComment[0]?.brokerComment)}`);
}

// ── 5b. broker P&L vs spec math (U3: lot / tick-value / currency semantics) ──
// Read-only and NON-blocking: a failed check is recorded, and the position is still closed below.
if (fillInfo) {
  const sym = encodeURIComponent(MT_SYMBOL);
  const qa = await api('GET', `${A}/symbols/${sym}/current-price`, null, 'pnl check: quote A');
  const pp = await api('GET', `${A}/positions?refreshTerminalState=true`, null, 'pnl check: positions');
  const qb = await api('GET', `${A}/symbols/${sym}/current-price`, null, 'pnl check: quote B');
  const pos = Array.isArray(pp.json) ? pp.json.find(x => String(x.id) === String(positionId)) : null;
  const numbers = [qa.json?.bid, qb.json?.bid, qa.json?.lossTickValue, qa.json?.profitTickValue,
    pos?.openPrice, pos?.volume, pos?.unrealizedProfit, pos?.currentTickValue];
  if (!(qa.ok && qb.ok && pp.ok && pos && numbers.every(Number.isFinite))) {
    step('broker P&L matches spec math', false, 'could not read quotes or position fields; position is still closed below');
  } else {
    // BUY floating P&L is measured at the bid; which tick value applies depends on the direction of the move.
    const move = qa.json.bid - pos.openPrice;
    const tickValue = move >= 0 ? qa.json.profitTickValue : qa.json.lossTickValue;
    const expected = move / spec.tickSize * tickValue * pos.volume;
    // Quotes A and B bracket the positions read; allow for price drift between them.
    const drift = Math.abs(qb.json.bid - qa.json.bid) / spec.tickSize
      * Math.max(qa.json.lossTickValue, qa.json.profitTickValue) * pos.volume;
    const tol = 0.05 + drift;
    const diff = pos.unrealizedProfit - expected;
    step('broker P&L matches spec math', Math.abs(diff) <= tol,
      `broker unrealizedProfit=$${pos.unrealizedProfit.toFixed(4)} expected=$${expected.toFixed(4)} |diff|=$${Math.abs(diff).toFixed(4)} tol=$${tol.toFixed(4)}; bid ${qa.json.bid}→${qb.json.bid}; quote tickValue=${tickValue} vs position currentTickValue=${pos.currentTickValue}`);
  }
}

// ── 6. close the position ──────────────────────────────────────────────────
{
  const r = await api('POST', `${A}/trade`, { actionType: 'POSITION_CLOSE_ID', positionId }, 'close position');
  step('close position', tradeDone(r), JSON.stringify(r.json).slice(0, 200));
  if (!tradeDone(r)) {
    console.error('Close not acknowledged. Check MT5 before running more trades.'); finish();
  }
  let gone = false;
  for (let i = 0; i < 4; i++) {
    if (i) await sleep(2);
    const p = await api('GET', `${A}/positions?refreshTerminalState=true`, null, 'verify position closed');
    if (!p.ok || !Array.isArray(p.json)) {
      step('position absent after close', false, 'Cannot read positions; check MT5.'); finish();
    }
    if (!p.json.some(x => String(x.id) === String(positionId))) { gone = true; break; }
  }
  step('position absent after close', gone, gone ? `ticket ${positionId} closed` : `ticket ${positionId} still open; check MT5.`);
  if (!gone || !fillInfo) finish();
}

// ── 7. away-from-market pending orders: limit AND stop (§17 U1) → cancel → verify ──
await pendingCycle('BUY_LIMIT', 'ORDER_TYPE_BUY_LIMIT', +(quote.bid * 0.98).toFixed(spec.digits), 'lim');
await pendingCycle('BUY_STOP', 'ORDER_TYPE_BUY_STOP', +(quote.ask * 1.02).toFixed(spec.digits), 'stp');

// ── 8. deliberate broker rejection (bad symbol) ────────────────────────────
{
  const r = await api('POST', `${A}/trade`, {
    actionType: 'ORDER_TYPE_BUY', symbol: 'NTT_INVALID_SYMBOL_XYZ', volume: 0.01, comment: `${idem}-bad`,
  }, 'deliberate bad-symbol order');
  // HTTP 429/API validation is NOT proof of a broker rejection.
  const rejected = r.ok && Number.isInteger(r.json?.numericCode)
    && ![10008, 10009].includes(r.json.numericCode) && /symbol/i.test(r.json?.message || '');
  step('broker rejection captured with code', rejected,
    `HTTP ${r.status} code=${r.json?.numericCode} msg=${JSON.stringify(r.json?.message || '').slice(0, 120)}`);
}

finish();

function finish() {
  const passed = results.filter(r => r.ok).length;
  const summary = { runAt: new Date().toISOString(), durationMs: Date.now() - t0, idemKey: idem, passed, total: results.length, results };
  const logFile = new URL(`./poc1-run-${Date.now()}.json`, import.meta.url).pathname;
  writeFileSync(logFile, JSON.stringify({ summary, rawLog: log }, null, 2));
  const heading = cancelOnly ? 'POC-1 CLEANUP RESULT' : 'POC-1 RESULT';
  console.log(`\n${'═'.repeat(60)}\n${heading}: ${passed}/${results.length} steps passed\nRaw log: ${logFile}\n${'═'.repeat(60)}`);
  process.exit(results.every(r => r.ok) ? 0 : 1);
}
