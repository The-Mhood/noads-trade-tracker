import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { CASES, entitlement, sessionOpen, buildRequest, runCase } from './poc1-engine.mjs';
import { MetaApiAdapter } from './poc1-metaapi-adapter.mjs';

const now = Date.parse('2026-10-12T12:00:00.000Z');
const identity = { id: 'demo-only', login: '123', server: 'MetaQuotes-Demo', platform: 'mt5' };
const spec = { symbol: 'XAUUSD', profitCurrency: 'USD', marginCurrency: 'USD', tickSize: 0.01,
  point: 0.01, stopsLevel: 10, freezeLevel: 10, minVolume: 0.01, maxVolume: 100, volumeStep: 0.01,
  digits: 2, initialMargin: 100, tradeMode: 'SYMBOL_TRADE_MODE_FULL',
  allowedOrderTypes: ['SYMBOL_ORDER_MARKET','SYMBOL_ORDER_LIMIT','SYMBOL_ORDER_STOP',
    'SYMBOL_ORDER_STOP_LIMIT','SYMBOL_ORDER_SL','SYMBOL_ORDER_TP'],
  tradeSessions: { MONDAY: [{ from: '00:00:00.000', to: '23:59:59.999' }] } };
const quote = { bid: 2649, ask: 2650, lossTickValue: 1, time: new Date(now - 1000).toISOString(), brokerTime: '2026-10-12 11:59:59.000' };
const config = { identity, symbol: 'XAUUSD', riskUsd: 10, maxQuoteAgeMs: 10000,
  maxFutureSkewMs: 2000, brokerOffsetMinutes: 0 };

function fixture(caseId, options = {}) {
  const entry = CASES[caseId];
  const events = [], trades = [];
  let snapshots = 0, quoteCalls = 0;
  let orderRequest;
  let modifiedSL;
  const journal = { record: row => { events.push(row); } };
  const adapter = {
    accounts: async () => [options.account ?? { ...identity, state: 'DEPLOYED', connectionStatus: 'CONNECTED' }],
    accountInfo: async () => ({ currency: 'USD', freeMargin: 1000 }),
    spec: async () => options.spec ?? spec,
    quote: async () => {
      quoteCalls++;
      if (options.staleModifyQuote && quoteCalls >= 2)
        return { ...(options.quote ?? quote), time: new Date(now - 60000).toISOString() };
      return options.quote ?? quote;
    },
    marginOk: async () => options.marginOk ?? true,
    trade: async body => {
      trades.push(body);
      if (trades.length === 1) {
        orderRequest = body;
        if (options.sendError) throw Error('transport lost after sending');
        if (options.reject) return { httpOk: true, json: { numericCode: 10021 } };
        if (options.timeout) return { httpOk: false, transportError: true, transportErrorDetail: 'ETIMEDOUT' };
        return { httpOk: true, json: { numericCode: 10009, orderId: 't1', positionId: 'p1' } };
      }
      if (body.actionType === 'ORDER_MODIFY') {
        if (options.modifyTimeout) return { httpOk: false, transportError: true, transportErrorDetail: 'ETIMEDOUT' };
        modifiedSL = body.stopLoss; return { httpOk: true, json: { numericCode: 10009 } };
      }
      if (options.cancelTimeout) return { httpOk: false, transportError: true, transportErrorDetail: 'ETIMEDOUT' };
      return { httpOk: true, json: { numericCode: 10009 } };
    },
    snapshot: async ticket => {
      snapshots++;
      const empty = { orders: [], positions: [], deals: [], historyOrders: [] };
      if (!ticket) {
        // Before any send this is the flat-baseline read; after a rejection it is the readback.
        if (trades.length >= 1 && options.rejectExposure)
          return { ...empty, positions: [{ id: 'p9', symbol: 'XAUUSD', type: 'POSITION_TYPE_BUY',
            volume: .01, stopLoss: 1, takeProfit: 2, openPrice: quote.ask }] };
        if (options.unrelatedExposure)
          return { ...empty, orders: [{ id: 'x1', symbol: 'EURUSD', type: 'ORDER_TYPE_BUY_LIMIT',
            state: 'ORDER_STATE_PLACED', volume: .1, currentVolume: .1 }] };
        return empty;
      }
      const modSent = trades.some(t => t.actionType === 'ORDER_MODIFY');
      if (snapshots >= (entry.family === 'MARKET' ? 3 : (options.enableModification && modSent ? 5 : 4))) {
        if (options.finalDeals && entry.family === 'MARKET')
          return { ...empty, historyOrders: [{ id: 't1', state: 'ORDER_STATE_FILLED', volume: .01, currentVolume: .01 }],
            deals: [{ id: 'd1', orderId: 't1', positionId: 'p1', volume: .01 },
              { id: 'd2', orderId: 'close-t2', positionId: 'p1', volume: .01 }] };
        return empty;
      }
      if (entry.family === 'MARKET') return { orders: [], positions: [{ id: 'p1', symbol: 'XAUUSD',
        type: options.wrongPositionType
          ? (entry.side === 'buy' ? 'POSITION_TYPE_SELL' : 'POSITION_TYPE_BUY')
          : (entry.side === 'buy' ? 'POSITION_TYPE_BUY' : 'POSITION_TYPE_SELL'),
        volume: .01, stopLoss: orderRequest.stopLoss, takeProfit: orderRequest.takeProfit,
        openPrice: options.badOpenPrice ? quote.ask + 100 : (entry.side === 'buy' ? quote.ask : quote.bid) }], deals: [], historyOrders: [] };
      return { orders: [{ id: 't1', symbol: 'XAUUSD', type: entry.action, state: 'ORDER_STATE_PLACED',
        volume: .01, currentVolume: options.partial && snapshots >= 3 ? .005 : .01,
        openPrice: orderRequest.openPrice, stopLimitPrice: Number(orderRequest.stopLimitPrice),
        stopLoss: options.mismatch ? orderRequest.stopLoss + 1 : (modifiedSL ?? orderRequest.stopLoss),
        takeProfit: orderRequest.takeProfit }], positions: [], deals: [], historyOrders: [] };
    },
  };
  return { adapter, journal, events, trades };
}

