// Pure, offline-only policy checks for a future POC-1 harness. No MetaApi imports or I/O.
// A passing unit test here is NOT proof of provider/broker behavior.

function requireEvidence(condition, message) {
  if (!condition) throw new Error(message);
}

export function selectExactDemoAccount(accounts, { id, login, server, platform }) {
  requireEvidence(Array.isArray(accounts), 'account list unavailable');
  requireEvidence(id && login && server && platform === 'mt5' && /demo/i.test(server), 'exact MT5 demo identity required');
  const matches = accounts.filter(a => String(a.id ?? a._id) === String(id));
  requireEvidence(matches.length === 1 && String(matches[0].login) === String(login)
    && matches[0].server === server && String(matches[0].platform).toLowerCase() === platform,
  'missing, duplicate or mismatched demo account');
  requireEvidence(matches[0].state === 'DEPLOYED', 'account is not already deployed; no creation/deployment permitted');
  return matches[0];
}

export function validateQuote(quote, { side, now, maxAgeMs, maxFutureSkewMs, currencyValidated }) {
  requireEvidence(['buy', 'sell'].includes(side), 'direction required');
  requireEvidence(Number.isSafeInteger(maxAgeMs) && maxAgeMs > 0
    && Number.isSafeInteger(maxFutureSkewMs) && maxFutureSkewMs >= 0,
  'explicitly approved quote age and clock-skew limits required');
  requireEvidence(currencyValidated === true, 'deposit-currency tick value/conversion not validated');
  requireEvidence(Number.isFinite(now) && Number.isFinite(quote?.bid) && quote.bid > 0
    && Number.isFinite(quote.ask) && quote.ask >= quote.bid
    && Number.isFinite(quote.lossTickValue) && quote.lossTickValue > 0,
  'directional quote or account-currency loss tick value unavailable');
  requireEvidence(typeof quote.time === 'string'
    && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(quote.time),
  'quote time must include an explicit timezone');
  const at = Date.parse(quote.time);
  requireEvidence(Number.isFinite(at) && at <= now + maxFutureSkewMs && now - at <= maxAgeMs,
    'quote is missing, stale or from the future');
  return { entry: side === 'buy' ? quote.ask : quote.bid, at, ageMs: now - at };
}

export function classifyTradeResponse({ httpOk, numericCode, transportError } = {}) {
  // HTTP status is not execution status. Unknown includes dropped/timeout/429/5xx.
  if (transportError || !httpOk || !Number.isInteger(numericCode) || numericCode === -11)
    return 'unknown';
  if (numericCode === 10010) return 'partial_unverified';
  if (numericCode === 10008 || numericCode === 10009) return 'acknowledged_unverified';
  if (numericCode === -10) return 'unknown'; // require corroboration of never-delivered status
  return 'broker_rejected'; // correlated provider/broker code; exposure still needs reconciliation
}

export function protectionStatus(object, expected) {
  if (!object || !expected || !Number.isFinite(expected.stopLoss) || expected.stopLoss <= 0
    || !Number.isFinite(expected.takeProfit) || expected.takeProfit <= 0
    || !Number.isFinite(object.stopLoss) || !Number.isFinite(object.takeProfit)) return 'unverified';
  // Strict broker readback; any normalizing/tick tolerance must first be broker-validated.
  return object.stopLoss === expected.stopLoss && object.takeProfit === expected.takeProfit
    ? 'confirmed' : 'mismatched';
}

export function reconcileCanceledOrder({ order, deals, positions, historyComplete, synchronized } = {}) {
  if (!historyComplete || !synchronized || !order || !Array.isArray(deals) || !Array.isArray(positions))
    return 'unknown';
  // Caller must separately prove history completeness and links. An empty active list alone is not proof.
  if (order.state !== 'ORDER_STATE_CANCELED'
    || !Number.isFinite(order.volume) || order.volume <= 0
    || !Number.isFinite(order.currentVolume) || order.currentVolume !== order.volume)
    return 'unknown';
  if (deals.some(d => String(d.orderId) === String(order.id))
    || positions.some(p => String(p.id) === String(order.positionId) || String(p.orderId) === String(order.id)))
    return 'unknown';
  // Candidate only: public docs do NOT prove negative-history finality on this broker.
  // Never use this result to authorize a replacement or lift a fence.
  return 'candidate_zero_fill_unverified';
}

export function incidentScope({ dependencyFailure = false, affectedDependencyAccounts = [],
  isolationEvidence } = {}) {
  if (dependencyFailure) return { level: 'shared_service',
    blockedAccounts: affectedDependencyAccounts.length ? affectedDependencyAccounts : null }; // null = unresolved dependency map; block all
  const e = isolationEvidence;
  if (e && ['exposure', 'sharedMargin', 'accountState', 'calculations'].every(k =>
    e[k]?.verified === true && typeof e[k].source === 'string' && e[k].source.length > 0
    && Number.isFinite(Date.parse(e[k].at)))) return { level: 'setup' };
  return { level: 'account' }; // unknown inputs always widen
}

export function mayAcceptFutureSignal({ reconciled, protection, zeroExposureAuthoritative,
  ownerAuthorized, staleIntentCleared } = {}) {
  // This never dispatches or replays anything; a separately arriving signal must be validated afresh.
  return reconciled === true && ownerAuthorized === true && staleIntentCleared === true
    && (protection === 'confirmed' || (protection === 'not_applicable' && zeroExposureAuthoritative === true));
}
