// POC-1 state machine. No network or credentials. One case per invocation.
// Provider-dependent finality is NEVER inferred from a single REST snapshot.
import { randomUUID } from 'node:crypto';
import { classifyTradeResponse, protectionStatus, selectExactDemoAccount, validateQuote } from './metaapi-safety.mjs';

export const CASES = Object.freeze({
  E01: { action: 'ORDER_TYPE_BUY', family: 'MARKET', side: 'buy' },
  E02: { action: 'ORDER_TYPE_SELL', family: 'MARKET', side: 'sell' },
  E03: { action: 'ORDER_TYPE_BUY_LIMIT', family: 'LIMIT', side: 'buy' },
  E04: { action: 'ORDER_TYPE_SELL_LIMIT', family: 'LIMIT', side: 'sell' },
  E05: { action: 'ORDER_TYPE_BUY_STOP', family: 'STOP', side: 'buy' },
  E06: { action: 'ORDER_TYPE_SELL_STOP', family: 'STOP', side: 'sell' },
  E07: { action: 'ORDER_TYPE_BUY_STOP_LIMIT', family: 'STOP_LIMIT', side: 'buy' },
  E08: { action: 'ORDER_TYPE_SELL_STOP_LIMIT', family: 'STOP_LIMIT', side: 'sell' },
});

const invariant = (condition, message) => { if (!condition) throw new Error(message); };
const complete = snap => {
  invariant(snap && ['orders','positions','deals','historyOrders'].every(k => Array.isArray(snap[k])), 'incomplete broker snapshot');
  return snap;
};
const near = (a, b, tick) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < tick / 10;

export function entitlement(spec, test) {
  invariant(test && spec && Array.isArray(spec.allowedOrderTypes), 'symbol entitlement unavailable');
  if (!spec.allowedOrderTypes.includes(`SYMBOL_ORDER_${test.family}`)) return 'UNSUPPORTED';
  if (['SYMBOL_TRADE_MODE_DISABLED', 'SYMBOL_TRADE_MODE_CLOSEONLY'].includes(spec.tradeMode)) return 'UNSUPPORTED';
  if (spec.tradeMode === 'SYMBOL_TRADE_MODE_LONGONLY' && test.side === 'sell') return 'UNSUPPORTED';
  if (spec.tradeMode === 'SYMBOL_TRADE_MODE_SHORTONLY' && test.side === 'buy') return 'UNSUPPORTED';
  invariant(spec.tradeMode === 'SYMBOL_TRADE_MODE_FULL' || (spec.tradeMode === 'SYMBOL_TRADE_MODE_LONGONLY' && test.side === 'buy')
    || (spec.tradeMode === 'SYMBOL_TRADE_MODE_SHORTONLY' && test.side === 'sell'), 'trade mode not verified');
  invariant(spec.allowedOrderTypes.includes('SYMBOL_ORDER_SL') && spec.allowedOrderTypes.includes('SYMBOL_ORDER_TP'), 'broker does not advertise both protections');
  return 'SUPPORTED';
}

export function sessionOpen(spec, brokerNow) {
  invariant(typeof brokerNow === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(brokerNow), 'broker-local time unavailable');
  const weekday = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'][new Date(brokerNow).getUTCDay()];
  const sessions = spec.tradeSessions?.[weekday];
  invariant(Array.isArray(sessions), 'broker session schedule unavailable');
  const clock = brokerNow.slice(11, 19).replaceAll(':', '.');
  return sessions.some(x => typeof x.from === 'string' && typeof x.to === 'string'
    && clock >= x.from.slice(0, 8).replaceAll(':', '.') && clock < x.to.slice(0, 8).replaceAll(':', '.'));
}