test('eight distinct types: conservative one-send, SL/TP readback, one cleanup, never auto-PASS', async () => {
  for (const id of Object.keys(CASES)) {
    const f = fixture(id);
    const r = await runCase({ caseId: id, config, ...f, now: () => now });
    assert.equal(r.status, 'REVIEW_REQUIRED', `${id}: ${r.reason}`);
    assert.equal(f.trades.length, 2, id);
    assert.equal(f.trades[0].actionType, CASES[id].action);
    assert.ok(f.trades[0].stopLoss > 0 && f.trades[0].takeProfit > 0);
    assert.ok(f.trades[0].comment.length <= 26);
    assert.equal(f.trades[1].actionType, CASES[id].family === 'MARKET' ? 'POSITION_CLOSE_ID' : 'ORDER_CANCEL');
    if (CASES[id].family === 'STOP_LIMIT') assert.match(f.trades[0].stopLimitPrice, /^\d+\.\d{2}$/);
    assert.equal(f.events[0].event, 'pre_send_intent');
    assert.equal(f.events.at(-1).event, 'final_candidate');
  }
});

test('planned pending SL-tightening modification is journaled and independently read back before cancellation', async () => {
  const f = fixture('E03', { enableModification: true });
  const result = await runCase({ caseId: 'E03', config: { ...config, enableModification: true }, ...f, now: () => now });
  assert.equal(result.status, 'REVIEW_REQUIRED');
  assert.deepEqual(f.trades.map(t => t.actionType), ['ORDER_TYPE_BUY_LIMIT','ORDER_MODIFY','ORDER_CANCEL']);
  assert.ok(f.trades[1].stopLoss > f.trades[0].stopLoss);
  assert.equal(f.events.find(e => e.event === 'modify_readback').status, 'confirmed');
});

