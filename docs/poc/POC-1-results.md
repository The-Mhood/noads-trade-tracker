# POC-1 RESULTS — MetaApi end-to-end demo execution

**Date:** 2026-10-08 (status updated 2026-10-09) · **Verdict: OPEN — not closed; see §0** · Owner directive: docs/ARCHITECTURE.md §17 · Harness: `poc/metaapi-exec.mjs` @ `4b24073`

On 2026-10-08, all 22 harness steps passed on the owner's MetaQuotes-Demo account, the only complete run so far. That was a scoped pass, not a clean pass for U1: the gaps in §4.3 and §4.5–§4.7 need the read-only checks in §5 before Phase 1 relies on them. Phase 1 stays on hold until the owner accepts the verdict and gives explicit go-ahead (§9). The verdict has since changed to OPEN; see §0.

## 0. Status as of 2026-10-09 (read first)

- **Verdict: OPEN.** The 22/22 run of 2026-10-08 is the only complete run. It shows that the broker accepted each order we sent with its SL and TP. It does not show that the broker holds those stops, and it does not show pending orders in the MT5 Trade tab. Later runs on other accounts did not complete (§3B).
- **The owner's question** (can MetaApi and MT5 place BUY and SELL pending orders that carry their own SL and TP, and do those orders appear in MT5?):
  - BUY LIMIT and BUY STOP with SL and TP: accepted by the broker (numericCode 10009) and cancelled (10009) on the old account. Stored SL/TP was not read back. Visibility in MT5 while pending was not checked.
  - SELL pending orders: **not tested** on any account.
  - Current account: the market BUY was rejected by the broker (10021), so no pending order was placed on it.
- **MetaApi:** the old account and the London-region account are deleted. The current account is undeployed and disconnected. The owner's MetaApi balance is used up, and the owner does not want to spend more. An undeployed account still carries a small list charge until it is deleted (§8).
- **MT5 (owner report, 2026-10-09):** flat, with no open or pending positions or orders. The screenshot the owner sent showed History → Orders, not the Trade tab, so the Trade tab view is not yet confirmed.
- **Decision pending:** Option A (pause and record) or Option C (free manual MT5 test). See §9.
- **Nothing is running.** No MetaApi calls were made for this update.
- **Repository provenance (2026-10-09):** This result and its POC harness were merged from `arena/01a0e310-noads-trade-tracker` into `arena/5c731da5-noads-trade-tracker` with the owner's approval. The import involved no MetaApi or MT5 calls, did not rerun the harness, and does not change the OPEN verdict or authorize Phase 1.

## 1. What was tested

Real MetaApi REST calls against the owner's demo MT5 account, XAUUSD, minimum lot 0.01. The harness refuses any server whose name does not contain "demo".

- Account state (DEPLOYED), balance, equity, free margin, account currency.
- Live symbol specification and live quote, including the account-currency tick value.
- §8A-style sizing on those real values with a $10 risk budget.
- Market BUY 0.01 with SL and TP and an idempotency comment; fill confirmation; comment lookup (U4).
- Broker P&L against spec arithmetic (weak evidence, §4.3).
- Close by position ID.
- BUY_LIMIT and BUY_STOP placed 2% from quote: place, cancel, confirm absent, confirm no fill.
- Deliberate invalid-symbol order to capture a broker rejection code.

Stop and target follow the harness rule for BUY orders: SL = entry − 0.2%, TP = entry + 0.4%.

## 2. Method and evidence

- The owner ran `poc/metaapi-exec.mjs` on his Mac against live MetaApi and the demo account. The raw log (`poc/poc1-run-1791463442351.json`) is git-ignored on his machine; its timestamp is 2026-10-08 12:44 UTC.
- These results come only from the owner's run. The sandbox has no access to the owner's MetaApi token or account. Offline stubs and syntax checks test control flow only and are not evidence.
- Login, MetaApi account ID and token are deliberately not recorded in this repo.
- One run, one symbol, minimum lot only. Latency: trade calls 267–851 ms; reads 222–897 ms.

## 3. Results — 22/22 steps passed

