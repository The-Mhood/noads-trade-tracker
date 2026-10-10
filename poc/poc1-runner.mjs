#!/usr/bin/env node
// POC-1 guarded entrypoint. One MT5 demo case at a time; no automatic suite/retry.
import { readFileSync, existsSync, readdirSync, openSync, writeSync, fsyncSync, closeSync, mkdirSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { CASES, runCase } from './poc1-engine.mjs';
import { MetaApiAdapter } from './poc1-metaapi-adapter.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const dir = join(root, '.poc1-journals');
const [mode, arg, extra] = process.argv.slice(2);
const usage = 'Usage: node poc/poc1-runner.mjs --plan | --run-case E01..E08 | --status | --reconcile <journal-name> | --review <journal-name> <evidence-file>';
if (mode === '--plan' && !arg) {
  console.log(JSON.stringify(CASES, null, 2));
  process.exit(0);
}
if (mode === '--status' && !arg) {
  for (const f of existsSync(dir) ? readdirSync(dir).filter(x => /^poc1-.*\.jsonl$/.test(x)) : []) {
    const rows = readFileSync(join(dir, f), 'utf8').trim().split('\n').map(x => JSON.parse(x));
    console.log(`${f}\t${rows.at(-1)?.event ?? 'empty'}\t${rows[0]?.caseId ?? '?'}`);
  }
  process.exit(0);
}
if (!['--run-case', '--reconcile', '--review'].includes(mode) || !arg
  || (mode === '--run-case' && (!CASES[arg] || extra))
  || (mode === '--reconcile' && extra) || (mode === '--review' && !extra)) {
  console.error(usage); process.exit(2);
}
if (mode !== '--run-case' && (!/^poc1-[a-zA-Z0-9-]+\.jsonl$/.test(arg) || !existsSync(join(dir, arg)))) {
  console.error('Invalid or missing journal'); process.exit(2);
}
const journals = () => existsSync(dir) ? readdirSync(dir).filter(x => /^poc1-.*\.jsonl$/.test(x)) : [];
const rowsFor = f => readFileSync(join(dir, f), 'utf8').trim().split('\n').map(x => JSON.parse(x));
const recordTo = (path, row) => {
  const fd = openSync(path, 'a', 0o600);
  try { writeSync(fd, JSON.stringify({ ...row, at: new Date().toISOString() }) + '\n'); fsyncSync(fd); }
  finally { closeSync(fd); }
};

if (mode === '--review') {
  const rows = rowsFor(arg), last = rows.at(-1), result = [...rows].reverse().find(x => x.event === 'case_result');
  if (!result || !['case_result', 'read_only_reconciliation'].includes(last.event)) {
    console.error('Missing completed case or already reviewed; do not clear an incident blindly.'); process.exit(2);
  }
  const evidence = JSON.parse(readFileSync(extra, 'utf8'));
  if (evidence.caseId !== result.caseId || evidence.brokerFinalityConfirmed !== true
    || evidence.zeroExposureConfirmed !== true || !evidence.evidenceRef || !evidence.reviewer
    || !['PASS','FAIL','UNVERIFIED'].includes(evidence.caseVerdict)
    || (evidence.caseVerdict === 'PASS' && (result.status !== 'REVIEW_REQUIRED'
      || evidence.protectionConfirmed !== true || evidence.linkedHistoryVerified !== true
      || !rows.some(x => x.event === 'final_candidate' && !x.openOrders?.length && !x.positions?.length)))) {
    console.error('Independent evidence/incident resolution insufficient to clear the fence.'); process.exit(2);
  }
  recordTo(join(dir, arg), { event: 'reviewed', caseId: result.caseId, verdict: evidence.caseVerdict,
    evidenceRef: String(evidence.evidenceRef).slice(0, 120), reviewer: String(evidence.reviewer).slice(0, 80) });
  console.log('Human evidence review recorded; only the referenced case may be considered, not POC-1 overall PASS.');
  process.exit(0);
}

const envPath = join(root, '.env.local');
if (!existsSync(envPath)) { console.error('No local demo configuration; provider-dependent operation blocked. Continue offline.'); process.exit(2); }
const env = Object.fromEntries(readFileSync(envPath, 'utf8').split('\n').map(l => l.trim())
  .filter(l => l && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const identity = { id: env.POC_APPROVED_ACCOUNT_ID, login: env.MT_LOGIN, server: env.MT_SERVER,
  platform: String(env.MT_PLATFORM || '').toLowerCase() };
if (!env.METAAPI_TOKEN || !identity.id || !identity.login || identity.platform !== 'mt5'
  || !/demo/i.test(identity.server || '') || env.MT_SYMBOL !== 'XAUUSD'
  || !env.METAAPI_PROVISIONING_HOST || !env.METAAPI_TRADE_HOST) {
  console.error('Exact existing MT5 demo identity, token, XAUUSD and approved MetaApi hosts required; no call made.'); process.exit(2);
}
const config = { identity, symbol: env.MT_SYMBOL, riskUsd: Number(env.POC_RISK_USD || 10),
  maxQuoteAgeMs: 10000, maxFutureSkewMs: 2000, enableModification: true, brokerOffsetMinutes: Number(env.POC_BROKER_OFFSET_MINUTES) };
if (!Number.isInteger(config.brokerOffsetMinutes) || env.POC_BROKER_OFFSET_MINUTES === undefined
  || !(config.riskUsd > 0 && config.riskUsd <= 10)) {
  console.error('Verified broker UTC offset and POC risk <= $10 required; no call made.'); process.exit(2);
}
let adapter;
try { adapter = new MetaApiAdapter({ accountId: identity.id, token: env.METAAPI_TOKEN,
  provisioningHost: env.METAAPI_PROVISIONING_HOST, tradeHost: env.METAAPI_TRADE_HOST }); }
catch { console.error('Approved HTTPS MetaApi hosts invalid; no call made.'); process.exit(2); }

if (mode === '--reconcile') {
  const rows = rowsFor(arg);
  const ticket = rows.find(x => x.event === 'send_result')?.orderId;
  // No ticket: account-wide read-only search only. Comment cannot establish uniqueness.
  try {
    const accounts = await adapter.accounts();
    if (String(accounts[0]?.id ?? accounts[0]?._id) !== String(identity.id)) throw new Error('account mismatch');
    const state = await adapter.snapshot(ticket ?? null); // only GETs; does NOT lift fence
    recordTo(join(dir, arg), { event: 'read_only_reconciliation', caseId: rows[0]?.caseId, ticket,
      orders: state.orders.filter(o => String(o.id) === String(ticket)).map(o => ({ id: o.id, state: o.state, currentVolume: o.currentVolume, stopLoss: o.stopLoss, takeProfit: o.takeProfit })),
      positions: state.positions.filter(p => p.symbol === config.symbol).map(p => ({ id: p.id, volume: p.volume, stopLoss: p.stopLoss, takeProfit: p.takeProfit })),
      deals: state.deals.filter(d => String(d.orderId) === String(ticket)).map(d => ({ id: d.id, volume: d.volume })) });
    console.log('Read-only reconciliation recorded; status remains UNKNOWN until broker-linked human review.');
  } catch (e) { console.error(`Read-only reconciliation incomplete: ${e.message}`); process.exitCode = 1; }
 } else {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lockPath = join(dir, '.execution.lock');
  let lock;
  try {
    lock = openSync(lockPath, 'wx', 0o600);
    writeSync(lock, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }) + '\n');
    fsyncSync(lock);
  } catch {
    console.error('Another or interrupted execution holds the lock; do not clear it without reconciling all journals.');
    process.exit(2);
  }
  try {
    if (journals().some(f => rowsFor(f).at(-1)?.event !== 'reviewed')) {
      console.error('Unreviewed/UNKNOWN prior journal: stop new submissions and reconcile first.'); process.exitCode = 2;
    } else {
      const file = join(dir, `poc1-${Date.now()}-${randomUUID().slice(0, 8)}.jsonl`);
      const fd = openSync(file, 'wx', 0o600); // exclusive durable intent before any provider call
      writeSync(fd, JSON.stringify({ event: 'started', caseId: arg, at: new Date().toISOString() }) + '\n');
      fsyncSync(fd); closeSync(fd);
      const journal = { record: row => recordTo(file, row) };
      try {
        const result = await runCase({ caseId: arg, config, adapter, journal });
        journal.record({ event: 'case_result', ...result });
        if (result.status === 'UNSUPPORTED') journal.record({ event: 'reviewed', caseId: arg, verdict: 'UNSUPPORTED', evidenceRef: 'current broker symbol specification' });
        console.log(JSON.stringify({ result, journal: basename(file) }));
        process.exitCode = result.status === 'UNSUPPORTED' ? 0 : 1;
      } catch (e) {
        journal.record({ event: 'incident_unknown', caseId: arg, reason: String(e.message).slice(0, 160) });
        console.error('Incident: state UNKNOWN; no further sends. Reconcile read-only and notify owner.');
        process.exitCode = 1;
      }
    }
  } finally {
    closeSync(lock);
    unlinkSync(lockPath); // SIGKILL/crash leaves it in place for human reconciliation
  }
}