test('no send on unsupported, wrong account, disconnected, unrelated exposure, missing margin, stale quote, closed session or unaffordable min lot', async () => {
  const variants = [
    { spec: { ...spec, allowedOrderTypes: spec.allowedOrderTypes.filter(x => x !== 'SYMBOL_ORDER_STOP_LIMIT') }, id: 'E07', status: 'UNSUPPORTED' },
    { account: { ...identity, id: 'other', state: 'DEPLOYED', connectionStatus: 'CONNECTED' }, id: 'E03', status: 'NO_SEND' },
    { account: { ...identity, state: 'DEPLOYED', connectionStatus: 'DISCONNECTED' }, id: 'E03', status: 'NO_SEND' },
    { unrelatedExposure: true, id: 'E03', status: 'NO_SEND' },
    { marginOk: false, id: 'E03', status: 'NO_SEND' },
    { quote: { ...quote, time: new Date(now - 60000).toISOString() }, id: 'E03', status: 'NO_SEND' },
    { spec: { ...spec, tradeSessions: { MONDAY: [] } }, id: 'E03', status: 'NO_SEND' },
  ];
  for (const { id, status, ...opts } of variants) {
    const f = fixture(id, opts), r = await runCase({ caseId: id, config, ...f, now: () => now });
    assert.equal(r.status, status, r.reason);
    assert.equal(f.trades.length, 0);
  }
  assert.throws(() => buildRequest(CASES.E03, spec, quote, { ...config, riskUsd: 0.01, now, currencyValidated: true }), /risk/);
});

test('timeout, crash, rejection, mismatch, partial/cancel race and cancel timeout never cause a blind extra POST', async () => {
  for (const [opts, expectedTrades, expectedStatus] of [
    [{ timeout: true }, 1, 'UNKNOWN'], [{ sendError: true }, 1, 'UNKNOWN'],
    [{ reject: true }, 1, 'FAIL'], [{ mismatch: true }, 2, 'UNKNOWN'],
    [{ partial: true }, 1, 'UNKNOWN'], [{ cancelTimeout: true }, 2, 'UNKNOWN'],
  ]) {
    const f = fixture('E03', opts);
    const r = await runCase({ caseId: 'E03', config, ...f, now: () => now });
    assert.equal(r.status, expectedStatus, JSON.stringify(opts));
    assert.equal(f.trades.length, expectedTrades, JSON.stringify(opts));
    if (expectedStatus === 'UNKNOWN') assert.ok(f.events.some(e => ['incident_unknown','send_result','pending_readback','cancel_result'].includes(e.event)));
    if (opts.timeout) {
      // The ambiguous-send cause must stay diagnosable in the journal, never hidden.
      assert.equal(f.events.find(e => e.event === 'send_result').transportErrorDetail, 'ETIMEDOUT');
    }
  }
});

test('sessions spanning broker midnight are recognized; ordinary windows unchanged', () => {
  const wrap = { ...spec, tradeSessions: { MONDAY: [{ from: '22:00:00.000', to: '02:00:00.000' }] } };
  assert.equal(sessionOpen(wrap, '2026-10-12T23:00:00.000Z'), true);
  assert.equal(sessionOpen(wrap, '2026-10-12T01:59:59.000Z'), true);
  assert.equal(sessionOpen(wrap, '2026-10-12T02:00:00.000Z'), false);
  assert.equal(sessionOpen(wrap, '2026-10-12T12:00:00.000Z'), false);
  assert.equal(sessionOpen(spec, '2026-10-12T12:00:00.000Z'), true);
  assert.throws(() => sessionOpen(spec, 'not-a-timestamp'));
});

test('rejection readback: FAIL only with consistent state; contradicting exposure becomes UNKNOWN', async () => {
  const a = fixture('E03', { reject: true });
  const r1 = await runCase({ caseId: 'E03', config, ...a, now: () => now });
  assert.equal(r1.status, 'FAIL');
  assert.equal(a.trades.length, 1);
  const rb = a.events.find(e => e.event === 'post_reject_readback');
  assert.ok(rb && rb.orders.length === 0 && rb.positions.length === 0, 'readback evidence missing');
  const b = fixture('E01', { reject: true, rejectExposure: true });
  const r2 = await runCase({ caseId: 'E01', config, ...b, now: () => now });
  assert.equal(r2.status, 'UNKNOWN');
  assert.equal(b.trades.length, 1); // never close contradicting exposure automatically
  assert.ok(b.events.some(e => e.event === 'post_reject_readback' && e.positions.length === 1));
});

test('market readback verifies direction and journals closing deals linked by position', async () => {
  const a = fixture('E01', { wrongPositionType: true });
  const r1 = await runCase({ caseId: 'E01', config, ...a, now: () => now });
  assert.equal(r1.status, 'UNKNOWN');
  assert.equal(a.trades.length, 1); // no close sent on contradictory direction
  assert.equal(a.events.find(e => e.event === 'position_readback').status, 'mismatched');
  const b = fixture('E01', { finalDeals: true });
  const r2 = await runCase({ caseId: 'E01', config, ...b, now: () => now });
  assert.equal(r2.status, 'REVIEW_REQUIRED');
  const fc = b.events.find(e => e.event === 'final_candidate');
  assert.deepEqual(fc.linkedDeals.map(d => d.id), ['d1', 'd2']); // open deal by ticket + close deal by position
});