| # | Step | Result | Values (owner's run) |
|---|---|---|---|
| 1 | list accounts | PASS | demo account found on MT_SERVER |
| 2 | account DEPLOYED | PASS | state DEPLOYED; region backup-new-york |
| 3 | clean demo symbol before test | PASS | no XAUUSD orders or positions |
| 4 | account information | PASS | balance, equity and free margin 99,999.58 USD |
| 5 | symbol spec usable for sizing | PASS | contractSize 100; tickSize 0.01; min 0.01; max 100; step 0.01; digits 2 |
| 6 | live quote + loss tick value | PASS | bid 4121.19; ask 4121.58; lossTickValue 1 |
| 7 | sizing math on real broker data | PASS | risk $10; SL distance 8.2432; loss/lot $824.32; rawLots 0.0121 → 0.01; min-lot planned loss $8.24 |
| 8 | place market BUY | PASS (10009) | 0.01 lot; SL 4113.34; TP 4138.07; ID 152740587160 |
| 9 | position visible (fill confirmed) | PASS | fill 4121.52 (−0.06 vs quoted ask) |
| 10 | idempotency comment lookup (U4) | PASS | exactly 1 position matched on `ntt-poc1-9becee07` |
| 11 | broker P&L vs spec math | PASS, weak (§4.3) | unrealizedProfit 0.15 vs expected 0.30; diff 0.15 vs tolerance 0.18 |
| 12 | close position (POSITION_CLOSE_ID) | PASS (10009) | — |
| 13 | position absent after close | PASS | — |
| 14 | place BUY_LIMIT | PASS (10009) | 4038.77; SL 4030.69; TP 4054.93; ID 152740587791; min-lot planned loss $8.08 |
| 15 | cancel BUY_LIMIT (ORDER_CANCEL) | PASS (10009) | — |
| 16 | BUY_LIMIT absent after cancel | PASS | — |
| 17 | BUY_LIMIT did not become a position | PASS | no new XAUUSD position |
| 18 | place BUY_STOP | PASS (10009) | 4204.01; SL 4195.60; TP 4220.83; ID 152740587899; min-lot planned loss $8.41 |
| 19 | cancel BUY_STOP (ORDER_CANCEL) | PASS (10009) | — |
| 20 | BUY_STOP absent after cancel | PASS | — |
| 21 | BUY_STOP did not become a position | PASS | no new XAUUSD position |
| 22 | broker rejection captured with code | PASS | invalid symbol → HTTP 200, numericCode 4301, "Unknown symbol" |

Planned losses in rows 8, 14 and 18 use the harness formula: (entry − SL) ÷ tickSize × lossTickValue × 0.01 lot.

## 3B. Later runs and account lifecycle

Only the first row below was a complete run. Account IDs and logins are deliberately not recorded here.

| Account (label used here) | What happened | Status now |
|---|---|---|
| Old backup-new-york demo account | The 22/22 run in §3. | Removed in MetaApi. It was missing from the owner's account list on 2026-10-08. Its order history cannot be read through the API. |
| Earlier London-region account (same demo login) | Reads timed out or returned HTTP 500 for about 40 minutes, with "not connected to broker yet". A market BUY returned HTTP 500 "Failed to execute a callable", so its outcome was UNKNOWN. The owner checked MT5 and found no position. | Deleted in MetaApi. |
| Current backup-new-york demo account (created 2026-10-08 18:34 UTC) | Steps 1–7 passed: account found, DEPLOYED, account information, symbol spec, live quote, sizing. Step 8 (market BUY 0.01 with SL and TP) was rejected by the broker with numericCode 10021, TRADE_RETCODE_PRICE_OFF ("no quotes"). Not filled. Raw log `poc1-run-1791496060527.json` (2026-10-08 21:47:40 UTC), on the owner's machine. | Undeployed and disconnected. MetaApi balance used up. |

- Steps 9–22 did not run on the current account, so no pending-order check has been run on it.
- The session notes say the harness was run twice on the current account. Only the first run's log is referenced here. See open item 8 in §5.

## 4. Findings and limitations

**4.1 Tick value is not in the REST symbol spec.** `/symbols/XAUUSD/specification` returns contractSize, tickSize, volume limits and digits, but no tick value. The loss tick value (account currency, per tick, per lot) comes from `/symbols/XAUUSD/current-price` as `lossTickValue`. In this run contractSize × tickSize = 1.0, and lossTickValue, profitTickValue and currentTickValue were all 1.0. ARCHITECTURE §8A assumes tick value is a broker spec field. That assumption is wrong for MetaApi REST (§7-A).

**4.2 HTTP status is not the broker outcome.** The broker outcome is `numericCode` in the response body: 10009 = done (open, close, pending placement, cancel); 10008 = placed (accepted by the harness). An invalid symbol returned HTTP 200 with numericCode 4301, "Unknown symbol". Request-level errors (for example HTTP 400 for `ORDER_DELETE`, §6) are not broker outcomes.

