# HANDOFF — NoAds Trade Tracker

> **Start here.** This file keeps the project's status, open decisions, requirements, working rules and session log in one place, so the work can continue later, on another machine, or with another assistant. Evidence lives in `docs/poc/`. The plan lives in `docs/ARCHITECTURE.md`.

**Last updated:** 2026-10-09 (Lagos time) · **Session branch:** `arena/5c731da5-noads-trade-tracker` · **Branch base:** `487a43e` (`main`); project work merged from `arena/01a0e310-noads-trade-tracker` · **Phase 1 code:** not started (on hold)

---

## 1. Where things stand

**What the product is.** A bridge from TradingView alerts to MetaTrader 4/5 accounts. An alert reaches our webhook. The backend sizes the trade from each account's risk settings and executes on every enabled account (fan-out). Every outcome is recorded, including UNKNOWN, which is never assumed to be a failure. A later version adds a licensed chart workspace where setups are drawn in our own app.

| Item | Status | Evidence |
|---|---|---|
| POC-2: TradingView webhook → our receiver | **PASS** (2026-10-03) | `docs/poc/POC-2-results.md` |
| POC-1: MetaApi → MT5 execution (SL/TP, pending orders) | **OPEN** | `docs/poc/POC-1-results.md`, §0 |
| Phase 1 product code | **Not started.** On hold until the owner's go-ahead. | ARCHITECTURE §15 #12, §17 |
| TradingView Charting Library license | Owner action. Status is not recorded in this repo. | ARCHITECTURE §15 #9 |

**The owner's open question:** can MetaApi and MT5 place BUY and SELL pending orders that carry their own SL and TP, and do those orders appear in MT5?

- MetaApi BUY LIMIT and BUY STOP with SL and TP were accepted by the broker on the old demo account (2026-10-08). The stored SL/TP was never read back, and MT5 display of those API orders while pending was not checked.
- The owner has since manually placed a BUY LIMIT and SELL LIMIT directly in demo MT5; a Trade tab screenshot shows both as placed (§4.15 in POC-1). Their S/L, T/P, tickets and later cancellation/fill are not visible. **MetaApi SELL pending orders remain untested.**
- The current MetaApi account's first market BUY was rejected by the broker with "no quotes" (10021). No pending order was placed through it.

**Accounts and money.** The old account and the London-region account are deleted in MetaApi. At last report the current MetaApi account was undeployed and disconnected; no new API state has been checked. The owner's MetaApi balance was used up, and the owner does not want to spend more. An undeployed account still carries a small list charge (about $0.77/month) until it is deleted. No MetaApi calls were made for this update.

**MT5.** The owner earlier reported the demo login flat on 2026-10-09. A subsequent Trade tab screenshot shows two manually placed XAUUSD pending orders at displayed volume `0.8 / 0` each, not the planned 0.01-lot checklist size. **If still active, cancel both and confirm no orders or positions remain.** See POC-1 §4.15 and §9; do not infer stored stops or cleanup from the screenshot.

---

## 2. Decision needed from the owner

- **Immediate MT5 follow-up:** confirm that both manually placed pending orders have been cancelled and the Trade tab has no orders or positions. If safely available, share each order's S/L, T/P and ticket. The screenshot alone does not prove stops were set; see POC-1 §4.15.
- **POC path:** Option C (free manual MT5 test) has partial evidence; choose whether to finish its stop-details and cleanup checks or pause and record the OPEN verdict (Option A). Option C does not prove MetaApi placement. Do not incur new MetaApi charges without explicit approval.
- **Product/engineering decisions:** the [short POC-1 decision list](poc/POC-1-decisions.md) groups proposals A–K and gaps G-1 to G-6 for owner review. None is approved by documenting it. Phase 1 remains on hold.

The owner authorized a review PR for the documentation and POC tools, not a merge or a Phase 1 go-ahead (§4).

---

## 3. Repository map

