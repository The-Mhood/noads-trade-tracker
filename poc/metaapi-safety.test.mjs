import test from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { selectExactDemoAccount, validateQuote, classifyTradeResponse, protectionStatus,
  reconcileCanceledOrder, incidentScope, mayAcceptFutureSignal } from './metaapi-safety.mjs';

const identity = { id: 'expected', login: '123', server: 'MetaQuotes-Demo', platform: 'mt5' };
const account = { ...identity, state: 'DEPLOYED' };
test('exact demo account only: no sole-account fallback or billable create/deploy', () => {
  assert.deepEqual(selectExactDemoAccount([account], identity), account);
  for (const list of [[], [{ ...account, id: 'other' }], [{ ...account, login: '456' }],
    [{ ...account, platform: 'mt4' }], [{ ...account, state: 'UNDEPLOYED' }], [account, account]]) {
    assert.throws(() => selectExactDemoAccount(list, identity));
  }
  assert.throws(() => selectExactDemoAccount([account], { ...identity, server: 'Real' }));
});

test('directional quote rejects unknown currency, timestamp, stale/future and bad tick value', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  const quote = { bid: 2650, ask: 2651, lossTickValue: 1, time: '2026-10-10T11:59:59Z' };
  const limits = { side: 'buy', now, maxAgeMs: 2000, maxFutureSkewMs: 0, currencyValidated: true };
  assert.equal(validateQuote(quote, limits).entry, 2651);
  assert.equal(validateQuote(quote, { ...limits, side: 'sell' }).entry, 2650);
  for (const q of [{ ...quote, time: undefined }, { ...quote, time: '2026-10-10T11:59:57Z' },
    { ...quote, time: '2026-10-10T12:00:01Z' }, { ...quote, lossTickValue: 0 },
    { ...quote, ask: 2649 }, { ...quote, time: '2026-10-10T11:59:59' }]) assert.throws(() => validateQuote(q, limits));
  assert.throws(() => validateQuote(quote, { ...limits, currencyValidated: false }));
  assert.throws(() => validateQuote(quote, { ...limits, maxAgeMs: undefined }));
});

test('HTTP success is not trade finality; partial and ambiguous outcomes stay uncertain', () => {
  for (const r of [{ httpOk: false, numericCode: 10009 }, { httpOk: true },
    { httpOk: true, numericCode: -11 }, { transportError: 'timeout' },
    { httpOk: false, numericCode: 429 }, { httpOk: true, numericCode: -10 }])
    assert.equal(classifyTradeResponse(r), 'unknown');
  assert.equal(classifyTradeResponse({ httpOk: true, numericCode: 10009 }), 'acknowledged_unverified');
  assert.equal(classifyTradeResponse({ httpOk: true, numericCode: 10010 }), 'partial_unverified');
  assert.equal(classifyTradeResponse({ httpOk: true, numericCode: 10021 }), 'broker_rejected');
});

test('SL/TP readback is strict, N/A only from separate authoritative zero-exposure resolution', () => {
  const expected = { stopLoss: 2640, takeProfit: 2670 };
  assert.equal(protectionStatus({ ...expected }, expected), 'confirmed');
  assert.equal(protectionStatus({ stopLoss: 0, takeProfit: 2670 }, expected), 'mismatched');
  assert.equal(protectionStatus({ stopLoss: 2640 }, expected), 'unverified');
  assert.equal(protectionStatus(null, expected), 'unverified');
});

test('cancellation needs final state, equal original/residual volume, synchronized complete linked history', () => {
  const base = { order: { id: 'o1', volume: 0.01, currentVolume: 0.01, state: 'ORDER_STATE_CANCELED' },
    deals: [], positions: [], historyComplete: true, synchronized: true };
  assert.equal(reconcileCanceledOrder(base), 'candidate_zero_fill_unverified');
  for (const b of [{ ...base, historyComplete: false }, { ...base, synchronized: false },
    { ...base, order: { ...base.order, state: 'ORDER_STATE_REQUEST_CANCEL' } },
    { ...base, order: { ...base.order, currentVolume: 0.005 } },
    { ...base, deals: [{ orderId: 'o1', volume: 0.005 }] },
    { ...base, positions: [{ id: 'p1', orderId: 'o1' }] }])
    assert.equal(reconcileCanceledOrder(b), 'unknown');
});

const evidence = Object.fromEntries(['exposure', 'sharedMargin', 'accountState', 'calculations']
  .map(k => [k, { verified: true, source: 'broker readback', at: '2026-10-10T12:00:00Z' }]));
test('fence widens absent objective isolation; shared outages block dependent accounts only', () => {
  assert.deepEqual(incidentScope(), { level: 'account' });
  assert.deepEqual(incidentScope({ isolationEvidence: evidence }), { level: 'setup' });
  assert.deepEqual(incidentScope({ isolationEvidence: { ...evidence, sharedMargin: undefined } }), { level: 'account' });
  assert.deepEqual(incidentScope({ dependencyFailure: true, affectedDependencyAccounts: ['A', 'B'] }),
    { level: 'shared_service', blockedAccounts: ['A', 'B'] });
});

test('resolution, confirmed protection and separate owner release never dispatch a trade', () => {
  const release = { reconciled: true, protection: 'confirmed', ownerAuthorized: true, staleIntentCleared: true };
  assert.equal(mayAcceptFutureSignal(release), true);
  assert.equal(mayAcceptFutureSignal({ ...release, protection: 'unverified' }), false);
  assert.equal(mayAcceptFutureSignal({ ...release, ownerAuthorized: false }), false);
  assert.equal(mayAcceptFutureSignal({ ...release, staleIntentCleared: false }), false);
  assert.equal(mayAcceptFutureSignal({ ...release, protection: 'unverified', zeroExposureAuthoritative: true }), false);
  assert.equal(mayAcceptFutureSignal({ ...release, protection: 'not_applicable', zeroExposureAuthoritative: true }), true);
});

test('legacy MetaApi scripts fail before credentials or provider calls in all old/new modes', () => {
  for (const [script, args] of [['metaapi-exec.mjs', []], ['metaapi-exec.mjs', ['--execute-demo']],
    ['metaapi-exec.mjs', ['--cancel-order', '123']], ['debug-list.mjs', []]]) {
    const r = spawnSync(process.execPath, [new URL(script, import.meta.url).pathname, ...args],
      { env: {}, encoding: 'utf8', timeout: 5000 });
    assert.equal(r.status, 2, `${script} ${args.join(' ')}: ${r.stderr}`);
    assert.match(r.stderr, /BLOCKED/);
    assert.doesNotMatch(r.stderr, /Missing poc\/\.env\.local|fetch failed/);
  }
});