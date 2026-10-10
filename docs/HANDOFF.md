# HANDOFF — NoAds Trade Tracker

> **Start here.** This file keeps the project's status, open decisions, requirements, working rules and session log in one place, so the work can continue later, on another machine, or with another assistant. Evidence lives in `docs/poc/`. The plan lives in `docs/ARCHITECTURE.md`.

**Last updated:** 2026-10-10 (Lagos time; proposed documentation update) · **Session branch:** `arena/5c731da5-noads-trade-tracker` · **Branch base:** `487a43e` (`main`); project work merged from `arena/01a0e310-noads-trade-tracker` · **Phase 1 code:** not started (on hold)

---

## 1. Where things stand

**What the product is.** A bridge from TradingView alerts to MetaTrader 4/5 accounts. An alert reaches our webhook. The backend sizes the trade from each account's risk settings and executes on every enabled account (fan-out). Every outcome is recorded, including UNKNOWN, which is never assumed to be a failure. A later version adds a licensed chart workspace where setups are drawn in our own app.

| Item | Status | Evidence |
|---|---|---|
| POC-2: TradingView webhook → our receiver | **PASS** (2026-10-03) | `docs/poc/MetaApi-provider-evidence.md` | Official public-source matrix and empirical unknowns. | Research only |
| `docs/poc/POC-1-next-run-plan.md` | Conditional acceptance/cost plan. | Not authorized to run |
| `poc/metaapi-safety.mjs`, `poc/metaapi-safety.test.mjs` | Pure offline safety predicates/tests. | Not provider integration proof |
| `docs/poc/POC-2-results.md` |
| POC-1: MetaApi → MT5 execution (SL/TP, pending orders) | **OPEN** | `docs/poc/POC-1-results.md`, §0 |
| Phase 1 product code | **Not started.** On hold until the owner's go-ahead. | ARCHITECTURE §15 #12, §17 |
| TradingView Charting Library license | Owner action. Status is not recorded in this repo. | ARCHITECTURE §15 #9 |

**The owner's open question:** can MetaApi and MT5 place BUY and SELL pending orders that carry their own SL and TP, and do those orders appear in MT5?

- MetaApi BUY LIMIT and BUY STOP with SL and TP were accepted by the broker on the old demo account (2026-10-08). The stored SL/TP was never read back, and MT5 display of those API orders while pending was not checked.
- The owner has since manually placed a BUY LIMIT and SELL LIMIT directly in demo MT5; a Trade tab screenshot shows both as placed (§4.15 in POC-1). Their S/L, T/P, tickets and later cancellation/fill are not visible. **MetaApi SELL pending orders remain untested.**
- The current MetaApi account's first market BUY was rejected by the broker with "no quotes" (10021). No pending order was placed through it.

**Accounts and money.** The old account and the London-region account are deleted in MetaApi. At last report the current MetaApi account was undeployed and disconnected; no new API state has been checked. The owner's MetaApi balance was used up, and the owner does not want to spend more. An undeployed account still carries a small list charge (about $0.77/month) until it is deleted. No MetaApi calls were made for this update.

**MT5 manual state (owner-confirmed).** Both manually placed XAUUSD demo pending orders were canceled; the owner personally verified the demo account flat with no open positions. History screenshot supports two canceled/zero filled for these orders. Do **not** ask for another check to do documentation or offline planning. This is not MetaApi finality/protection evidence; future authorized execution tests have separate safety preconditions. See POC-1 §4.15.

---

## 2. Current gate and next owner decision