| Path | What it is | State |
|---|---|---|
| `docs/HANDOFF.md` | This file. | Current (2026-10-09) |
| `docs/ARCHITECTURE.md` | The plan (§1–§17), decision log (§15), POC gate (§17). | Authoritative. Not changed for POC findings; proposals are pending. |
| `docs/poc/POC-1-results.md` | MetaApi/MT5 POC: evidence, findings, open items, proposals, costs, gate status. | Updated 2026-10-09 (manual MT5 evidence partial; verdict OPEN). |
| `docs/poc/POC-1-decisions.md` | Short owner decision list, grouped from POC-1 §7 and HANDOFF §6. | For review; proposals not approved. |
| `docs/poc/POC-2-results.md` | TradingView webhook POC: real delivery and receiver replay. | PASS |
| `poc/metaapi-exec.mjs` | POC-1 harness, zero dependencies. A full run places DEMO orders. `--cancel-order <ticket>` cancels one pending order only. | Works. Safety fixes proposed (POC-1 §7-J). |
| `poc/webhook-receiver.mjs` | POC-2 receiver: `POST /webhook/:token` on port 8790. Parses, checks the token, dedupes. Logs deliveries to an ignored file. | Used for POC-2. |
| `poc/debug-list.mjs` | Dumps the raw MetaApi account list (diagnostic). | Diagnostic only. |
| `poc/.env.example` | Template for `poc/.env.local` (variable names and defaults). | Known trap: `MT_PLATFORM=mt4`, but the POC runs on MT5. |
| `poc/README.md` | How to run POC-1 and POC-2. | Current. |
| `.gitignore` | Ignores `.env.local`, POC run logs and the webhook log. Keeps `.env.example` tracked. | — |
| `README.md` | Project title only. | Unchanged. |

**Not in the repo, by design:**