**4.3 Broker P&L check passed, but the evidence is weak.** The check reads quote A, the position and quote B, and assumes the position read falls inside the A–B bid range. The bid moved 4121.82 → 4121.69 during the check. The broker's unrealizedProfit of 0.15 implies a bid near 4121.67, which is below both quotes, so the bracket assumption did not hold. The expected value was 0.30. The check passed only because the tolerance (0.05 base + 0.13 drift = 0.18) covered the gap. Treat it as unverified until §5 item 3. The value-level evidence in §4.1 is stronger.

**4.4 Broker timestamps look offset.** `tradeExecutionTime` on the market BUY, both pending placements and the close response is exactly +3 h ahead of `tradeStartTime`, although both are labelled Z. Cancel responses agree with UTC. The likely cause is broker server time (UTC+3) labelled as UTC. Unverified (§5 item 4).

**4.5 Stored SL/TP not read back.** The broker accepted SL/TP on all three orders. The harness did not read the stored stopLoss/takeProfit on the position or on the pending orders. This is the most important open gap for U1, because risk control depends on the broker actually holding the stop (§5 items 1–2).

**4.6 Realized P&L not captured.** The close returned 10009 and the position disappeared, but no deal profit, commission or swap was fetched (§5 item 3).

**4.7 Pending-order comment lookup not tested.** The comment lookup queried positions only, so U4 is verified for positions only (§5 item 5).

**4.8 Fill vs quote.** One sample at minimum lot: fill 4121.52 against a quoted ask of 4121.58 (−0.06, favourable to a BUY). No slippage distribution exists.

**4.9 Unknown-state path not exercised.** No timeout or 429 occurred in the successful run. The harness records a network error as "outcome UNKNOWN" and stops, but that path has not been run against the broker.

**4.10 Rate-limit budget (documented, not stressed).** From MetaApi's rate-limiting page: per account 5,000 CPU credits per 10 s; per application 1,000 credits/s × deployed accounts; per shared server 2,000 credits/s (switchable via the `client-id` header); GET positions, orders, specification or current-price = 50 credits; POST /trade = 10 credits; history by time range = 75 + 0.65 per item. The run stayed well inside these limits. The earlier 429s came from the undefined-account-ID bug (§6), not from volume.

**4.11 Not covered by POC-1.** MT4; symbols other than XAUUSD; volumes above minimum; margin rejection; market-closed rejection (checked by the harness, never triggered); requotes, partial fills, stop/freeze-level rejections; real-money or prop-firm accounts; several accounts and fan-out; sustained load; server outage and reconnect.

**4.12 Broker "no quotes" (10021) on the current account; cause not established.** The harness read a live quote and sized the order before it sent the trade, so a quote existed at read time. Candidate causes, none tested: the XAUUSD session was closed when the order was sent; the terminal had not yet received ticks for the symbol; or the symbol was not synchronized in the terminal. Treat 10021 as a definitive broker rejection, and find the cause before any retry.

**4.13 An UNKNOWN outcome happened on a live account, not only in theory.** The London-region account returned HTTP 500 on a market BUY. Its outcome was known only because the owner checked MT5 by hand. This supports the UNKNOWN path and reconciliation by comment (§7-B). Comment lookup has been tested only for positions (§4.7), so reconciliation is still unproven.

**4.14 The harness can trade the wrong account and can create billed accounts.** (a) Account selection (around lines 100–110 of `poc/metaapi-exec.mjs`) adopts the only account on `MT_SERVER` even when its login differs from `MT_LOGIN`, and the run then trades that account. (b) If no account exists on `MT_SERVER`, a full run creates and deploys a new MetaApi account (around lines 118–170), which is billed. (c) `poc/.env.example` sets `MT_PLATFORM=mt4`. The POC runs on MT5, and the harness defaults to mt5 only when the variable is unset, so a copy of the template targets the wrong platform. Proposed fixes are in §7-J. None is applied.

## 5. Open items (updated 2026-10-09)

Items 1–4 need either the owner's MT5 History tab (only if that terminal still holds the old demo login) or the MetaApi history API. The API route is closed for the old account, which is deleted; each history call costs 50 credits. Items 7 and 8 are new.