- **Manual state:** already confirmed flat by the owner; two manual cancellations/zero fills supported by History screenshot. Stored SL/TP on those orders and MetaApi behavior remain unverified. No repeat manual check is required for Gates 3–6.
- **Ratified policy direction (not implemented):** scope-aware UNKNOWN/protection fence (setup-only only with objective proof account exposure, shared margin, account state and calculations unaffected; otherwise affected account; shared outages block dependent accounts); no replacement until authoritative canceled + complete zero-fill evidence; no automatic replacement after partial fill or residual cancellation without validation; broker-confirmed SL/TP mandatory for resumption, plus separate owner authorization; no implicit execution on unblocking. See [POC-1 decision record](poc/POC-1-decisions.md).
- **Open preparation:** verify provider/broker guarantees, quote/conversion and reconciliation numeric thresholds, cost enforceability and future POC acceptance. Proposed total remaining POC spend cap $25 is **not** permission to spend. POC-1 stays OPEN and Phase 1 ON HOLD; no MetaApi calls or empirical tests are authorized (offline tests are permitted).

The latest directive permits safe documentation/offline work and eligible PR #1 cleanup/merge under the repository workflow; it does **not** authorize a MetaApi run, spending, or Phase 1 product implementation. See the current Git status below.

---

## 3. Repository map