- `poc/.env.local` (secrets). It lives on the owner's machine only.
- `poc/poc1-run-*.json`: raw run logs. Git-ignored and on the owner's machine. POC-1 cites them by timestamp.
- `poc/webhook-received.log.jsonl`: webhook delivery log. Git-ignored.
- MetaApi account IDs, MT logins, passwords and tokens. Deliberately not recorded.
- Screenshots the owner sent in chat, billing data (the owner's MetaApi dashboard), and the Charting Library license status.

---

## 4. Git state

- **Remote:** `origin` = `https://github.com/The-Mhood/noads-trade-tracker` (no credentials in the URL).
- **Session branch:** `arena/5c731da5-noads-trade-tracker`, based on `main` at `487a43e`. The owner approved importing the project-work branch `arena/01a0e310-noads-trade-tracker` (source tip `58d307b`) into this branch, preserving its history. Only work on and push to this session branch.
- **Remote `main`:** `487a43e` (owner's upload, 2026-09-27 18:07 UTC). It added the unrelated root `ARCHITECTURE.md` ("Todo App"). That file was deleted on this session branch at `fba45e7`; **it remains on `main` until a PR is merged.** The project plan is `docs/ARCHITECTURE.md`.
- **Pull requests:** none opened for this session branch as of this update. Opening or merging a PR requires the owner's decision; importing the project work did not authorize a PR or Phase 1.
- **Sandbox clone:** unshallowed before the merge; local history and merge-base are now available.
- **Other branches:** `arena/01a0e310-noads-trade-tracker` is the project-work source; `arena/01a0e407-noads-trade-tracker` is unrelated. Do not switch to or push to either.

---

## 5. Requirements traceability

Condensed from the owner's specifications. "Where" points to `docs/ARCHITECTURE.md` unless noted.

| ID | Requirement | Where | Status |
|---|---|---|---|
| R1 | Alert → webhook → size from the account's risk settings → execute on MT4/MT5 (demo, prop-firm or live). | §2, §3, §11 | Webhook leg PASS (POC-2). Execution leg OPEN (POC-1). Not built. |
| R2 | Size = monetary risk ÷ (entry-to-SL distance × tick value), using the broker's contract, tick and lot rules. Show the size before execution. Never execute if the rules cannot be met. No fixed lots. | §8A | Formula checked on a live quote at minimum lot (POC-1 step 7). Engine not built. See G-1. |
| R3 | Market, limit and stop orders; margin checks; duplicate protection; broker rejections; slippage; partial fills; unknown state; history and audit; an explicit ❌ ORDER FAILED card. | §8A (owner-spec mapping table), §9 | Market, limit and stop placement and one rejection code tested. Slippage sampled once. Partial fills, requotes, margin rejection and reconciliation not tested. |
| R4 | TradingView: Charting Library only; never embed, proxy or scrape tradingview.com. Three input modes feed one `TradeInstruction`. A closed list of actionable drawings. Pine Script never reads drawings. No trading logic in chart components. Report success, rejection, failure or unknown. | §3A, §3B; §15 #6, #9, #11 | Alert input is v1. Chart input modes are v2 and need the license. |
| R5 | Risk is a fixed percentage per account, never a dollar amount per trade. Two bases: a locked reference balance, or the current balance. Changes are allowed at any time but never affect running orders. | §6 (`riskSnapshot`), §8A Step 0; §15 #13 | Specified. Not built. |
| R6 | Setups that have not triggered follow the current risk settings. Unfilled managed orders are cancelled and replaced at the new size. | §8A "Pending setups & execution lock"; §15 #13 | Specified. Not tested. See G-3. |
| R7 | Execution lock from the entry trigger: later changes to risk %, basis, reference balance or account availability cannot alter the order. Show the size and maximum planned loss before execution. | §6, §8A | Specified. Lock point needs confirmation (G-3). |
| R8 | Fan-out (v1): one signal goes to every enabled and connected account, each at its own risk. The account toggle OFF excludes the account from new trades only. Per-account failures are shown. | §15 #8; §6 (`Account.enabled`); §8A fan-out rule | Specified. Not built. |
| R9 | `executionMode` defaults to `auto`; `confirm` is available. | §15 #7; §6 | Specified. |
| R10 | A signal without a stop-loss is rejected (`missing_stop_loss`). No fixed-lot fallback. | §15 #2; §6 | Specified. |
| R11 | An explicit `unknown` state. Reconcile by order comment. Never assume failure after a timeout mid-send. | §6 (state machine), §8 (`reconciler.ts`), §8A table, §9 | Specified. UNKNOWN seen on a live account (HTTP 500). Reconciliation not yet proven. See G-2. |
| R12 | POC gate: POC-1 and POC-2 documented before any MVP. POCs test the real mechanism, with no mocked critical part and no MVP creep. | §17; §15 #14 | POC-2 PASS. POC-1 OPEN. MVP blocked. |
| R13 | Phase 1 starts only after the owner's further instructions and explicit go-ahead. | §15 #12 | On hold. |
| R14 | Stack: React 18, TypeScript, Vite, Tailwind CSS; Node.js ≥ 22, Express, SQLite; vitest for money math. | §1, §14; §15 #3, #4 | Tailwind and vitest approved. See G-5. |
| R15 | Frontend: components never touch storage or I/O directly. The repository seam is the only I/O. Selectors derive data. Every I/O call is awaited. Explicit async states. Debounced saves. No secrets or account credentials in the frontend or in localStorage. | §5, §7, §8 (`data/`), §9 | Specified. Not built. |
| R16 | No secrets in code or committed files. Demo credentials only in POCs. `.env.local` is git-ignored. | §12; `poc/.env.example`; `.gitignore` | Applied to the POC. |
| R17 | Alert facts: numbers arrive as strings and must be coerced and validated. Alerts fire only while the symbol's market is open. The production receiver needs always-on hosting. Missed alerts are not resent. | POC-2 findings | Recorded. |
| R18 | MetaApi bills per deployed account. Product pricing must cover that cost per connected user. | POC-1 §8 | Recorded. No real billing figure yet. |

---

## 6. Spec gaps and proposals (resolve before Phase 1)

**Spec gaps.** These are places where `docs/ARCHITECTURE.md` conflicts with the owner's rules or with the POC evidence.

- **G-1 Tick value source.** §8A and `SymbolSpec.tickValue` (§6) assume the broker spec carries tick value. The MetaApi spec endpoint does not return it. Tick value comes from `/current-price` (`lossTickValue`, `profitTickValue`). Proposal: POC-1 §7-A.
- **G-2 `failed_timeout`.** §6 (around line 383) and the connection-failure row of §8A (around line 675) use `failed_timeout`. The owner's rule is that a timeout mid-send is UNKNOWN and is never assumed failed. Proposed clarification: `failed_timeout` applies only if the request never left the system. Any timeout after sending is `unknown` (POC-1 §7-B).
- **G-3 Lock point.** §6 locks parameters at `submitting`. For a pending order, `submitting` (placing it at the broker) happens before its entry triggers. The owner's directive locks at the entry trigger. Decide which point governs pending orders.
- **G-4 State names.** The owner's chain (PENDING → ENTRY TRIGGERED → PARAMS LOCKED → SIZED → EXECUTED → RUNNING) does not match §6's status list (received, validated, sized, awaiting_confirm, submitting, submitted, partial_filled, filled, rejected, failed, unknown, closed). Map one to the other, or adopt one set.
- **G-5 vitest approval text.** §8's file tree says "vitest — pending approval" (around line 604). §15 #4 says resolved: yes. Fix the text.
- **G-6 Alert-to-trade path.** POC-2 captured and replayed a real alert. No alert has triggered a trade yet.

**Proposals awaiting the owner's decision** (POC-1 §7; none applied):

- **A–D** change the spec: tick value source, outcome classification, adapter surface, SL/TP read-back.
- **E–H** are design notes: timestamps, slippage reference, comment and clientId limits, polling vs streaming.
- **I** is harness v2. It places demo orders, so it needs approval.
- **J** is harness safety: exact login match, no billed-account creation without an explicit flag, `MT_PLATFORM=mt5` in the template, and a fresh-quote check before orders.
- **K** is a reconciliation test on the demo account.

**Unverified broker behavior** (POC-1 §4.5–§4.9): stored SL/TP (market and pending), MT5 display of pending orders, SELL pending orders, realized P&L, comment lookup for pending orders, and the UNKNOWN reconciliation path.

---

## 7. Harness: how to run it, and what to watch

Run it on the owner's machine only, and only after the owner's go-ahead.

```bash
cp poc/.env.example poc/.env.local     # fill in locally; never commit it or paste it into chat
node poc/metaapi-exec.mjs              # FULL RUN: places DEMO orders (market BUY, pending orders, cancels)
node poc/metaapi-exec.mjs --cancel-order <numeric ticket>   # cancels one pending order; creates nothing and sends no new trades
```

Variables (names only): `METAAPI_TOKEN`, `MT_LOGIN`, `MT_PASSWORD`, `MT_SERVER` (must contain "demo"), `MT_PLATFORM` (use `mt5`), `MT_SYMBOL` (default XAUUSD), `RISK_USD` (POC budget in USD), and `WEBHOOK_TOKEN` (POC-2 receiver).

Watch-outs:

- A full run may create and deploy a billed MetaApi account if none matches `MT_SERVER` (POC-1 §4.14b).
- Check the printed account line. `adopting sole demo account` means the login did not match (POC-1 §4.14a).
- `RISK_USD` is a POC budget. The product's risk model is a percentage per account (R5).
- Old provisioning hosts (`agiliumtrade.ai`) were retired. The harness probes candidate hosts at startup.
- Each run writes `poc/poc1-run-<timestamp>.json` (git-ignored). Keep it: it is the raw evidence.
- Requires Node 18 or later. No npm dependencies.

---

## 8. Costs (list prices checked 2026-10-08; full table in POC-1 §8)

- Deployed hosting: g2 $0.012/h (about $8.76/month at 730 h); g1 $0.039376/h (about $28.74/month).
- Undeployed hosting: $0.00105/h (about $0.77/month).
- Deployment: $0.072 (g2) or $0.23625 (g1) per trading account.
- Adding a trading account: $2.10 per unique account (charged monthly if re-added).
- No free account tier is verified. The "$30/month with one free account" snippet is unverified.
- The owner's billing page is the source of truth. The owner has not yet reported the actual monthly figure.
- Product implication (R18): cost per connected user must be designed in.

---

## 9. Do not retry, and known traps

- `ORDER_DELETE` is invalid. Cancel with `ORDER_CANCEL`.
- The REST symbol spec has no tick value. Use `/current-price` (`lossTickValue`).
- The symbol spec path is `/symbols/:symbol/specification`. `/symbols/:symbol` and `/symbol-specs` return 404.
- Account records may key the ID as `_id`, not `id`. Use `id || _id` (fixed in `9f9560b`).
- Read the broker result from the body's `numericCode`. HTTP 200 alone is not success. 10008 and 10009 mean accepted.
- HTTP 429, 5xx and timeouts are not broker rejections. A timeout mid-send is UNKNOWN: reconcile before any retry.
- A 202 create response's body ID can be phantom. Re-send the same create request with the same `transaction-id` until the real result appears.
- Do not retry connection failures in a loop. Retries did not fix the London-region account's failures.
- Do not reuse any shell variable or URL built from the deleted old account ID.
- Sandbox results are not evidence. Offline stubs test control flow only. Only the owner's live runs count.
- Dashboard times are UTC+1 (Lagos). Broker times in MetaApi responses look like UTC+3 labelled as Z (POC-1 §4.4).
- zsh (the macOS default shell) can expand `!` inside double-quoted strings. Use single quotes around inline Node code.
- The sandbox sleeps between turns and kills background processes. That is why the POC-2 capture used an external service.
- Do not add dependencies without approval (ARCHITECTURE §14).

---

## 10. Working rules (the owner's standing instructions)

1. Plan first. Do not implement until the owner approves the plan. Phase 1 is on hold.
2. Modify only what is needed. Do not rewrite existing code. Explain the approach before significant changes. One feature at a time.
3. Before changing files, say exactly which files will be created or changed. After implementing, say exactly how to test.
4. No new dependencies without asking. Tailwind CSS and vitest are approved.
5. Never hard-code or store secrets. Never ask for passwords, tokens or 2FA codes in chat.
6. Root-cause before fixing. Never hide or swallow errors. Surface unknown states clearly.
7. Never embed, proxy or scrape tradingview.com. Use the Charting Library only, subject to its license.
8. Pine Script is never a drawing channel. Actionable drawings are a closed list. No heuristics.
9. Trading logic never lives in chart components. Input adapters output only a `TradeInstruction` or a rejection.
10. The default `executionMode` is `auto`. Fan-out is v1. An account toggle set to OFF excludes it from NEW trades only; it never closes or cancels anything.
11. A signal without a stop-loss is rejected (`missing_stop_loss`). No fixed-lot fallback.
12. Risk is a fixed percentage per account. Users never enter a dollar risk per trade. Size comes from monetary risk, entry-to-SL distance and broker specs.
13. Execution locks at the entry trigger. Pending, untriggered setups follow the current risk settings.
14. Frontend: components never touch storage or I/O directly. The repository seam is the only place for I/O, and every I/O call is awaited, even localStorage reads.
15. Git: work only on the session branch and push only to it. Never delete or move the repository root or `.git`.
16. The owner is the product owner and decision-maker. Wait for explicit go-ahead on major decisions.

---

## 11. Session log

| Date (UTC unless noted) | Event | Reference |
|---|---|---|
| 2026-09-27 13:31 | Base commit `2070379` ("Initial commit"). | — |
| 2026-09-27 18:07 | Owner's upload to `main` (`487a43e`): root `ARCHITECTURE.md` (an unrelated Todo App proposal). | `main` |
| 2026-09-27 to 09-28 | Owner decisions (ARCHITECTURE §15) and the TradingView architecture (§3B) recorded. | ARCHITECTURE §3B, §15 |
| 2026-10-03 | POC-2 PASS: a real TradingView webhook was captured and replayed. | `docs/poc/POC-2-results.md` |
| 2026-10-04 | MetaApi host probing, the 202 async-create protocol, account selection fixes, `.env.example` tracked. | `c46d853` … `5564cc5` |
| 2026-10-08 | Account ID fix, market-data paths, loss-tick sizing, cancel-only mode. | `9f9560b`, `7a129b5`, `4780dff` |
| 2026-10-08 | Harness P&L check and comment lookup. The owner's full run on the old demo account: 22/22. | `4b24073`; POC-1 §3 |
| 2026-10-08 | POC-1 draft (PASS, scoped) and the cost correction. | `651a0d6`, `6349ab7` |
| 2026-10-08 | Old account removed in MetaApi (missing from the owner's list by the evening, per screenshot). | POC-1 §3B |
| Earlier (exact date not recorded) | London-region account: HTTP 500s and timeouts. A market BUY outcome was UNKNOWN until the owner checked MT5. Account deleted. | POC-1 §3B |
| 2026-10-08 18:34 | Current demo account created. | POC-1 §3B |
| 2026-10-08 21:47 | Current account: steps 1–7 pass; the market BUY was rejected with 10021. | POC-1 §3B |
| After 21:47 on 2026-10-08 | MetaApi balance used up. Account undeployed. The owner paused spending. Exact time not recorded. | — |
| 2026-10-09 | The owner reports MT5 flat. POC-1 verdict set to OPEN. This handoff saved to the repository. | `58d307b` |
| 2026-10-09 | Owner requested removal of the unrelated root Todo proposal on the new session branch. It was deleted and pushed; `main` remains unchanged pending a PR. | `fba45e7` |
| 2026-10-09 | Owner approved merging the project-work branch into this session branch before a PR. Imported its docs and POC tools without running them or changing the POC-1 verdict; Phase 1 remains on hold. | Merge of `58d307b` into `arena/5c731da5-noads-trade-tracker` |
| 2026-10-09 | Owner shared a Trade tab screenshot showing manually placed BUY LIMIT and SELL LIMIT orders (displayed volume `0.8 / 0` each). Stop values, cleanup and MetaApi placement remain unverified. Requested a short decision list and authorized a review PR. No trade/API calls by the assistant. | POC-1 §4.15; `docs/poc/POC-1-decisions.md` |

---

## 12. How to resume

1. Get the code: `git clone https://github.com/The-Mhood/noads-trade-tracker` (or `git fetch` if you already have a clone), then check out `arena/5c731da5-noads-trade-tracker` locally. In an Arena session, stay on the assigned session branch.
2. Read this file (§1, §2, §6, §10), then `docs/poc/POC-1-results.md` (§0, §5, §7, §9).
3. Confirm the owner's choice (A or C) and the current MetaApi and MT5 state before any API call.
4. Do not run the harness, or any MetaApi trade call, without the owner's explicit go-ahead. Each run places orders and can cost money.
5. The owner's `poc/.env.local` stays on the owner's machine. Create your own from the template. Never paste tokens or passwords into chat or into a file.
6. When you change anything: update this file's session log and the relevant POC document, commit to the session branch, and push.

To hand this to another assistant, say: "Read docs/HANDOFF.md first, then docs/poc/POC-1-results.md, and follow §10."