1. **Stored SL/TP, position `152740587160` (market BUY).** Expected SL 4113.34, TP 4138.07. Check MT5 History only if that terminal still holds the old login; otherwise this stays unverified.
2. **Stored SL/TP and state, cancelled orders.** `152740587791` (BUY_LIMIT, expected SL 4030.69, TP 4054.93) and `152740587899` (BUY_STOP, expected SL 4195.60, TP 4220.83). Expected state: Canceled. Same caveat as item 1.
3. **Realized P&L, position `152740587160`.** Deal profit, commission, swap, close price and displayed server time. Read-only: `GET /users/current/accounts/{id}/history-deals/position/152740587160`, or MT5 History. Same caveat as item 1: the API route is closed for this account.
4. **Clock.** Compare the displayed deal time in MT5 with the raw-log `tradeStartTime`. A 3-hour difference confirms broker-time labelling. Same caveat as item 1; the raw log is on the owner's machine.
5. **Pending-order comment lookup.** Needs a new pending order, so it requires owner approval for harness v2 (§7-I). It cannot be tested read-only.
6. **Current state.** Owner reports flat on 2026-10-09: no open or pending positions or orders. The screenshot showed History → Orders, not the Trade tab, so confirm on the Trade tab.
7. **Pending orders in MT5 with their own SL and TP (new).** Not observed on any account. Option C (§9) would answer this for one BUY LIMIT and one SELL LIMIT. It does not test MetaApi.
8. **Second run on the current account (new).** The session notes mention two runs; only the first run's log is referenced. Confirm what the second run showed, if one was run.

## 6. Earlier runs — failures and fixes

| Run | Failure | Root cause | Fix |
|---|---|---|---|
| `1aa04b6` | Trading calls 404 on `/accounts/undefined/…`, then HTTP 429 | Account list keys the id as `_id`; script read `id` | `9f9560b`: fall back to `_id` |
| `9f9560b` | Market-data calls 404; BUY_LIMIT lacked `openPrice` | Wrong endpoint paths; missing field | `7a129b5`: corrected paths and fields |
| `7a129b5` | `/symbols/XAUUSD` 404 → NaN sizing; `ORDER_DELETE` rejected (HTTP 400, "Unknown trade action type"); BUY_LIMIT ticket 152740112121 left pending | Spec path is `/specification`; tick value is not in the REST spec; the cancel action is `ORDER_CANCEL` | `4780dff`: spec path, loss-tick sizing, cancel reconciliation. Cleanup run (`--cancel-order`) passed 6/6: ORDER_CANCEL acknowledged 10009 at 11:37:22 UTC; ticket absent; no XAUUSD position |
| `4b24073` | — | — | Full run 22/22 (§3). Added the P&L check, stop-order cycle, comment lookup and network-error capture |

## 7. Architecture impact — PROPOSED, NOT APPLIED

Only the three cost lines in ARCHITECTURE.md were changed in this review (§8). Items A–K need owner approval before the plan or the harness changes.

- **A. Tick value source.** Take `lossTickValue` (downside sizing) and `profitTickValue` (P&L display) from `/current-price` at sizing time. Store both with the quote timestamp in the sizing record. Refuse to size if either is missing or ≤ 0. This replaces `tick_value` as a broker spec field in §8A and `symbolSpec.tickValue`.
- **B. Outcome classification.** Transport layer: HTTP 429, 5xx, timeouts and request-level 4xx are not broker outcomes. A timed-out trade POST is UNKNOWN and must be reconciled by comment before any retry. Broker layer: HTTP 200 with `numericCode` decides the outcome (10008/10009 = accepted; anything else = rejected, shown with its code). The earlier harness counted a 429 as a rejection; the current one does not.
- **C. Adapter surface.** Extend the Layer 3 `ExecutionAdapter` (currently getAccountInfo, getSymbolInfo, placeOrder, closePosition, getPositions) with `getQuote(symbol)` (bid, ask, lossTickValue, profitTickValue), `getOrders()`, `cancelOrder(orderId)` and `getDealHistory(positionId)`.
- **D. SL/TP read-back.** After every send, read back the stored SL/TP of the position or pending order and compare it with the request. A mismatch moves the execution to failed or unknown, with a visible card. It is never silent.
- **E. Timestamps.** Stamp audit times from our own UTC clock. Store broker times raw, with a source label. Never mix the two.
- **F. Slippage.** Measure fill against the quote snapshot stored at request time, not against an earlier quote.
- **G. Comment and clientId.** MetaApi's documented limit is 30 characters for `comment` + `clientId` when both are set (31 when only `comment` is set). A `clientId` must follow `strategyId_positionId_orderId`. POC comments were 17–21 characters; `clientId` was not tested.
- **H. Polling vs streaming (design decision).** Each REST GET costs 50 credits. A 1 Hz positions + orders poll costs 100 credits/s per account: 20% of the per-account budget (500 credits/s), and it would use a shared server's 2,000 credits/s at about 20 accounts. Streaming reads cost no RPC credits. Choose the Phase 1 state-sync design with this budget in mind. Not tested.
- **I. Harness v2 (optional; places demo orders, so it needs approval).** Take P&L from the position's own `currentPrice` and `unrealizedProfit` in one response; read back SL/TP for pending orders before cancelling; add a history-deals check for realized P&L; add a pending-order comment lookup.
- **J. Harness safety and template (proposed; none applied).** (1) Select only the account whose login and server both match `MT_LOGIN` and `MT_SERVER`. Remove the sole-account fallback (§4.14a). (2) Require an explicit flag before any run may create and deploy a billed account (§4.14b). (3) Set `MT_PLATFORM=mt5` in `poc/.env.example` (§4.14c). (4) Before any order, refuse to trade unless the broker session and quote are fresh, which addresses the 10021 cause (§4.12). Items 1–3 change the harness and need approval. Item 4 is new and untested.
- **K. Reconciliation test (proposed).** Before the UNKNOWN path is trusted, prove it on the demo account: a trade POST that times out must be found by its comment, and must not be sent again. This needs the pending-order comment lookup (item I) and owner approval.