export function buildRequest(test, spec, quote, { riskUsd, symbol, maxQuoteAgeMs, maxFutureSkewMs,
  now, brokerOffsetMinutes, currencyValidated }) {
  invariant(entitlement(spec, test) === 'SUPPORTED', 'entry type not supported');
  invariant(Number.isInteger(brokerOffsetMinutes) && brokerOffsetMinutes >= -720 && brokerOffsetMinutes <= 840, 'verified broker UTC offset required');
  invariant(sessionOpen(spec, new Date(now + brokerOffsetMinutes * 60000).toISOString()), 'broker trade session closed or unverified');
  invariant(symbol === spec.symbol, 'symbol mismatch');
  invariant(Number.isFinite(spec.tickSize) && spec.tickSize > 0 && Number.isFinite(spec.point) && spec.point > 0
    && Number.isFinite(spec.stopsLevel) && spec.stopsLevel >= 0 && Number.isFinite(spec.freezeLevel) && spec.freezeLevel >= 0
    && Number.isInteger(spec.digits) && spec.digits >= 0 && spec.digits <= 8 && Number.isFinite(spec.minVolume)
    && spec.minVolume > 0 && spec.minVolume <= spec.maxVolume && spec.volumeStep > 0
    && Number.isFinite(riskUsd) && riskUsd > 0, 'contract/risk/stops input missing');
  const q = validateQuote(quote, { side: test.side, maxAgeMs: maxQuoteAgeMs, maxFutureSkewMs, now, currencyValidated });
  // Quote brokerTime is broker-local; do not silently interpret it as UTC.
  const local = new Date(q.at + brokerOffsetMinutes * 60000).toISOString().slice(0, 19).replace('T', ' ');
  invariant(typeof quote.brokerTime === 'string' && quote.brokerTime.slice(0, 19) === local,
    'broker quote time/UTC offset not validated');
  const round = n => Number((Math.round(n / spec.tickSize) * spec.tickSize).toFixed(spec.digits));
  // Historical 2% away / 0.2% SL / 0.4% TP: candidate only. Broker constraints
  // and risk are rechecked AFTER rounding; if unsafe, refuse instead of clamping.
  const sign = test.side === 'buy' ? 1 : -1;
  const pending = test.family !== 'MARKET';
  const direction = test.family === 'LIMIT' ? -sign : sign;
  const anchor = test.side === 'buy' ? quote.ask : quote.bid;
  const trigger = round(anchor * (1 + direction * 0.02));
  const limit = test.family === 'STOP_LIMIT' ? round(trigger * (1 - sign * 0.002)) : trigger;
  const entry = pending ? limit : q.entry;
  const sl = round(entry * (1 - sign * 0.002));
  const tp = round(entry * (1 + sign * 0.004));
  const minimum = (spec.stopsLevel + spec.freezeLevel + 1) * spec.point;
  invariant(entry > 0 && sl > 0 && tp > 0 && (entry - sl) * sign > 0 && (tp - entry) * sign > 0,
    'invalid rounded protection prices');
  invariant(Math.abs(entry - sl) > minimum && Math.abs(tp - entry) > minimum,
    'broker minimum stop/freeze distance not met');
  if (pending) invariant((trigger - anchor) * direction > minimum
    && (test.family !== 'STOP_LIMIT' || (trigger - limit) * sign >= 0), 'pending entry/stop-limit relationship unsafe');
  const loss = Math.abs(entry - sl) / spec.tickSize * quote.lossTickValue * spec.minVolume;
  invariant(Number.isFinite(loss) && loss > 0 && loss <= riskUsd, 'minimum lot exceeds POC downside risk guard');
  const request = { actionType: test.action, symbol, volume: spec.minVolume, stopLoss: sl, takeProfit: tp };
  if (pending) request.openPrice = trigger;
  if (test.family === 'STOP_LIMIT') request.stopLimitPrice = limit.toFixed(spec.digits); // documented string
  return { request, entry, trigger, limit, loss, quotedAt: quote.time };
}

// A *planned* pending-only SL tightening; never an emergency fix or volume change.
export function buildSafePendingModification(order, expected, spec, quote) {
  invariant(verifyPending(order, expected, spec) === 'confirmed', 'original pending state/protection unverified');
  const side = expected.request.actionType.includes('_BUY_') ? 'buy' : 'sell';
  const sign = side === 'buy' ? 1 : -1;
  const sl = Number((expected.request.stopLoss + sign * spec.tickSize).toFixed(spec.digits));
  const market = side === 'buy' ? quote.bid : quote.ask;
  const minDistance = (spec.stopsLevel + spec.freezeLevel + 1) * spec.point;
  invariant(Number.isFinite(market) && Math.abs(order.openPrice - market) > minDistance
    && (order.openPrice - sl) * sign > minDistance && (expected.request.takeProfit - order.openPrice) * sign > minDistance,
  'amendment unsafe/frozen or cannot tighten without violating stops');
  const request = { actionType: 'ORDER_MODIFY', orderId: String(order.id), openPrice: order.openPrice,
    stopLoss: sl, takeProfit: expected.request.takeProfit };
  if (expected.request.stopLimitPrice) request.stopLimitPrice = expected.request.stopLimitPrice;
  return request;
}