| Path | What it is | State |
|---|---|---|
| `docs/HANDOFF.md` | This file. | Updated 2026-10-10 |
| `docs/ARCHITECTURE.md` | The plan (§1–§17), decision log (§15), POC gate (§17). | Authoritative design updated for the tiered incident policy; Phase 1 plan added, not implemented. |
| `docs/poc/POC-1-results.md` | MetaApi/MT5 POC: evidence, findings, open items, proposals, costs, gate status. | Updated 2026-10-10 (manual evidence preserved; verdict OPEN). |
| `docs/poc/POC-1-decisions.md` | Short owner decision list, grouped from POC-1 §7 and HANDOFF §6. | Updated ratified policy; provider-dependent evidence remains open. |
| `docs/poc/MetaApi-provider-evidence.md` | Official public-source matrix and empirical unknowns. | Research only |
| `docs/poc/POC-1-next-run-plan.md` | Conditional acceptance/cost plan. | Not authorized to run |
| `poc/metaapi-safety.mjs`, `poc/metaapi-safety.test.mjs` | Pure offline safety predicates/tests. | Not provider integration proof |
| `docs/poc/POC-2-results.md` | TradingView webhook POC: real delivery and receiver replay. | PASS |
| `poc/metaapi-exec.mjs` | POC-1 harness, zero dependencies. A full run places DEMO orders. `--cancel-order <ticket>` cancels one pending order only. | Legacy path **disabled before I/O**; offline policy checks are separate and not integrated execution proof. |
| `poc/webhook-receiver.mjs` | POC-2 receiver: `POST /webhook/:token` on port 8790. Parses, checks the token, dedupes. Logs deliveries to an ignored file. | Used for POC-2. |
| `poc/debug-list.mjs` | Dumps the raw MetaApi account list (diagnostic). | Diagnostic only. |
| `poc/.env.example` | Template for `poc/.env.local` (variable names and defaults). | `MT_PLATFORM=mt5`; credentials blank, example only. |
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
- **Pull requests:** [#1](https://github.com/The-Mhood/noads-trade-tracker/pull/1) opened for owner review on 2026-10-09 after explicit approval. At this writing it is OPEN; the latest directive permits eligible merge if workflow checks/reviews allow. PR merge is independent of the POC/Phase 1 gate.
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
| R11 | An explicit `unknown` state. Reconcile by tickets and linked orders/positions/deals/history; comment is only a hint. Never assume failure after a timeout mid-send. | §6 (state machine), §8 (`reconciler.ts`), §8A table, §9 | Specified. UNKNOWN seen on a live account (HTTP 500). Reconciliation not yet proven. See G-2. |
| R12 | POC gate: POC-1 and POC-2 documented before any MVP. POCs test the real mechanism, with no mocked critical part and no MVP creep. | §17; §15 #14 | POC-2 PASS. POC-1 OPEN. MVP blocked. |
| R13 | Phase 1 starts only after an evidence-backed POC-1 pass and subsequent owner confirmation (or separate explicit changed authorization). | §15 #12 | On hold. |
| R14 | Stack: React 18, TypeScript, Vite, Tailwind CSS; Node.js ≥ 22, Express, SQLite; vitest for money math. | §1, §14; §15 #3, #4 | Tailwind and vitest approved. See G-5. |
| R15 | Frontend: components never touch storage or I/O directly. The repository seam is the only I/O. Selectors derive data. Every I/O call is awaited. Explicit async states. Debounced saves. No secrets or account credentials in the frontend or in localStorage. | §5, §7, §8 (`data/`), §9 | Specified. Not built. |
| R16 | No secrets in code or committed files. Demo credentials only in POCs. `.env.local` is git-ignored. | §12; `poc/.env.example`; `.gitignore` | Applied to the POC. |
| R17 | Alert facts: numbers arrive as strings and must be coerced and validated. Alerts fire only while the symbol's market is open. The production receiver needs always-on hosting. Missed alerts are not resent. | POC-2 findings | Recorded. |
| R18 | MetaApi bills per deployed account. Product pricing must cover that cost per connected user. | POC-1 §8 | Recorded. No real billing figure yet. |

---

## 6. Spec gaps and unresolved provider evidence (resolve before Phase 1)

**Spec gaps.** These are places where `docs/ARCHITECTURE.md` conflicts with the owner's rules or with the POC evidence.

- **G-1 Tick value source.** Proposed §6/§8A wording now sources `lossTickValue`/`profitTickValue` with quote timestamp from `/current-price`, not the REST spec; account-currency/FX semantics and numerical freshness limits still require validation.
- **G-2 `failed_timeout`.** Proposed §6/§8A wording reserves failed-pre-submit for proven no-send; any ambiguous timeout/HTTP error remains UNKNOWN with a scope-aware submission fence and no blind retry. Retry/escalation numbers still require provider validation.
- **G-3 Lock point.** Owner prefers broker-side pending orders; §6/§8A proposal separates desired from last broker-confirmed revision and locks actual fill at trigger. A fill racing cancellation can use old committed volume; record the deviation and never claim exact newest risk at trigger.
- **G-4 State names.** The owner's chain (PENDING → ENTRY TRIGGERED → PARAMS LOCKED → SIZED → EXECUTED → RUNNING) does not match §6's status list (received, validated, sized, awaiting_confirm, submitting, submitted, partial_filled, filled, rejected, failed, unknown, closed). Map one to the other, or adopt one set.
- **G-5 vitest approval text.** §8's file tree now reflects the approval already recorded in §15 #4; no product dependency installation; offline Node built-in tests are authorized.
- **G-6 Alert-to-trade path.** POC-2 captured and replayed a real alert. No alert has triggered a trade yet.

**Current interpretation:** §8A and §6 in the architecture now specify the ratified policy; older POC-1 §7 A–K questions describe **historical proposals**, not current approval or observed broker behavior. Public evidence and limitations are in [the provider matrix](poc/MetaApi-provider-evidence.md), and the [follow-up plan](poc/POC-1-next-run-plan.md) is non-executable. The offline predicates are unit-tested but are **not integrated** with the locked historical trading flow; no execution-ready harness is claimed. G-4's UI mapping, quote thresholds, provider history finality, bills and response to existing unprotected exposure still need validation before product work.

**Unverified broker behavior** (POC-1 §4.5–§4.9): stored SL/TP (market and pending), MT5 display of pending orders, SELL pending orders, realized P&L, comment lookup for pending orders, and the UNKNOWN reconciliation path.

---

## 7. Harness safety and offline checks

`poc/metaapi-exec.mjs` (all modes) and `poc/debug-list.mjs` are blocked **before** credentials and network access; historical trade logic remains behind the lock and is **not execution-ready**. Existing-account selection no longer has a sole-account fallback or creates/deploys a billable account. The webhook receiver requires a configured non-placeholder token and no longer prints it in the page/console; it remains a POC, not a production receiver.

Run only `node --test poc/metaapi-safety.test.mjs` and `node --check poc/*.mjs` offline; no `.env.local` is needed. Predicate tests cover exact identity, directional/fresh quote inputs, ambiguous outcomes, strict SL/TP readback, canceled-order **candidate only**, tiered fence and separate owner resumption. They do not prove provider semantics or connect these checks to a live send. See [POC README](../poc/README.md). Do not unlock or invoke MetaApi until a separately authorized, costed and reviewed implementation exists.

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
- Historical create flow treated a 202 body ID as potentially phantom; **billable creation and deployment are now disabled**, not to be retried.
- Do not retry connection failures in a loop. Retries did not fix the London-region account's failures.
- Do not reuse any shell variable or URL built from the deleted old account ID.
- Offline predicates and tests are not provider evidence. Only separately approved empirical provider/broker evidence can close the POC.
- Dashboard times are UTC+1 (Lagos). Broker times in MetaApi responses look like UTC+3 labelled as Z (POC-1 §4.4).
- zsh (the macOS default shell) can expand `!` inside double-quoted strings. Use single quotes around inline Node code.
- The sandbox sleeps between turns and kills background processes. That is why the POC-2 capture used an external service.
- Do not add dependencies without approval (ARCHITECTURE §14).

---

## 10. Working rules (the owner's standing instructions)

1. The 2026-10-10 directive authorizes documentation and offline harness safety/tests now; POC execution and Phase 1 product code remain on hold.
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
| 2026-10-03 | POC-2 PASS: a real TradingView webhook was captured and replayed. | `docs/poc/MetaApi-provider-evidence.md` | Official public-source matrix and empirical unknowns. | Research only |
| `docs/poc/POC-1-next-run-plan.md` | Conditional acceptance/cost plan. | Not authorized to run |
| `poc/metaapi-safety.mjs`, `poc/metaapi-safety.test.mjs` | Pure offline safety predicates/tests. | Not provider integration proof |
| `docs/poc/POC-2-results.md` |
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
| 2026-10-09 | Opened PR #1 against `main` for owner review of the documentation and POC tools; no merge or Phase 1 go-ahead. | https://github.com/The-Mhood/noads-trade-tracker/pull/1 |
| 2026-10-10 | Owner confirmed manual MT5 flat and ratified incident policy. Earlier review-only restriction (superseded later on 2026-10-10); no MetaApi calls authorized then or now. POC-1 OPEN, Phase 1 ON HOLD. | POC-1 §4.15; decision record |

| 2026-10-10 | Applied authoritative tiered policy, sourced provider matrix, non-executable POC plan and Phase 1 first-slice plan; disabled legacy MetaApi scripts before network, added offline policy checks/tests. No MetaApi calls, spending or product code. | `docs/ARCHITECTURE.md`, `docs/poc/`, `poc/` |

---

## 12. How to resume

1. Get the code: `git clone https://github.com/The-Mhood/noads-trade-tracker` (or `git fetch` if you already have a clone), then check out `arena/5c731da5-noads-trade-tracker` locally. In an Arena session, stay on the assigned session branch.
2. Read this file (§1, §2, §6, §10), then `docs/poc/POC-1-results.md` (§0, §5, §7, §9).
3. Manual MT5 demo flat state was confirmed by the owner; do not ask to repeat it for documentation. Any future separately authorized execution test must perform its own account-state preflight. POC-1 remains OPEN.
4. Do not run the harness, or any MetaApi trade call, without the owner's explicit go-ahead. The current harness is locked; unlocking it still requires a reviewed safety implementation and cost authorization because its historical path could place orders and incur costs.
5. The owner's `poc/.env.local` stays on the owner's machine. Do not create a local credential file for offline work. Never paste tokens or passwords into chat or Git.
6. When you change anything: update this file's session log and the relevant POC document, commit to the session branch, and push.

To hand this to another assistant, say: "Read docs/HANDOFF.md first, then docs/poc/POC-1-results.md, and follow §10."