test('unsafe planned modification is skipped and journaled; the planned cancel still runs', async () => {
  const f = fixture('E03', { enableModification: true, staleModifyQuote: true });
  const r = await runCase({ caseId: 'E03', config: { ...config, enableModification: true }, ...f, now: () => now });
  assert.equal(r.status, 'REVIEW_REQUIRED');
  assert.deepEqual(f.trades.map(t => t.actionType), ['ORDER_TYPE_BUY_LIMIT', 'ORDER_CANCEL']); // no ORDER_MODIFY sent
  const skip = f.events.find(e => e.event === 'modification_skipped');
  assert.ok(skip && /stale/i.test(skip.reason), 'skip must be journaled with its reason');
});

test('adapter preserves the transport error cause for ambiguous sends', async () => {
  const adapter = new MetaApiAdapter({ accountId: 'a', token: 't',
    provisioningHost: 'https://mt-provisioning-api-v1.agiliumtrade.ai',
    tradeHost: 'https://mt-client-api-v1.new-york.agiliumtrade.ai',
    fetchImpl: async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ETIMEDOUT' } }); } });
  const r = await adapter.trade({ actionType: 'ORDER_CANCEL', orderId: '1' });
  assert.equal(r.transportError, true);
  assert.equal(r.transportErrorDetail, 'ETIMEDOUT');
});

test('modification timeout, broker-time mismatch and excessive market risk fail closed', async () => {
  const a = fixture('E03', { enableModification: true, modifyTimeout: true });
  const r1 = await runCase({ caseId: 'E03', config: { ...config, enableModification: true }, ...a, now: () => now });
  assert.equal(r1.status, 'UNKNOWN');
  assert.deepEqual(a.trades.map(t => t.actionType), ['ORDER_TYPE_BUY_LIMIT', 'ORDER_MODIFY']);
  const b = fixture('E01', { badOpenPrice: true });
  const r2 = await runCase({ caseId: 'E01', config, ...b, now: () => now });
  assert.equal(r2.status, 'UNKNOWN');
  assert.equal(b.trades.length, 1); // never auto-close unexpectedly high-risk exposure
  const c = fixture('E03', { quote: { ...quote, brokerTime: '2026-10-12 12:30:00.000' } });
  const r3 = await runCase({ caseId: 'E03', config, ...c, now: () => now });
  assert.equal(r3.status, 'NO_SEND');
  assert.equal(c.trades.length, 0);
});

test('public support must also be advertised by the exact symbol; stop-limit cannot be inferred', () => {
  assert.equal(entitlement(spec, CASES.E07), 'SUPPORTED');
  assert.equal(entitlement({ ...spec, allowedOrderTypes: ['SYMBOL_ORDER_MARKET'] }, CASES.E07), 'UNSUPPORTED');
});

test('adapter rejects arbitrary hosts and uses exact account endpoint rather than list', async () => {
  assert.throws(() => new MetaApiAdapter({ accountId: 'a', token: 'x', provisioningHost: 'https://example.com',
    tradeHost: 'https://mt-client-api-v1.new-york.agiliumtrade.ai' }), /unapproved/);
  const urls = [];
  const adapter = new MetaApiAdapter({ accountId: 'designated', token: 'synthetic',
    provisioningHost: 'https://mt-provisioning-api-v1.agiliumtrade.ai',
    tradeHost: 'https://mt-client-api-v1.new-york.agiliumtrade.ai',
    fetchImpl: async url => { urls.push(url); return { ok: true, status: 200, text: async () => '{"id":"designated"}' }; } });
  assert.equal((await adapter.accounts())[0].id, 'designated');
  assert.match(urls[0], /\/accounts\/designated$/);
  assert.doesNotMatch(urls[0], /\/accounts$/);
});

test('offline CLI plan needs no token or provider', () => {
  const r = spawnSync(process.execPath, [new URL('poc1-runner.mjs', import.meta.url).pathname, '--plan'],
    { encoding: 'utf8', env: {}, timeout: 5000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(Object.keys(JSON.parse(r.stdout)).length, 8);
});