export function verifyPending(order, expected, spec) {
  if (!order || String(order.id) !== String(expected.ticket) || order.symbol !== expected.request.symbol
    || order.type !== expected.request.actionType || order.state !== 'ORDER_STATE_PLACED') return 'unverified';
  if (!near(order.volume, expected.request.volume, spec.volumeStep) || !near(order.currentVolume, order.volume, spec.volumeStep)) return 'unverified';
  if (!near(order.openPrice, expected.trigger, spec.tickSize)
    || (expected.request.stopLimitPrice && !near(order.stopLimitPrice, Number(expected.request.stopLimitPrice), spec.tickSize))) return 'mismatched';
  return protectionStatus(order, expected.request);
}

export function verifyPosition(position, expected, spec) {
  if (!position || String(position.id) !== String(expected.positionId) || position.symbol !== expected.request.symbol
    || !near(position.volume, expected.request.volume, spec.volumeStep)) return 'unverified';
  return protectionStatus(position, expected.request);
}

// Never returns PASS: broker-specific finality and MT5 terminal corroboration
// require a later human-reviewed evidence package.
export async function runCase({ caseId, config, adapter, journal, now = () => Date.now() }) {
  const test = CASES[caseId];
  invariant(test, 'unknown case');
  let sent = false;
  try {
    const accounts = await adapter.accounts();
    const account = selectExactDemoAccount(accounts, config.identity);
    invariant(String(account.id ?? account._id) === String(config.identity.id), 'wrong account');
    const [info, spec, quote, baseline] = await Promise.all([
      adapter.accountInfo(), adapter.spec(config.symbol), adapter.quote(config.symbol), adapter.snapshot(null),
    ]);
    invariant(info?.currency === 'USD' && spec?.profitCurrency === 'USD', 'account currency/conversion not validated');
    complete(baseline);
    invariant(Array.isArray(baseline.orders) && Array.isArray(baseline.positions)
      && !baseline.orders.some(o => o.symbol === config.symbol)
      && !baseline.positions.some(p => p.symbol === config.symbol), 'existing symbol exposure or unreadable baseline');
    const allowed = entitlement(spec, test);
    if (allowed === 'UNSUPPORTED') {
      await journal.record({ event: 'unsupported', caseId, allowedOrderTypes: spec.allowedOrderTypes, tradeMode: spec.tradeMode });
      return { status: 'UNSUPPORTED', caseId };
    }
    const plan = buildRequest(test, spec, quote, { ...config, now: now(), currencyValidated: true });
    plan.request.comment = `ntt-${randomUUID().slice(0, 8)}`; // correlation hint, never idempotency proof
    invariant(info.freeMargin > 0 && Number.isFinite(info.freeMargin), 'margin unavailable');
    // A separate validated broker margin check is mandatory at execution; not inferred from leverage.
    invariant(await adapter.marginOk(plan.request, info), 'broker margin unverified or insufficient');
    await journal.record({ event: 'pre_send_intent', caseId, accountId: account.id ?? account._id,
      request: plan.request, quotedAt: plan.quotedAt, loss: plan.loss, quote: { bid: quote.bid, ask: quote.ask },
      spec: { tickSize: spec.tickSize, minVolume: spec.minVolume, volumeStep: spec.volumeStep }, at: new Date(now()).toISOString() });
    sent = true; // from here even a thrown transport error is UNKNOWN, never replayed
    const r = await adapter.trade(plan.request);
    await journal.record({ event: 'send_result', caseId, httpOk: r.httpOk, numericCode: r.json?.numericCode ?? null,
      orderId: r.json?.orderId ?? null, positionId: r.json?.positionId ?? null, transportError: !!r.transportError });
    const classification = classifyTradeResponse({ httpOk: r.httpOk, numericCode: r.json?.numericCode, transportError: r.transportError });
    if (classification === 'broker_rejected') return { status: 'FAIL', reason: 'correlated rejection; exposure readback still required', caseId };
    if (classification !== 'acknowledged_unverified') return { status: 'UNKNOWN', reason: classification, caseId };
    const ticket = r.json?.orderId;
    const positionId = r.json?.positionId;
    if (!ticket && !positionId) return { status: 'UNKNOWN', reason: 'no broker ticket', caseId };
    const expected = { ...plan, ticket, positionId };
    const snapshot = complete(await adapter.snapshot(ticket));
    if (test.family !== 'MARKET') {
      const order = snapshot.orders?.find(o => String(o.id) === String(ticket));
      const status = verifyPending(order, expected, spec);
      await journal.record({ event: 'pending_readback', caseId, ticket, status,
        order: order && { id: order.id, state: order.state, volume: order.volume, currentVolume: order.currentVolume,
          openPrice: order.openPrice, stopLimitPrice: order.stopLimitPrice, stopLoss: order.stopLoss, takeProfit: order.takeProfit } });
      if (status !== 'confirmed') {
        // Only a uniquely identified, fully unfilled pending ticket can be
        // given its ONE planned cleanup cancel. Never cancel a residual/fill.
        const safeIdentity = order && String(order.id) === String(ticket) && order.symbol === config.symbol
          && order.type === test.action && order.state === 'ORDER_STATE_PLACED'
          && Number.isFinite(order.volume) && order.volume > 0 && order.currentVolume === order.volume;
        if (safeIdentity && !snapshot.positions.some(p => p.symbol === config.symbol)
          && !snapshot.deals.some(d => String(d.orderId) === String(ticket))) {
          const check = complete(await adapter.snapshot(ticket));
          const same = check.orders.find(o => String(o.id) === String(ticket));
          if (same && same.symbol === config.symbol && same.type === test.action
            && same.state === 'ORDER_STATE_PLACED' && same.volume === order.volume
            && same.currentVolume === same.volume && !check.positions.some(p => p.symbol === config.symbol)
            && !check.deals.some(d => String(d.orderId) === String(ticket))) {
            await journal.record({ event: 'cancel_intent', caseId, ticket, reason: 'unverified_protection' });
            const cleanup = await adapter.trade({ actionType: 'ORDER_CANCEL', orderId: String(ticket) });
            await journal.record({ event: 'cancel_result', caseId, ticket, httpOk: cleanup.httpOk,
              numericCode: cleanup.json?.numericCode ?? null, transportError: !!cleanup.transportError });
          }
        }
        return { status: 'UNKNOWN', reason: 'protection unverified; reconcile planned cleanup before any further trade', caseId, ticket };
      }
      if (snapshot.positions.some(p => p.symbol === config.symbol)
        || snapshot.deals.some(d => String(d.orderId) === String(ticket)))
        return { status: 'UNKNOWN', reason: 'unexpected fill or partial exposure', caseId, ticket };
      if (config.enableModification) {
        const fresh = await adapter.quote(config.symbol);
        validateQuote(fresh, { side: test.side, maxAgeMs: config.maxQuoteAgeMs,
          maxFutureSkewMs: config.maxFutureSkewMs, now: now(), currencyValidated: true });
        const modify = buildSafePendingModification(order, expected, spec, fresh);
        await journal.record({ event: 'modify_intent', caseId, ticket, request: modify });
        const changed = await adapter.trade(modify);
        await journal.record({ event: 'modify_result', caseId, ticket, httpOk: changed.httpOk,
          numericCode: changed.json?.numericCode ?? null, transportError: !!changed.transportError });
        if (classifyTradeResponse({ httpOk: changed.httpOk, numericCode: changed.json?.numericCode,
          transportError: changed.transportError }) !== 'acknowledged_unverified')
          return { status: 'UNKNOWN', reason: 'modification failed or ambiguous; read-only reconcile', caseId, ticket };
        expected.request = { ...expected.request, stopLoss: modify.stopLoss };
        const revision = complete(await adapter.snapshot(ticket));
        const revisedOrder = revision.orders.find(o => String(o.id) === String(ticket));
        const revisionStatus = verifyPending(revisedOrder, expected, spec);
        await journal.record({ event: 'modify_readback', caseId, ticket, status: revisionStatus,
          stopLoss: revisedOrder?.stopLoss, takeProfit: revisedOrder?.takeProfit,
          currentVolume: revisedOrder?.currentVolume });
        if (revisionStatus !== 'confirmed' || revision.deals.some(d => String(d.orderId) === String(ticket))
          || revision.positions.some(p => p.symbol === config.symbol))
          return { status: 'UNKNOWN', reason: 'modified order/protection/residual unverified', caseId, ticket };
      }
      // Re-read immediately before cleanup. No partial-residual cancellation.
      const before = complete(await adapter.snapshot(ticket));
      const live = before.orders?.find(o => String(o.id) === String(ticket));
      if (verifyPending(live, expected, spec) !== 'confirmed'
        || before.deals?.some(d => String(d.orderId) === String(ticket))
        || before.positions?.some(p => p.symbol === config.symbol))
        return { status: 'UNKNOWN', reason: 'fill/cancel race or incomplete pre-cancel state', caseId, ticket };
      await journal.record({ event: 'cancel_intent', caseId, ticket });
      const cancel = await adapter.trade({ actionType: 'ORDER_CANCEL', orderId: String(ticket) });
      await journal.record({ event: 'cancel_result', caseId, ticket, httpOk: cancel.httpOk,
        numericCode: cancel.json?.numericCode ?? null, transportError: !!cancel.transportError });
      if (classifyTradeResponse({ httpOk: cancel.httpOk, numericCode: cancel.json?.numericCode,
        transportError: cancel.transportError }) !== 'acknowledged_unverified')
        return { status: 'UNKNOWN', reason: 'cancel not conclusively acknowledged', caseId, ticket };
    } else {
      const position = snapshot.positions?.find(p => String(p.id) === String(positionId));
      const status = verifyPosition(position, expected, spec);
      await journal.record({ event: 'position_readback', caseId, positionId, status,
        position: position && { id: position.id, volume: position.volume, stopLoss: position.stopLoss, takeProfit: position.takeProfit } });
      const actualLoss = position && Number.isFinite(position.openPrice)
        ? Math.abs(position.openPrice - plan.request.stopLoss) / spec.tickSize * quote.lossTickValue * position.volume : NaN;
      if (status !== 'confirmed' || !positionId || !(actualLoss > 0 && actualLoss <= config.riskUsd))
        return { status: 'UNKNOWN', reason: 'market fill/protection/actual risk unverified', caseId };
      await journal.record({ event: 'close_intent', caseId, positionId });
      const close = await adapter.trade({ actionType: 'POSITION_CLOSE_ID', positionId: String(positionId) });
      await journal.record({ event: 'close_result', caseId, positionId, httpOk: close.httpOk,
        numericCode: close.json?.numericCode ?? null, transportError: !!close.transportError });
      if (classifyTradeResponse({ httpOk: close.httpOk, numericCode: close.json?.numericCode,
        transportError: close.transportError }) !== 'acknowledged_unverified')
        return { status: 'UNKNOWN', reason: 'close not conclusively acknowledged', caseId, positionId };
    }
    const finalState = complete(await adapter.snapshot(ticket));
    await journal.record({ event: 'final_candidate', caseId, ticket, positionId,
      openOrders: finalState.orders?.filter(o => o.symbol === config.symbol).map(o => o.id),
      positions: finalState.positions?.filter(p => p.symbol === config.symbol).map(p => p.id),
      historyStates: finalState.historyOrders?.map(o => ({ id: o.id, state: o.state, volume: o.volume, currentVolume: o.currentVolume })),
      linkedDeals: finalState.deals?.filter(d => String(d.orderId) === String(ticket)).map(d => ({ id: d.id, volume: d.volume })) });
    return { status: 'REVIEW_REQUIRED', reason: 'REST evidence is not proof of finality; reconcile and independently review', caseId, ticket, positionId };
  } catch (e) {
    await journal.record({ event: sent ? 'incident_unknown' : 'preflight_refused', caseId, reason: String(e.message).slice(0, 160) });
    return { status: sent ? 'UNKNOWN' : 'NO_SEND', reason: e.message, caseId };
  }
}