## 8. Cost facts — corrected

The earlier "free tier → zero cost" claim is withdrawn. ARCHITECTURE.md lines 89, 817 and 840 now carry the verified facts.

Source: https://metaapi.cloud/ (pricing section, fetched 2026-10-08). USD, excluding VAT/GST. Monthly figures use 730 hours.

| Item | Cloud offering g2 | Cloud offering g1 |
|---|---|---|
| Deployed account hosting | $0.012/h ≈ $8.76/mo | $0.039376/h ≈ $28.74/mo |
| Undeployed account hosting | $0.00105/h ≈ $0.77/mo | same |
| Account deployment | $0.072 per trading account | $0.23625 per trading account |
| Adding a trading account | $2.10 per unique account, charged once a month if re-added | same |
| Excessive failed add attempts | $0.105 each (permanent errors retried; internal errors not charged) | same |
| Dedicated frontend server (optional) | $0.0015/h per account | $0.009844/h per account |
| MetaApi API | Listed as "Free"; footnote: "There might be extra charges if you use some of the APIs" | same |

- The page's "API access pricing" table (per region and reliability) is an interactive estimator. Its figures were not captured, so API usage cost is unknown.
- No free account tier appears on the current page. A search-index snapshot of the same page dated 2026-07-12 listed a $30/month plan with one free MT account. That plan is not on the current page. Treat it as unverified.
- The owner's billing page is the source of truth for the deployed account's actual charges. Please check it and share the monthly figure.
- Current state: the current account is undeployed. Until it is deleted, it still carries the undeployed list charge (about $0.77/month). Re-adding a unique account costs $2.10 at list price. No billing figure has been reported to this repo.
- The "$15–25/mo per account" estimate in ARCHITECTURE is superseded by the table above.

## 9. Gate status and decisions (updated 2026-10-09)

- **POC-1 verdict: OPEN.** The §17 criterion is "all steps succeed on demo, or failures are understood and documented with a concrete architecture-change proposal." The 2026-10-08 run met it for the steps it covered. The later failures (§3B) are documented, but their causes (10021, and the HTTP 500s and timeouts) are not yet understood. The SL/TP read-back, realized P&L, pending-order visibility in MT5 and SELL pending orders are still unverified, so U1 is not closed.
- **Phase 1 remains on hold.**
- **Option A: pause and record.** Accept the OPEN verdict and this document as the record. Optional: delete the current MetaApi account to stop the undeployed charge. Re-adding a unique account later costs about $2.10. No further API calls.
- **Option C: free manual MT5 test (no MetaApi).** The owner runs this in the MT5 terminal on the demo login and reports the results:
  1. Confirm the Trade tab shows no positions and no pending orders.
  2. Place a BUY LIMIT, 0.01 lot, about 2% below the market, with SL 0.2% below its price and TP 0.4% above it (the harness rule for BUY orders).
  3. Place a SELL LIMIT, 0.01 lot, about 2% above the market, with SL 0.2% above its price and TP 0.4% below it (the mirror of the same rule).
  4. Check that the Trade tab shows the S/L and T/P values on both orders. Take a screenshot.
  5. Cancel both orders. Confirm the Trade tab is empty and that no position opened.
  6. Report the ticket numbers, the times, the screenshot and any MT5 message. If MT5 rejects a level, record the message: that is a result too.

  Option C answers the MT5 display question for BUY and SELL limit orders. It does not test MetaApi, so the API questions stay open.
- **Requested from the owner:**
  1. Choose Option A or Option C.
  2. Accept the OPEN verdict, or give conditions.
  3. Decide the §7 proposals (A–K). Items A–D change the spec. Item J changes the harness.
  4. Decide §7-I: harness v2 (places demo orders), or read-only checks only.
  5. Give explicit go-ahead to lift the gate. Nothing in Phase 1 starts before this.
