# NoAds Trade Tracker — Architecture & Project Plan

> TradingView alert → automatic MT4/MT5 execution bridge.
> Status: **PLAN — policy ratified where noted; provider questions OPEN; Phase 1 product code not implemented.**
> Last updated: 2026-10-10 (policy decisions ratified; POC-1 OPEN, Phase 1 ON HOLD)

---

## 1. WELL-DEFINED PROMPT

| Field | Definition |
|---|---|
| **STACK** | Frontend: React 18 + TypeScript + Vite (SPA), Tailwind CSS. Backend: Node.js ≥ 22 + TypeScript + Express. Persistence: SQLite via built-in `node:sqlite` (zero added dependency). Execution layer: MetaApi cloud API (v1) behind a swappable `ExecutionAdapter` interface. |
| **CONTEXT** | The trader analyses markets exclusively on TradingView and executes on MetaTrader 4/5 accounts (live, prop-firm, demo). Today every signal must be re-entered manually in MT4/MT5 — slow, error-prone, and it forces leaving TradingView. TradingView has **no direct MT4/MT5 integration**; the only official outbound channel is **webhook alerts** (requires a TradingView paid plan with webhooks + 2FA). MT4/MT5 accept programmatic orders either through an Expert Advisor inside a running terminal or through a cloud MetaTrader API service (e.g. MetaApi). |
| **GOAL** | When a TradingView alert fires, the system automatically places the corresponding order on the configured MT4/MT5 account(s) with a size derived from that account's configured **risk percentage**, after verifying sufficient funds/margin — with zero interaction in MetaTrader. The trader never leaves TradingView to trade. |
| **CONSTRAINTS** | No secrets in the frontend. No new dependencies without owner approval. Single user for v1. Idempotent execution (TradingView may retry webhooks). Every automated action logged and visible. Global kill switch. Explicit UI states everywhere (loading/error/success/empty). Inline form errors, no silent drops. Mobile-first responsive UI. Errors surfaced, never swallowed. |
| **OUTPUT** | (1) Web dashboard: connect/manage MT accounts, set per-account risk percentage & limits, map symbols, generate ready-to-paste TradingView alert messages, watch a live signal log with execution results, kill switch. (2) Backend API: receives TradingView webhooks, validates, sizes, routes, executes, audits. (3) Execution adapter for MT4/MT5. |

---

## 2. EXPATIATION OF THE IDEA (how it actually works)

```
┌────────────────┐  webhook POST (JSON)  ┌─────────────────────────────┐
│  TradingView   │ ────────────────────► │        BACKEND API          │
│  alert fires   │                       │  1. Verify token/HMAC       │
└────────────────┘                       │  2. Dedupe (idempotency)    │
                                         │  3. Parse + validate signal │
                                         │  4. Risk engine checks      │
                                         │     (kill switch, limits,   │
                                         │      margin/balance)        │
                                         │  5. Compute lot size        │
                                         │  6. Execute via adapter ────┼──► MT4 / MT5 account
                                         │  7. Record audit trail      │     (demo / propfirm / live)
                                         └──────────────┬──────────────┘
                                                        │ REST
                                         ┌──────────────▼──────────────┐
                                         │   DASHBOARD (React SPA)     │
                                         │   accounts · risk · signals │
                                         │   symbol map · kill switch  │
                                         └─────────────────────────────┘
```

**The "trade" on TradingView.** TradingView cannot expose your manual order tickets to third parties. Automation is driven by **alerts**: you attach an alert (price level, indicator condition, or Pine Script strategy order fills) to your setup and paste our generated JSON message + webhook URL into it. When the alert fires, that JSON is what tells our backend *what* to trade. This is exactly how every commercial product in this space works (PineConnector, SignalForge, Webhook.Trade).

**"I just put the amount."** The risk amount is configured **per account** in the dashboard, e.g. "$50 per trade" or "2% of balance" on each connected account. When a signal arrives, the system **fans out to every enabled account**: each account is sized independently from its own risk amount + the setup's SL distance (using that broker's tick value and lot constraints), and each gets its own margin check before sending. Insufficient funds on one account → **that account's** execution is rejected with a visible reason — never silently, and without blocking the other accounts.

**Account types.** Demo, prop-firm and live accounts are all ordinary MT4/MT5 logins from the system's point of view — each is stored as an `Account` record with a `kind` tag. Prop-firm note: you must confirm your firm permits automated/algorithmic execution before going live on a funded account.

**What "monitor my TradingView for live market" does NOT mean.** TradingView does not allow external apps to read its charts or stream its data. The app does not scrape or poll TradingView. The only touchpoint is the alert webhook. (If we later want live prices inside the dashboard, they come from the broker/execution API, not TradingView.)

### 2.1 What TradingView actually exposes — verified feasibility of the three input modes

These were checked against TradingView's documentation and developer reality (Sept 2026), per the owner's instruction that the plan must never *assume* access to TradingView internals:

| Input mode | On tradingview.com (their site) | Inside our app (licensed Charting Library) |
|---|---|---|
| **1. TradingView inside the application** | ❌ **Impossible.** tradingview.com blocks iframe embedding (X-Frame-Options/CSP `frame-ancestors`); there is no client-side workaround, and proxying/scraping the site violates their ToS. The user's account workspace (their charts, their drawings) **cannot** be embedded. | ✅ **Feasible.** TradingView's Charting Library (free for personal/non-commercial use; license approval from TradingView) renders real charts with drawing tools in our app — but the data feed is ours (broker quotes via MetaApi), and the drawings made there are *our* drawings, fully readable via the Drawings API (`getAllShapes`, `getShapeById`, drawing events). |
| **2. TradingView alerts → webhook** | ✅ **The only official outbound channel.** Alert fires → JSON webhook to our backend. This is the v1 spine. | n/a (alerts are delivered to our backend regardless of where the user stands). |
| **3. Drawings / trade setups → trade** | ⚠️ **Partial, manual.** Pine Script **cannot read manually drawn objects** at all. The only legitimate route today: right-click a drawn line → create an alert on it → webhook fires on cross — but the drawn levels cannot be reliably auto-templated into the alert message, so the user must include the levels in our JSON template. | ✅ **Full.** Drawings live in our chart, so we read them programmatically, classify them, and convert them into trade instructions (§3A). |

**Consequences baked into this plan:**
- "TradingView inside the application" (mode 1) is delivered as **our own Trade Workspace** (Charting Library + broker data feed + trade overlay), *not* as an embedded tradingview.com session. It is a v2 feature; v1 is alert-driven.
- "The system reads my drawings" is only true for drawings made **in our workspace**, or for drawings on tradingview.com that the user manually attaches an alert to (mode 3-partial).
- The app must **distinguish analysis drawings from intended trades** (§3A.3): nothing is executable by accident.

---

## 3. SYSTEM ARCHITECTURE (3 layers)

### Layer 1 — Signal source (TradingView, external)
- Alert message = structured JSON using TradingView placeholders (`{{ticker}}`, `{{close}}`, `{{strategy.order.action}}`, `{{strategy.order.id}}`, …).
- Webhook URL carries a per-user secret token; body may carry HMAC signature + placeholders for SL/TP.

### Layer 2 — Bridge backend (this project)
Responsibilities, in pipeline order:
1. **Webhook receiver** — auth (token/HMAC), replay/duplicate protection (signal fingerprint + TTL), returns 200 fast, enqueues processing.
2. **Signal parser/validator** — payload is **untrusted input**; strict schema validation; malformed → rejected with reason, never partially applied.
3. **Symbol mapper** — TradingView ticker → broker symbol (e.g. `EURUSD` → `EURUSD.m`), per-account overrides.
4. **Risk engine** — kill switch, per-account enabled flag, max open positions, daily loss ceiling, max lot cap, then **funds check** (free margin / balance) and **lot sizing**.
5. **Execution manager** — idempotency key end-to-end, place/modify/close, bounded retries with backoff, final status recorded.
6. **Audit log** — every signal and every execution attempt with timestamps, decisions, and broker error codes.

### Layer 3 — Execution providers (swappable)
`ExecutionAdapter` interface: `getAccountInfo()`, `getSymbolInfo(symbol)`, `getQuote(symbol)`, `getOrders()`, `getPositions()`, `getDealHistory(positionId)`, `cancelOrder(orderId)`, `placeOrder()`, `closePosition()` where supported. Read broker-stored SL/TP from the actual pending order and resulting position; any unavailable capability blocks the affected safety claim rather than silently succeeding. These are proposed interface requirements, not implemented methods.

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. MetaApi cloud (recommended v1)** | Our backend calls MetaApi REST; MetaApi hosts the terminal layer. | No terminal/VPS to keep alive; MT4 **and** MT5; works 24/7; MetaApi API listed as free, but hosting is billed per deployed account (good fit for v1 demo-first). | Paid third-party hosting per deployed account (list ~$8.76–$28.74/mo at 730 h, plus pay-as-you-go API charges; no free account tier verified — see docs/poc/POC-1-results.md §8); broker credentials transit their cloud (they are an established, widely used service); one more integration to learn. |
| **B. Self-hosted bridge EA** | We write an MQL5/MQL4 EA that polls our backend via `WebRequest`; runs on your Windows terminal/VPS. | Free; credentials never leave your machine; full control. | Terminal + machine must stay online (VPS needed for 24/7); MQL code to write/maintain; MT4/MT5 variants; more moving parts to debug. |
| **C. Python `MetaTrader5` module** | Local Python agent on the MT5 machine. | Free, no EA. | MT5 only; still needs a machine running; not viable for MT4. |

**Recommendation:** build against the `ExecutionAdapter` interface, ship **Option A** first (fastest to a working demo trade), keep the interface so Option B can be added later without touching the pipeline or UI. **Owner decision required.**

---

## 3A. TRADINGVIEW INTEGRATION & TRADE INPUT MODES

All input methods are **different doors into the same pipeline** — never separate products. The execution layer never cares where an instruction came from.

### 3A.1 The three modes, phased

| Mode | Delivery | Phase |
|---|---|---|
| **Alert-driven** | TradingView alert → webhook → backend parses JSON → `TradeInstruction` → risk/sizing → execute. Fully automatic. | **v1** |
| **Manual in-app** | Trade Workspace page: chart + trade panel (entry/SL/TP/direction/risk). Computed size displayed **before** execution; user clicks Execute. | v2 (Charting Library) |
| **Setup/drawing-driven** | User marks a setup on our chart (entry/SL/TP lines). App parses it, shows the computed plan, executes per the configured execution rule (immediately, or as a pending limit/stop at entry — the broker then satisfies "execute when price reaches entry"). | v2 (Charting Library) |

TradingView-site drawings with attached alerts (mode 3-partial) work in **v1** via the standard webhook JSON template — the user types the levels into the message; the backend treats them like any alert.

### 3A.2 Unified internal trade instruction

```
TradingView Alert ─┐
In-app panel ──────┼──► TradeInstruction (canonical) ──► Symbol map ──► Sizing
Chart drawing ─────┘                                    ──► Constraints ──► ExecutionAdapter
```

Defined in §6 (`TradeInstruction`): symbol, direction, orderType (market/limit/stop), entry, stopLoss (**mandatory**), takeProfit, accountId, source. Resolve monetary risk per account from its percentage profile; never accept a dollar amount per trade from the instruction. Every source adapter's only job is to produce this object; validation, risk, sizing, execution are shared 100%.

### 3A.3 Drawing classification rules (v2 — no accidental trades)

A chart object is exactly one of:
1. **Analysis** (default) — never inspected for execution.
2. **Intended trade** — only when the user explicitly uses our "Trade Setup" tool (or converts a drawing via a context action). Anything else stays analysis.
3. **Actionable signal** — an intended trade that has passed validation + sizing and satisfies the execution rule (auto or confirm-mode).

Rule: *an object becomes executable only through an explicit user designation — never by shape, name heuristics, or position on chart.*

**Actionable drawing types — explicit, closed list (owner rule: defined by the application, §3B). Everything not listed here is analysis and can never execute:**

| Type | Carries | Becomes actionable via |
|---|---|---|
| `trade_setup` — our dedicated composite tool | Entry + SL + TP + direction in one shape | Created with the Trade Setup tool — explicit by construction |
| `horizontal_line` | A single price level | Only after the user attaches it via context action ("Set as Entry / SL / TP" on a setup) |
| Trend lines, fibs, rectangles, arrows, text, anything else | — | **Never.** No heuristics, no name-guessing, no position inference |

### 3A.4 Execution principle

- **Manual:** open app → workspace → define setup → see computed size → Execute.
- **Alert-driven:** alert fires → validate → size **per enabled account** (each at its own risk) → execute simultaneously on all enabled accounts (auto mode), or park for confirmation (confirm mode).
- **Setup-driven:** setup designated → parsed → sized → pending order at entry with SL/TP attached.

All three produce the identical `TradeInstruction` and share the same audit trail.

---

## 3B. TRADINGVIEW INTEGRATION — TECHNICAL REALITY & APPROVED ARCHITECTURE *(owner-ratified, 2026-09-28 — authoritative)*

> This section is the product owner's ratified architecture statement. Where any earlier wording in this document differs, this section wins.

**The application must not attempt to embed the public `tradingview.com` workspace** inside an iframe or reproduce it through proxying/scraping. The public workspace cannot be reliably embedded because of security restrictions, and bypassing them is outside the intended integration path. The application uses the **licensed TradingView Charting Library** as the charting layer, subject to TradingView licensing terms.

```text
❌ Public TradingView Workspace → iframe/scraping → Our App        (FORBIDDEN)

✅ Our Application
        │
        ▼
TradingView Charting Library
        ├── Charts
        ├── Indicators
        ├── Drawing tools
        ├── Trade setup visualization
        └── Drawing events/API
        ▼
Our Application Logic
        ├── Trade interpretation
        ├── Risk calculation
        ├── Position sizing
        ├── Validation
        └── Execution
        ▼
ExecutionAdapter
   ┌────┴────┐
   ▼         ▼
  MT4       MT5
```

**Drawing-based trade input.** The application uses the Charting Library's supported Drawings API for trade setups created inside the application's chart. Where supported by the licensed library version, the application can: create chart drawings programmatically; detect and track supported drawing objects; retrieve existing drawings; listen for drawing-related events; associate supported drawings with a trade setup; convert a recognized trade setup into the internal trade representation.

**The application must not assume that every drawing represents an order.** Clear distinction:

```text
Analysis Drawing → No execution
Trade Setup Drawing → Entry + SL + TP + Direction → Risk calculation → Execution workflow
```

The exact drawing types that constitute an actionable trade are **explicitly defined by the application** (closed list — §3A.3).

**Pine Script limitation.** Pine Script must not be treated as a mechanism for reading arbitrary manually created TradingView drawings. The architecture does not depend on `manual drawing → Pine reads it → our app receives it`. Drawings are handled only through our own Charting Library instance's drawing APIs/events.

**TradingView alert input.** Alerts remain a separate supported input channel: configured alert payloads are received and converted into the *same* internal trade instruction used by the chart-based workflow:

```text
Charting Library trade setup ──┐
                               ├──► Internal Trade Instruction → Risk/Validation → ExecutionAdapter → MT4/MT5
TradingView Alert ─────────────┘
```

**Important architectural rule — separation of layers.** The charting interface, alert ingestion, risk engine, and execution layer must remain separate. **Trading logic must not live inside chart components.**

```text
Chart / Alert → Input Adapter → Normalized TradeInstruction → Risk Engine → Validation → ExecutionAdapter → MT4 / MT5
```

This allows additional trade-input methods to be added later without changing the execution engine. (Implementation: one adapter per channel — `server/pipeline/inputs/alertInput.ts` for webhooks; v2 `src/workspace/inputs/drawingInput.ts` for chart events. Each adapter's only output is a validated `TradeInstruction` or an explicit rejection. Adapters MUST type-coerce TradingView's string numerics — POC-2 finding.)

**Resulting product definition.** The application is **not** an application that embeds the TradingView website. It is a trading application that:

1. Uses the licensed TradingView Charting Library for its charting interface.
2. Allows users to create trade setups directly on those charts.
3. Can interpret supported chart drawings as trade instructions.
4. Can receive TradingView alerts as another trade-input source.
5. Converts all inputs into a common internal trade instruction.
6. Calculates position size from the user's monetary risk and the setup's entry/SL distance.
7. Validates the order against account and broker constraints.
8. Routes the order through a swappable `ExecutionAdapter`.
9. Executes the resulting order on supported MT4/MT5 accounts.
10. **Clearly reports execution success, rejection, failure, or unknown execution state.**

The public TradingView website itself is **not a dependency of the application's UI architecture.**

---

## 4. FRONTEND PRE-BUILDING DECISIONS

1. **Framework:** React 18 + TypeScript + Vite. (SPA is correct here: this is a personal dashboard, no SEO needs, and the backend carries the real logic.)
2. **State:** React Context + `useReducer` (per your guideline). **No trading credentials or account secrets ever live in the frontend or localStorage.** Frontend localStorage only caches non-sensitive UI preferences (last-viewed filters, draft form values); all account/signal/execution data flows from the backend API through the repository seam.
3. **Styling:** Tailwind CSS (mobile-first utilities, explicit state styling fast to build). *Owner to confirm; alternative: plain CSS modules.*

Guideline compliance:
- Components never touch storage/API directly → they use context actions/selectors; the **repository seam** (`data/`) is the only place `await`-ed I/O happens, so localStorage mock ↔ real API swap is seamless.
- All I/O is `await`-ed even when mocked locally, matching future API semantics.
- Filtering/derivation lives in `selectors/`, not in component bodies.
- Every async operation renders explicit **loading / error / success / empty** states.
- Webhook payloads are untrusted: parsed + validated server-side; nothing is auto-applied (e.g. unknown symbols are rejected, not guessed).
- **No trading logic in chart components** (owner rule, §3B): the chart emits events; an Input Adapter normalizes them into a `TradeInstruction`; risk/validation/execution live only in their own layers. A future input channel is a new adapter — the execution engine never changes.

---

## 5. COMPONENT STRUCTURE

What the app does → what the user sees → components:

```
App
└── AppShell (nav + connection status banner + KillSwitch quick access)
    │
    ├── DashboardPage ──────────── "what's happening right now?"
    │   ├── AccountStatusCards        balance / equity / connection per account
    │   ├── SignalFeed                live signal log (newest first)
    │   │   └── SignalRow → ExecutionResultCard   ✅/❌/⏳ outcome card (§9 format)
    │   │       + per-account breakdown (fan-out: one row per account result)
    │   ├── ConfirmQueue              pending approvals when executionMode='confirm'
    │   └── KillSwitchToggle          big, explicit, confirm-on-enable
    │
    ├── AccountsPage ─────────────── "which accounts can we trade?"
    │   ├── AccountCard               kind (demo/propfirm/live), status, balance
    │   ├── AddAccountForm            login/password/server/platform/kind (inline errors)
    │   └── AccountToggle             OFF = excluded from NEW fan-out trades; never cancels
    │                                 or closes open trades (owner rule)
    │
    ├── RiskPage ─────────────────── "how much, and what are the guardrails?"
    │   ├── AccountRiskCards          one card per connected account
    │   │   ├── RiskPercentInput      e.g. 1.00 % — set once, never typed per trade
    │   │   ├── RiskBasisRadio        locked reference balance | current account balance
    │   │   ├── ReferenceBalanceField (locked mode only) + reset action
    │   │   ├── ComputedRiskDisplay   live "risk per trade: $50.00" — shown before execution
    │   │   └── LimitsForm            per-account max lot, max open positions, daily loss cap
    │   └── SizingPreview             per-account preview: entry/SL + risk → lots
    │
    ├── SymbolsPage ──────────────── "translate TradingView tickers to broker symbols"
    │   └── SymbolMappingTable        TV ticker ↔ broker symbol, add/edit rows
    │
    ├── AlertBuilderPage ─────────── "set up TradingView without guesswork"
    │   ├── AlertMessageWizard        choose action/side → generates paste-ready JSON
    │   └── WebhookUrlCard            your unique webhook URL + copy button
    │
    └── SettingsPage
        ├── ApiTokenCard              regenerate dashboard token (revoke old)
        └── DangerZone                wipe local cache, disconnect accounts

    ── v2 additions (Trade Workspace phase) ──
    ├── TradeWorkspacePage ────────── "chart + trade without leaving the app"
    │   ├── ChartPane                 TradingView Charting Library + broker feed
    │   ├── TradePanel                entry/SL/TP/direction/risk + SizingPreview gate
    │   ├── TradeSetupTool            designated drawing tool (§3A.3) → instruction
    │   └── DrawingClassifier         analysis vs intended-trade boundary
    └── components/risk/SizingPreview becomes the shared pre-execution gate
        (used by TradePanel in v2; its data shape ships in v1 as SizingResult)
```

Shared atoms (`components/common/`): `Button`, `Input`, `Select`, `Badge`, `Modal`, `ConfirmDialog`, `EmptyState`, `ErrorBanner`, `Spinner`, `CopyButton`.

Shared state needed: accounts, signals, executions, risk settings, kill-switch state, connection status → global context. Local/temporary state (`useState`): form field values, wizard step, active filters.

---

## 6. DATA MODEL

What the app must remember, what each holds, its states, connections, and what's needed later.

```ts
// ─── Entities (persisted, server-side) ───────────────────────────────

type Platform  = 'mt4' | 'mt5';
type AccountKind = 'demo' | 'propfirm' | 'live';
type AccountStatus = 'connected' | 'disconnected' | 'error' | 'connecting';

interface Account {
  id: string;
  name: string;                 // user label: "FTMO 100k", "Exness Demo"
  platform: Platform;
  kind: AccountKind;
  brokerServer: string;         // e.g. "Exness-Real14"
  login: string;                // MT login number
  // password: stored ONLY server-side, encrypted (AES-256-GCM). Never in API responses.
  adapterRef: string;           // id of the account in the execution provider (e.g. MetaApi account id)
  enabled: boolean;             // OFF = excluded from NEW fan-out trades. Owner rule:
                                // toggling OFF never cancels or closes open trades.
  incidentIds: string[];        // persisted fences evaluated per submission; independent accounts need not share a block
  risk: AccountRiskProfile;     // fan-out sizes each account at ITS OWN risk (see below)
  status: AccountStatus;        // runtime; recomputed on heartbeat, not trusted from storage
  createdAt: string;
}

// ─── Canonical instruction — every input mode funnels into this (§3A) ─

type OrderType = 'market' | 'limit' | 'stop';
type Direction = 'buy' | 'sell';
type InstructionSource = 'tv_alert' | 'in_app_panel' | 'chart_drawing';

// Persist each incident separately from a trade/order and evaluate its scope
// BEFORE fan-out or submission. Missing isolation proof defaults to account scope.
interface IncidentFence {
  id: string;
  cause: 'unknown_exposure' | 'protection' | 'shared_dependency';
  scope: 'setup' | 'account' | 'shared_service';
  setupId?: string;             // only for objectively proven setup isolation
  affectedAccountIds: string[]; // shared failure = all dependent accounts; unknown map blocks all
  state: 'blocked' | 'reconciled_waiting_owner' | 'owner_resumed';
  evidenceRefs: string[];       // timestamped account exposure, margin, state, calculation, protection proofs
  openedAt: string;
  resolvedAt?: string;
  resumedAt?: string;           // separate owner event; never dispatch on this transition
}

interface TradeInstruction {
  id: string;
  source: InstructionSource;    // recorded for audit; execution layer ignores it
  sourceRef?: string;           // alert fingerprint | shape id | panel session id
  symbol: string;               // as-received ticker (mapped to broker symbol later)
  direction: Direction;
  orderType: OrderType;         // market | limit | stop
  entry?: number;               // required for limit/stop; market uses live price
  stopLoss: number;             // MANDATORY (decision #2) — missing SL ⇒ reject
  takeProfit?: number;
  // Monetary risk is resolved per account from AccountRiskProfile; never accept
  // a dollar-risk override from an alert or user. A provisional pending-order
  // revision is distinct from the actual broker-accepted revision at fill.
  accountId?: string;           // OPTIONAL explicit single-account override (power feature);
                                // absent ⇒ fan out to ALL enabled accounts (owner rule)
  createdAt: string;
}
// Note: 'close' / 'close_all' directives are not sizing-carrying instructions;
// they travel as a CloseDirective { symbol?, accountId? } — a close fans out to every
// account that actually holds a matching open position (others are skipped, audited).

// ─── Signal (one inbound event; v1 source = TradingView alert) ───────

// Aggregation across fan-out executions:
//   executed = all target accounts filled · partial = some succeeded, some rejected/failed
//   rejected = rejected before any account was attempted · failed = attempted everywhere, none filled
type SignalStatus = 'received' | 'validated' | 'executed' | 'partial' | 'rejected' | 'failed' | 'unknown'; // an unknown account cannot aggregate as definitive success/failure

interface Signal {
  id: string;                   // uuid
  fingerprint: string;          // hash(payload + window) → duplicate-order protection
  source: InstructionSource;
  receivedAt: string;
  rawPayload: string;           // kept verbatim for audit — UNTRUSTED input
  instruction?: TradeInstruction;   // present once parsing + validation succeed
  status: SignalStatus;
  rejectReason?: string;        // ALWAYS populated when rejected — no silent drops
}

// ─── Execution state machine ─────────────────────────────────────────
//
//  received → validated → sized → (awaiting_confirm) → submitting →
//  submitted → partial_filled → filled → closed
//
//  Rejection/failure branches (terminal, with mandatory reason):
//    validated ─x→ rejected_invalid    (bad payload, unknown symbol, missing SL)
//    sized     ─x→ rejected_risk       (kill switch, limits, lot constraints unsatisfiable)
//    sized     ─x→ rejected_margin     (insufficient margin — shown on the ❌ card)
//    pre-send  ─x→ failed_pre_submit (only with proof request never left)
//    broker result ─x→ rejected_broker (definitive correlated numericCode)
//    send/cancel/replace ─?→ unknown (ambiguous timeout, HTTP error, conflict;
//                                     never blindly retry, preserve incident fence)
//
//  Terminal states never silently transition out. If MT5 rejects it,
//  the record says NOT EXECUTED — the app never pretends otherwise.
//  If the outcome is unknowable, the record says UNKNOWN: the reconciler
//  queries orders/positions/deals by ticket and bounded correlation identifiers.
//  A comment can be altered and is not a broker exactly-once guarantee.
//  Unresolved evidence remains UNKNOWN with the incident fence in force; escalate to owner.
//
//  EXECUTION LOCK BOUNDARY: broker-side pending orders commit volume before fill.
//  Desired risk remains live while untriggered, but a fill may use the LAST
//  BROKER-CONFIRMED order revision during cancel/reconcile; record actual execution
//  and deviation from latest desired risk. Lock filled quantity at actual trigger;
//  never claim pending placement ('submitting') equals the entry trigger.
//  Persist a scope-aware incident fence: UNKNOWN exposure or unverified/mismatched
//  SL/TP blocks the affected account unless objective evidence proves setup-only
//  isolation (including unaffected account exposure, shared margin, state and
//  calculations); shared service failure blocks all dependent accounts. When
//  isolation cannot be proven, widen the fence. Resolve exposure/protection
//  before a separately authorized resumption (or authoritative zero exposure).
//  Unblocking discards stale intent and NEVER sends, replays or replaces an order.

type ExecutionStatus =
  | 'received' | 'validated' | 'sized' | 'awaiting_confirm'
  | 'submitting' | 'submitted' | 'partial_filled' | 'filled'
  | 'rejected' | 'failed' | 'unknown' | 'closed';
// Additional orthogonal, persisted states: cancel_requested, cancel_acknowledged,
// reconciling, final_canceled/partial/filled; protectionStatus = confirmed |
// mismatched | unverified | not_applicable; incident fence = blocked |
// reconciled_waiting_owner | owner_resumed. None implies a trade on transition.

interface Execution {
  id: string;
  signalId: string;             // FK → Signal
  accountId: string;            // FK → Account
  idempotencyKey: string;       // correlation aid, NOT broker-enforced exactly-once; durable fence and reconciliation required
  brokerSymbol: string;
  instruction: TradeInstruction;  // snapshot of exactly what was sent
  riskSnapshot?: {              // EXECUTION LOCK (owner directive): frozen at trigger time
    riskPercent: number; riskBasis: RiskBasis;
    referenceBalance: number;   // the locked value, or balance at trigger for 'current'
    monetaryRisk: number;       // the $ figure actually used — displayed in the UI
  };
  sizing?: SizingResult;        // what the risk engine computed — this IS the preview
  replacesExecutionId?: string; // set when a managed UNFILLED order was cancel+replaced
                                // after a risk-config change (pre-fill re-sizing)
  requestedLots?: number;
  orderRef?: string;            // broker order/position id
  filledLots?: number;          // < requestedLots ⇒ partial fill, surfaced in UI
  fills?: { lots: number; price: number; at: string }[];   // fill history
  requestedPrice?: number;
  filledPrice?: number;         // slippage = filledPrice − requestedPrice, displayed
  status: ExecutionStatus;
  rejectReason?: string;        // e.g. "Insufficient margin" — drives the ❌ card
  brokerErrorCode?: string;     // surfaced verbatim in the UI
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

interface SizingResult {
  slDistance: number;           // |entry − SL| in price units
  ticks: number;                // slDistance / tick_size
  lossPerLot: number;           // account-currency loss for 1.00 lot
  rawLots: number;              // resolved monetaryRisk / lossPerLot (unrounded)
  lots: number;                 // final, clamped value actually sent
  clamped: boolean;             // true if min/max/step changed rawLots
  marginRequired: number;
  freeMarginAtCheck: number;
  symbolSpec: {                 // broker/contract facts used (audit trail)
    contractSize: number; tickSize: number;
    volumeMin: number; volumeMax: number; volumeStep: number;
  };
  quoteSnapshot: { at: string; bid: number; ask: number;
    lossTickValue: number; profitTickValue: number; source: string;
    accountCurrency: string; conversionRate?: number; conversionAt?: string;
  }; // values/FX verified and fresh; numeric ages pending provider review
}

// ─── Settings (per user) ─────────────────────────────────────────────

type ExecutionMode = 'auto' | 'confirm';   // global; default 'auto' (decision #7, resolved)
type RiskBasis = 'locked' | 'current';

// Risk is PER-ACCOUNT (fan-out sizes every target account at its own risk — owner rule).
// The user configures a fixed RISK PERCENTAGE once per account; they never enter a
// dollar risk amount per trade (owner directive, §15 decision #13).
interface AccountRiskProfile {
  riskPercent: number;             // e.g. 1.0 = 1% of reference balance per trade
  riskBasis: RiskBasis;
  // 'locked'  → monetary risk = riskPercent × lockedReferenceBalance.
  //              Wins/losses do NOT change it: $5,000 @1% stays $50 after a $50 loss,
  //              until the user edits or resets the reference balance.
  // 'current' → monetary risk = riskPercent × the account's latest balance, resolved
  //              live at trigger time: $5,000→$4,950 ⇒ $49.50; later $5,200 ⇒ $52.
  lockedReferenceBalance?: number; // required iff riskBasis === 'locked'
  maxLotsPerTrade: number;         // hard cap on this account
  maxOpenPositions: number;
  dailyLossLimit?: number;         // $ on this account — reject new entries once breached
}

interface AppSettings {
  executionMode: ExecutionMode;                // 'auto' (default) | 'confirm'
  newAccountRiskTemplate: AccountRiskProfile;  // copied into each account at connect time
}

interface SymbolMapEntry { tvTicker: string; brokerSymbol: string }
```

**States each thing can have:** listed inline above (`status` fields). Key invariant: `Signal.status = 'rejected'` ⇒ `rejectReason` non-empty.

**Connections:** `Signal 1 → 0..n Execution` (fan-out: one per target account); `Execution n → 1 Account`; `Account.risk` drives sizing per account; `SymbolMapEntry` consulted during validation per target account.

**Deliberately NOT stored (computed/derived):**
- Balance / equity / free margin — fetched live from the adapter on demand. Storing it would show stale money.
- Lot size — computed per signal from amount + SL distance + broker symbol info.
- Connection health — recomputed, never trusted from disk.

**Needed later (kept as hooks, not built in v1):** `notifications` (Telegram/Discord per execution), `copyTrading` fan-out to multiple accounts per signal, `strategy` tags per signal, `trailing/breakeven` management.

---

## 7. STATE MANAGEMENT APPROACH

Following your pattern — Components → Context → Reducer → Repository → Storage/API:

**State (what the app currently knows):**
```ts
interface AppState {
  accounts: Account[];          // includes each account's risk profile + on/off toggle
  signals: Signal[];            // newest 100 for the feed; older via API paging
  settings: AppSettings;        // executionMode + template for new accounts
  symbolMap: SymbolMapEntry[];
  killSwitch: boolean;
  webhookUrl: string;           // derived display value
}
```

**Status (data-loading status per slice):**
```ts
type AsyncStatus = 'idle' | 'loading' | 'success' | 'error';
interface AppStatus {
  accounts: AsyncStatus; signals: AsyncStatus; settings: AsyncStatus;
  lastError?: { slice: string; message: string };   // surfaced, never swallowed
  saving?: string[];   // which mutations are in flight (for button spinners)
}
```

**Actions (what the app can do):**
`INIT_LOAD`, `ACCOUNTS_LOADED`, `ADD_ACCOUNT_REQUEST/OK/ERR`, `TOGGLE_ACCOUNT` (OFF excludes from future fan-out only), `REMOVE_ACCOUNT`, `ACCOUNT_RISK_UPDATED`, `SIGNALS_RECEIVED` (poll), `APP_SETTINGS_UPDATED`, `SYMBOL_MAP_UPDATED`, `KILL_SWITCH_TOGGLED`, `TOKEN_REGENERATED`, `SET_STATUS`, `CLEAR_ERROR`.

**Temporary vs persistent:**
- Temporary (`useState`, component-local): form inputs, wizard step, filters, confirm-dialog open state.
- Persistent (server DB): accounts (incl. per-account risk profiles), app settings, symbol map, signals, executions.
- Persistent (frontend localStorage only, non-sensitive): UI preferences (feed filters). Through the same async repository seam.

**Selectors** (`selectors/`): `selectFanOutTargets` (enabled **and** connected accounts — the fan-out set), `selectRecentSignals(state, filter)`, `selectSignalStats` (executed/partial/rejected/failed counts), `selectAccountHealth`, `selectSizingPreview(account, slDistance, symbolInfo)` (per-account preview). Pure functions → unit-testable.

**Repository seam** (`data/`): `accountsRepo`, `signalsRepo`, `settingsRepo`, `alertsRepo` — each an async interface. v1 implementation = HTTP client to backend; a localStorage-backed mock implementation powers UI development and tests before the backend exists. Debounce: local preference saves debounced 500ms; server mutations are discrete requests (no write coalescing for anything money-related).

---

## 8. FILE STRUCTURE

Root responsibilities: config · `src/` (frontend) · `server/` (backend) · `tests/` (e2e).

```
noads-trade-tracker/
├── package.json, vite.config.ts, tsconfig.json
├── tailwind.config.js, postcss.config.js
├── .env.example                      # META_API_TOKEN, WEBHOOK_SECRET, ENCRYPTION_KEY — values never committed
├── README.md
├── docs/ARCHITECTURE.md              # this file
│
├── src/                              # FRONTEND
│   ├── main.tsx, App.tsx
│   ├── types.ts                      # the data model above
│   ├── pages/
│   │   ├── DashboardPage.tsx, AccountsPage.tsx, RiskPage.tsx,
│   │   ├── SymbolsPage.tsx, AlertBuilderPage.tsx, SettingsPage.tsx
│   ├── components/
│   │   ├── common/                   # Button, Input, Select, Badge, Modal, …
│   │   ├── dashboard/                # SignalFeed, SignalRow, AccountStatusCards, KillSwitchToggle
│   │   ├── accounts/                 # AccountCard, AddAccountForm, AccountToggle
│   │   ├── risk/                     # AmountForm, LimitsForm, SizingPreview
│   │   ├── symbols/                  # SymbolMappingTable
│   │   └── alerts/                   # AlertMessageWizard, WebhookUrlCard
│   ├── context/
│   │   ├── AppContext.tsx            # provider + useApp() hook
│   │   └── appReducer.ts             # pure reducer + action types
│   ├── selectors/
│   │   ├── accountSelectors.ts, signalSelectors.ts, riskSelectors.ts
│   ├── data/                         # repository seam (the ONLY place I/O happens)
│   │   ├── apiClient.ts              # fetch wrapper: auth header, error normalization
│   │   ├── accountsRepo.ts, signalsRepo.ts, settingsRepo.ts, alertsRepo.ts
│   │   └── localPrefs.ts             # debounced localStorage for UI prefs only
│   ├── hooks/
│   │   ├── useAsyncAction.ts         # wraps mutations: sets status, surfaces errors
│   │   └── useSignalPolling.ts
│   ├── workspace/                    # v2 Trade Workspace (Charting Library)
│   │   ├── chartPane.ts              # widget init + broker datafeed — NO trading logic here (§3B)
│   │   └── inputs/
│   │       └── drawingInput.ts       # drawing events → TradeInstruction (chart-side adapter)
│   └── styles/global.css
│
├── server/                           # BACKEND (Node + Express + TS)
│   ├── index.ts                      # bootstrap, config, listen 0.0.0.0
│   ├── config.ts                     # env parsing (fail fast if secrets missing)
│   ├── db/
│   │   ├── schema.ts                 # SQLite via node:sqlite — zero extra deps
│   │   └── migrate.ts
│   ├── routes/
│   │   ├── webhook.ts                # POST /webhook/:token — TradingView entry point
│   │   ├── accounts.ts, settings.ts, signals.ts, alerts.ts, auth.ts
│   ├── pipeline/
│   │   ├── inputs/                   # one adapter per input channel (§3B separation rule);
│   │   │   │                         # each outputs a TradeInstruction or an explicit rejection
│   │   │   └── alertInput.ts         # TradingView webhook payload → TradeInstruction (untrusted input)
│   │   ├── dedupe.ts                 # fingerprint TTL store
│   │   ├── reconciler.ts             # UNKNOWN → correlate ticket/orders/positions/deals/history; comment is only a hint
│   │   ├── riskEngine.ts             # kill switch, limits, funds check
│   │   ├── lotSizing.ts              # amount + SL distance → clamped lots (pure, unit-tested)
│   │   └── executor.ts               # idempotency, retries, audit writes
│   ├── adapters/
│   │   ├── ExecutionAdapter.ts       # the interface
│   │   ├── MetaApiAdapter.ts         # v1 implementation
│   │   └── (future: LocalEaAdapter.ts)
│   ├── services/
│   │   ├── accountService.ts         # provisioning + heartbeat
│   │   └── crypto.ts                 # AES-256-GCM for broker passwords
│   └── jobs/
│       └── retryQueue.ts             # in-memory bounded retry/backoff (v1)
│
└── tests/
    ├── unit/                         # lotSizing, riskEngine, signalParser (vitest — approved in §15 #4)
    └── e2e/                          # webhook → simulated execution happy/sad paths
```

Folders were created per responsibility (UI / state / derived data / persistence / reusable logic / verification), kept flat and boring; `adapters/` and `jobs/` have explicit room to grow (Option B EA adapter, real queue) without restructuring.

---

## 8A. POSITION-SIZING ENGINE (formal specification)

The user defines **Entry, SL, TP** on the setup and configures a **risk percentage per account** — never a dollar amount per trade, never pips, points or lots. The engine resolves the monetary risk and computes the size using only broker-authoritative symbol data.

**Step 0 — monetary risk resolution (at trigger time, per account):**

```
risk_basis_balance = 'locked'  → lockedReferenceBalance         (static until user resets)
                     'current' → latest account balance         (resolved live at trigger)
monetary_risk      = riskPercent × risk_basis_balance           # e.g. 1% × $5,000 = $50
```

**Fan-out rule (owner decision #8):** the engine runs **once per eligible account** (enabled **and** connected), using that account's own `AccountRiskProfile` (its amount/mode, caps, loss limit), its symbol mapping, and its free margin. Per-account results are fully independent: one account's block or rejection never blocks the others, but that account receives **no new submission** while blocked; the Signal aggregates to `executed` / `partial` / `failed` / `unknown` without hiding any unknown account.

**Inputs**
- From the instruction: `direction`, `entry`, mandatory `stopLoss`; per-account monetary risk is derived from the account's fixed risk percentage, not a dollar amount in the instruction.
- From the broker: validated instrument `contract_size`, `tick_size`, volume rules, leverage/free margin; fresh direction-appropriate bid/ask with source timestamp and `lossTickValue`/`profitTickValue` from `/current-price` (not assumed in the REST symbol specification). Verify account-currency units and a fresh conversion path/rate when necessary. Reject missing, invalid, stale or inconsistent inputs; quote age = decision time minus source time with documented clock semantics. Numerical age/conversion limits remain unapproved pending provider review.

**Algorithm (pure function → 100% unit-tested)**
```
sl_distance   = |entry − stopLoss|                      # direction sanity-checked
ticks         = sl_distance / tick_size
loss_per_lot  = ticks × validated_quote.lossTickValue    # account currency, per 1.0 lot
raw_lots      = monetary_risk / loss_per_lot
lots          = floor(raw_lots / volume_step) × volume_step   # ALWAYS round DOWN:
                                                        # rounding up would exceed stated risk
REJECT if lots < volume_min          → reason: risk_below_minimum_lot
REJECT if lots > volume_max          → reason: max_lot_exceeded   (never silently clamp)
REJECT if lots > maxLotsPerTrade     → reason: risk_cap_exceeded
margin_required ≈ (lots × contract_size × entry) / leverage
REJECT if validated margin requirement exceeds available free margin (any extra buffer requires approved, broker-tested policy) → insufficient_margin
OTHERWISE submit only after current quote/FX/session/margin checks; read back broker-stored SL/TP on pending and resulting position. Inconclusive/mismatch → scope-aware incident fence (§8A); never confirmed protection.
```

**Worked example (owner's spec; illustration, not a fresh live quote):** Account risk **1% on a $10,000 reference balance → $100 monetary risk**. XAUUSD — entry 2650.00, SL 2640.00, TP 2670.00. Broker spec: contract 100 oz, tick 0.01, step 0.01, min 0.01, max 100, leverage 1:500. Assumed validated quote: `lossTickValue` $1.00/tick/lot in account currency.
```
sl_distance  = 10.00        ticks = 10.00 / 0.01 = 1000
loss_per_lot = 1000 × $1.00 = $1,000 per lot
raw_lots     = $100 / $1,000 = 0.10  → step-clamp → 0.10 ✓ (min/max ✓)
margin_req   = 0.10 × 100 × 2650 / 500 ≈ $53  (illustration only; broker margin must be checked)
⇒ BUY 0.10 lots, SL 2640, TP 2670 — maximum planned loss ≈ $100
```

**Broker-side pending setups, cancellation races & execution lock (ratified policy; provider finality unverified)**
- Preserve current *desired* per-account risk while untriggered, separately from the last *broker-confirmed* pending volume/risk revision. Serialize operations per account/setup with a durable intent/fence; an ID/comment is correlation, NOT broker-enforced deduplication. The broker may fill the old order at committed volume before/during/after cancel. Lock the **actual** filled slice/order terms at trigger, record deviation from newest desired settings, and never retroactively claim latest risk governed it.
- On risk change, mark cancel requested; distinguish request, acknowledgement and final state. Reconcile the original order, any positions and all linked deals/history with complete volume accounting. Only authoritative final cancellation **plus sufficiently complete evidence of zero fills** permits a fresh validated replacement intent. A single empty list, acknowledgement, correlation ID or elapsed time is insufficient. Conflicting/incomplete evidence → UNKNOWN and scope-aware incident fence; no replacement or blind retry.
- Partial fill: separately record filled exposure and remaining order volume; **never automatically replace**. Automatic residual cancellation is disabled until provider/broker behavior and uncertain outcomes are validated. No automatic amend/close/reduce/offset. Unquantifiable actual risk is UNKNOWN, not zero.
- Exposure/protection incident: block new submissions on the affected account unless objective isolation evidence proves exposure, shared margin, account state and calculations are unaffected; then block only the affected setup/order. Reconcile original, residual, positions, deals and possible replacement; timestamp source queries/states and final reconciliation. Verify broker-stored SL/TP for every active pending order and resulting position; owner acknowledgement cannot override unverified/mismatched protection for Phase 1. Zero exposure permits protection N/A only with authoritative evidence. Preserve warning; clear stale replacement intent; separate explicit owner authorization is required to resume. Incident resolution/unblocking never executes an order; only a future independent signal can enter validation. Any late fill, deal, changed residual or contradictory protection immediately re-blocks.
- UNKNOWN reconciliation uses bounded backoff/retry and escalates to a human at the maximum interval without declaring success or lifting the block. Numeric thresholds, negative-history finality, quote/FX freshness and residual-cancel behavior require provider/broker validation before an executable test.
- The preview shows actual size and **planned** loss before execution; gaps/fees and fill races may exceed the estimate. Settings changes after fill do not mutate running exposure. Broker-native pending volume cannot be guaranteed equal to newest desired risk at exact trigger.

**Display-before-execution rule (owner requirement)**
- In-app manual/setup trades (v2): the computed size panel is **mandatory** before the Execute button enables.
- Alert-driven (v1): full automation cannot literally pause for a human, so two safeguards: (a) the `SizingResult` preview is written into the execution record before submission (auditable "what the app saw"), and (b) `executionMode: 'confirm'` parks alert-driven orders in `awaiting_confirm` for explicit approval. Default is `auto` (§15 #7); `confirm` is optional.
- **If constraints cannot be satisfied, the trade is NOT executed** — the ❌ card in §9 shows exactly why.

**Other handled behaviors (owner's checklist → where they live)**
| Concern | Where |
|---|---|
| Market / limit / stop orders | `TradeInstruction.orderType`; limit/stop sent at `entry` with SL/TP |
| Multiple MT4/MT5 accounts; demo/live separation | v1 **fan-out**: every enabled account receives every signal, sized at its own risk; `Account.enabled` OFF excludes from new trades only — open trades untouched (owner rule) |
| Broker symbol differences | `SymbolMapEntry` per account |
| Balance/equity & margin checks | Risk engine pre-flight (above) |
| Min/max/step lots | Sizing clamps + REJECT rules (above) |
| Duplicate-order protection | fingerprint dedupe + durable per-account/setup fence, broker reconciliation; correlation key is not an exactly-once guarantee |
| Connection failures | `failed_pre_submit` only if request demonstrably never left; ambiguous POST/timeout/5xx/429 → UNKNOWN, bounded read-only reconciliation and scope-aware incident fence; no blind trade retry |
| Broker rejection | `rejected_broker` + error code verbatim on ❌ card |
| Slippage | `filledPrice − requestedPrice` displayed on the result card |
| Execution confirmation | execution result card + optional provider-side confirmations |
| Partial fills | `partial_filled` + deal-linked filled/residual volumes; never auto-replace, residual cancel disabled pending validation |
| Trade history | execution ledger **and broker deal/order history reads for reconciliation in v1**; optional user-facing history view (phase 5) |
| Audit logs | `rawPayload` + `SizingResult` + every state transition stored |
| Unknown execution state | `unknown` + scope-aware fence; reconcile by ticket, bounded correlation, linked orders/positions/deals/history; incomplete/contradictory evidence remains UNKNOWN and escalates; never blindly retry or treat a comment as guaranteed uniqueness |
| Risk basis modes & execution lock | §8A Step 0 + actual fill snapshot; cancel/reconcile before any replacement, with scope-aware fence on uncertainty |

---

## 9. UI STATES & ERROR HANDLING (cross-cutting)

- Every data slice renders **loading / success / error / empty** explicitly — no blank ambiguity.
- **Inline form errors** under each field (AddAccountForm, AmountForm); submit disabled until valid; server-side validation errors mapped back to fields.
- **No silent drop rule:** a rejected signal always shows *why* (unknown symbol, kill switch on, insufficient margin, lot cap exceeded, broker error code). The Signal row carries `rejectReason` end-to-end.
- Kill switch ON → global red banner on every page; webhook executions reject with reason `kill_switch_on`.
- Execution failures show the broker error verbatim + retry count + "what to do" hint (e.g. "check Algo Trading is enabled" equivalents per provider).
- **`ExecutionResultCard` — the explicit outcome component (owner-mandated format):**
  ```
  ❌ ORDER FAILED                     ← red   (✅ EXECUTED green / ⏳ PENDING amber)
  XAUUSD BUY 0.50 lots                ← symbol, direction, lots
  Reason: Insufficient margin         ← rejectReason; broker error verbatim below it
  MT5 Account: Demo — Broker XYZ      ← account kind + name + broker server
  Status: NOT EXECUTED                ← never ambiguous; never pretends a fill happened
  ─────────────────────────────────
  12:04:11 · signal #a1b2 · attempt 1 · [Details] [Retry when safe]
  ```
  Success variant additionally shows fill price and slippage (`EXECUTED @ 2650.31, slippage +0.31`) and partial-fill details when applicable.
- Unknown variant: `⚠️ EXECUTION UNKNOWN — reconciling with broker…`; UNKNOWN persists with a scope-aware submission fence: setup-only only with objective proof of account isolation, otherwise affected-account-wide; shared service failure blocks dependent accounts. Owner acknowledgement alone never clears unverified/mismatched SL/TP. Separate owner authorization to resume requires authoritative exposure reconciliation and confirmed protection (or authoritative zero exposure). Unblocking never releases a queued order or replays a signal; late evidence re-blocks and reopens the audit.
- Responsive: mobile-first layouts; dashboard feed and kill switch fully usable on a phone.

---

## 10. SCOPE GUARDRAILS

**IN for v1 (build this, nothing else):**
1. Webhook receiver + auth + dedupe (duplicate-order protection).
2. Signal validation → canonical `TradeInstruction` (§6), symbol mapping.
3. Full sizing engine per §8A: entry/SL/TP + monetary risk → clamped lots, margin check, never-execute-when-unsatisfiable.
4. Order types: **market, limit, stop** — all with SL/TP attached; close-by-symbol and close-all.
5. Explicit **execution state machine** (§6) + `ExecutionResultCard` with owner-mandated ❌ format; slippage + partial-fill surfacing.
6. **Fan-out execution (v1, owner decision #8):** every signal executes simultaneously on **all enabled accounts**, each sized at its own `AccountRiskProfile`; per-account results independent (`executed`/`partial`/`failed` aggregation); toggling an account OFF excludes it from **new** trades only — never cancels/closes open ones; optional single-account override in the alert payload.
7. MetaApi adapter (MT4 + MT5, demo/propfirm/live logins) + connection-failure handling (heartbeat, retries).
8. Dashboard: account status, signal feed with per-account breakdown (execution ledger = v1 trade history), kill switch, confirm-mode approval queue.
9. Account management + on/off toggles, **per-account risk profiles**, app-level `executionMode` (default `auto`), symbol map, alert message builder.
10. Audit log of every signal/execution/state transition. Unit tests for all money math.

**v2 — IN-APP TRADE WORKSPACE (approved direction, separate build phase):**
- TradingView **Charting Library** (license application; free for personal/non-commercial) + broker data feed via MetaApi quotes.
- Mode 1: charts inside the app; trade panel with mandatory sizing preview before Execute.
- Mode 3: "Trade Setup" drawing tool → parsed entry/SL/TP → same unified pipeline; drawing classification rules (§3A.3) enforced.
- Requires decision #9 (start license application) before build begins.

**OUT — explicitly deferred beyond v2:**
- Self-hosted bridge EA adapter (Option B) and Python agent (Option C).
- Partial closes, trailing stops, breakeven management, order modification alerts.
- Notifications (Telegram/Discord/email).
- Multi-user auth / multiple traders.
- Strategy tagging / performance analytics on executed signals.
- Reading drawings from the tradingview.com site itself — **permanently out**: not exposed by TradingView (§2.1); only alert-attached drawings reach us, via webhooks.

---

## 11. BACKEND PLAN (requirements → architecture → technology)

| Requirement? | Answer | Consequence |
|---|---|---|
| A. Persistent data? | Yes — accounts, signals, executions, settings | SQLite (`node:sqlite`) behind a repository layer; upgradable to Postgres later |
| B. Users/accounts? | Single user v1 | Simple password auth (argon2 hash) + session token for the dashboard; webhook auth by per-token URL + HMAC |
| C. Different permissions? | No | Skipped |
| D. Frontend ↔ server logic? | Yes | REST JSON API |
| E. Sensitive operations? | **YES — real orders** | Server-side validation of everything; encrypted broker credentials; env-only secrets (`.env` in `.gitignore`, `.env.example` committed); audit trail |
| F. External services? | Yes — TradingView (inbound webhook), MetaApi (outbound REST) | Adapter layer isolates both |
| G. Async processing? | Yes — retries, heartbeats | v1: durable incident fence and bounded read-only reconciliation; in-memory only is insufficient for UNKNOWN |
| Logging/monitoring | Yes | Structured audit table + plain log; signal feed doubles as ops monitor |

**Technology choice rationale:** Node ≥ 22 gives us built-in SQLite (no ORM/driver dependency) and matches the frontend language, keeping one toolchain. Express is deliberately boring and stable.

---

## 12. SECURITY

- Broker passwords: AES-256-GCM encrypted at rest; key from `ENCRYPTION_KEY` env var; never returned by any API endpoint.
- MetaApi token, webhook secret, encryption key: server env only — **never** in frontend bundles or localStorage.
- Webhook: URL token + HMAC signature check + replay window; malformed payloads rejected with 4xx and logged.
- Dashboard: auth required for everything; token regeneration revokes the old token.
- `.env` git-ignored; `.env.example` documents required variables without values.

---

## 13. TESTING PLAN (how to verify once built)

1. **Unit (money math):** lot sizing across fixed/percent modes, min/max/step clamping, margin-insufficient rejection, risk limits, dedupe fingerprinting.
2. **Integration:** post a signed webhook to a staging server → assert DB rows (signal `executed`, execution recorded) using a **mock adapter** (no real orders).
3. **E2E dry run:** dashboard → connect a **demo** account via MetaApi → use Alert Builder payload with a real TradingView alert on a demo chart → watch signal appear and demo order fill → verify insufficient-funds rejection by setting amount absurdly high → verify kill switch blocks execution with visible reason.
4. **Replay test:** send the identical webhook twice within the TTL → exactly one execution **per enabled account**.
5. **Fan-out tests:** (a) 2 enabled + 1 OFF account → signal executes on exactly the 2 enabled, OFF account untouched; (b) same signal, one account low on margin → that account shows ❌ `insufficient_margin`, the other fills — Signal status `partial`, no trade pretended on the failed one; (c) OFF an account with an open position → position stays open, next signal skips it.

---

## 14. DEPENDENCY BUDGET (owner approval required)

| Dependency | Type | Why | Verdict |
|---|---|---|---|
| react, react-dom, vite, @vitejs/plugin-react, typescript | core | app shell | unavoidable |
| tailwindcss (+ vite plugin) | dev | styling | **confirm** |
| express | runtime | API server | **confirm** (alternative: bare `node:http`) |
| metaapi-cloud-sdk (or plain REST calls — zero deps) | runtime | execution | **confirm approach**; plain `fetch` REST possible |
| vitest | dev | unit tests for money math | recommended |
| ~~any ORM, state lib, UI kit~~ | — | — | none, deliberately |

## 15. DECISION LOG (product owner)

| # | Decision | Outcome | Date |
|---|---|---|---|
| 1 | Execution path (MetaApi vs self-hosted EA) | **RESOLVED: A first — MetaApi cloud, starting on demo account. EA adapter remains a future additive option (interface already designed for it).** | 2026-09-28 |
| 2 | Position sizing when alert has no SL | **RESOLVED: require SL — reject signal with reason `missing_stop_loss`. No fixed-lot fallback.** | 2026-09-27 |
| 3 | Styling | **RESOLVED: Tailwind CSS** | 2026-09-27 |
| 4 | Unit tests (vitest) for money math | **RESOLVED: yes** | 2026-09-27 |
| 5 | TradingView plan with webhooks + 2FA | **RESOLVED: owner confirms they have it** | 2026-09-27 |
| 6 | Trade input modes & unified instruction | **RESOLVED: owner spec adopted (§3A). Unified `TradeInstruction`; v1 = alert-driven; modes 1 & 3 = v2 via Charting Library; reading drawings from tradingview.com itself is permanently out (not exposed by TradingView, §2.1).** | 2026-09-28 |
| 7 | Default `executionMode` | **RESOLVED: `auto`** — alert-driven trades execute immediately after validation; sizing preview stays auditable in every execution record; `confirm` mode remains available per preference. | 2026-09-28 |
| 8 | Multiple MT4/MT5 accounts semantics | **RESOLVED: fan-out in v1.** One signal executes simultaneously on all enabled accounts, each at its OWN risk profile. Account toggle OFF = excluded from NEW trades only; never cancels/closes open trades. Per-account partial failures surfaced explicitly. Optional single-account override retained in the alert schema. | 2026-09-28 |
| 9 | TradingView Charting Library as charting layer | **RESOLVED: owner ratified Charting Library as the only charting layer (§3B). Owner action item: submit the license application (free for personal use) — prerequisite before the v2 workspace build can start.** | 2026-09-28 |
| 10 | Order types market/limit/stop, sizing preview, ❌ failure card, state machine, partial fills, slippage surfacing | **RESOLVED: in v1 scope per owner spec (§8A, §9)** | 2026-09-28 |
| 11 | Owner architecture statement on TradingView integration | **RESOLVED: added verbatim as §3B (authoritative). New hard rules absorbed: tradingview.com never embedded/proxied; Pine Script never a drawing channel; no trading logic in chart components; closed list of actionable drawings; `unknown` execution state must be reported and reconciled (§6, §8A, §9).** | 2026-09-28 |
| 12 | Start of Phase 1 implementation | **ON HOLD** — owner is adding further instructions before build begins. | 2026-09-28 |
| 13 | Per-account risk model | **RESOLVED (owner directive):** fixed risk PERCENTAGE per account; two basis modes — locked reference balance / current balance; monetary risk resolved at trigger time; pending setups re-size on settings change (cancel+replace unfilled); hard execution lock from trigger (§6, §8A). Users never type a dollar risk per trade. | 2026-09-28 |
| 15 | POC-2 (TradingView webhook) | **PASS (2026-10-03).** Real delivery verified via owner capture (UA `TradingView Webhook`, placeholders substituted); receiver replay proved parse/dedupe/401. Findings: string numerics need coercion; alerts bounded by symbol market hours; production receiver needs always-on hosting (deployment-only impact). Results: `docs/poc/POC-2-results.md`. |
| 14 | POC gate before MVP | **RESOLVED (owner directive):** technical-uncertainty review done (§17); POCs required for MetaApi execution (POC-1) and live TradingView webhook (POC-2); MVP Phase 1 blocked until POC results documented. | 2026-09-28 |

---

## 16. EXECUTION PATH COMPARISON (for Decision #1)

### A. MetaApi cloud

| Dimension | Assessment |
|---|---|
| Effort to working v1 | Lowest. One adapter (~REST calls: provision account, account info, place/close order, symbol info). No MQL, no Windows. Estimated ~40% less build time than B. |
| Money cost | **No free account tier verified** (official pricing checked 2026-10-08). Each deployed account is billed hourly: $0.012/h (g2, ≈ $8.76/mo at 730 h) or $0.039376/h (g1, ≈ $28.74/mo), plus deployment fees and pay-as-you-go API charges. Verify on the owner's billing page. Full figures: docs/poc/POC-1-results.md §8. Competitor figure (~$12–14/mo) not re-verified. |
| Infra you must run | Only our backend (already required 24/7 for webhooks). No terminal, no VPS for MT. |
| Platforms | MT4 **and** MT5 through one adapter. |
| Reliability | Provider hosts the terminal layer (99.95%-class SLA advertised); account reconnect handled by them. Downside: their outage = our outage; mitigated by status API + visible "connection error" state in dashboard. |
| Trust | Broker login/password transits and is held by an established third-party cloud. Check your prop firm's ToS on third-party API access. |
| Latency | Webhook → backend → MetaApi → broker. Extra cloud hop; adequate for alert-driven (non-HFT) trading. |
| Failure debug | Two systems (ours + MetaApi), clean API errors. |

### B. Self-hosted bridge EA (we write it)

| Dimension | Assessment |
|---|---|
| Effort to working v1 | Higher. Must write **two** EAs (MQL5 and MQL4 are different APIs) with polling loop, order execution quirks (filling modes, volume steps, requotes), heartbeat, and reconnect; plus backend command queue. ~2.5× the build effort of A. |
| Money cost | $0 for the bridge. But 24/7 trading requires an always-on Windows VPS (~$5–15/mo) unless your own machine stays on. |
| Infra you must run | Backend **plus** MT terminal(s) on Windows, EA attached, Algo Trading green, auto-login configured. Windows updates / terminal restarts = manual intervention risk. |
| Platforms | MT5 first; MT4 = second codebase (doable, but double maintenance). |
| Reliability | You own it. We add EA→backend heartbeat so the dashboard shows "account offline" instead of silently missing signals. |
| Trust | Credentials never leave your machine. Strongest privacy posture. |
| Latency | Polling interval (~0.5–1s) + direct broker execution; no third-party hop. |
| Failure debug | Three systems (backend, terminal, broker) — more surface area. |

### Honest recommendation

Start with **A on your demo account** (one deployed demo account, ≈ $8.76–$28.74/mo at list price, to prove the full loop end-to-end: webhook → risk engine → real fill). Once the pipeline is proven, adding **B** is an additive adapter, not a rewrite — and you can run both (e.g. MetaApi for demo/propfirm, EA for the account you refuse to put in any cloud). The only reason to pick B-first is if no broker credential may ever touch a third party, full stop.


---

## 17. TECHNICAL-UNCERTAINTY REVIEW & POC GATE *(owner directive, 2026-09-28)*

Rule: before MVP Phase 1, every material technical assumption gets either a validated Proof of Concept or an explicit "no POC needed" verdict. POCs build the **minimum code to test the real mechanism** — no production UI, no mocked critical parts, no premature MVP creep. Results are documented in `docs/poc/POC-n-results.md` with: what was tested, result, limitations discovered, and whether the architecture must change.

### Uncertainty register

| # | Uncertainty | Material? | Verdict |
|---|---|---|---|
| U1 | MetaApi can connect the owner's real demo MT account, expose balance/equity/free margin, full symbol specs (tick value/size, contract size, min/max/step), place market/limit/stop orders with SL/TP, report fills/rejections — with the owner's actual broker | **YES — the product depends on it** | **POC-1 required** |
| U2 | The owner's TradingView plan actually delivers the configured alert JSON to our public HTTPS endpoint (payload shape, reliability, retry/duplicate behavior) | YES — the ingestion path | **POC-2 required** (cheap; uses one real alert) |
| U3 | Symbol-spec reliability for sizing (tick_value zero/lazy loading, currency semantics) | YES — wrong spec = wrong risk math | Covered **inside POC-1** (asserts on real spec fields + §8A math) |
| U4 | `unknown`-state reconciliation via order-comment lookup | MEDIUM | Covered **inside POC-1** (set idempotency comment, query by it) |
| U5 | Dedupe/idempotency, SQLite persistence, state machine, fan-out arithmetic | No — standard engineering | No POC; unit tests in Phase 3 |
| U6 | Charting Library integration | Not yet — v2, license-gated | POC when the license is granted |

### POC-1 — MetaApi end-to-end demo execution (critical path)
- **Minimum code:** one Node script (`poc/metaapi-exec.mjs`), zero dependencies (native fetch), no UI, no production files touched.
- **Tests the REAL integration (historical scope; no new run authorized):** connect/provision the owner's demo MT account → wait until DEPLOYED → read balance/equity/free margin → read live symbol spec (XAUUSD or owner's symbol) → run §8A sizing math on the real spec → place a minimum-lot market order with SL/TP + idempotency comment → verify fill + price → close it → place an away-from-market limit order → cancel it → capture a deliberate rejection (bad symbol) with the broker error code. Latency measured at each hop; raw responses logged.
- **Historical prerequisites:** owner-supplied demo account and provider token. A MetaApi account is **not known to be free**; deployment/hosting and possible other charges apply. Secrets stay out of Git.
- **Current acceptance:** [mandatory evidence/conditional cases and cost blockers](poc/POC-1-next-run-plan.md); public [provider evidence/unknowns](poc/MetaApi-provider-evidence.md). A step-count pass or a documented failure alone does not close POC-1; no new execution authorized.

### POC-2 — real TradingView webhook → our receiver
- **Minimum code:** one Node script (`poc/webhook-receiver.mjs`) exposing `POST /webhook/:token` on the sandbox's public HTTPS preview URL.
- **Tests the REAL mechanism:** the owner creates one real alert on their TradingView plan using a generated JSON template and fires it; we verify delivery, payload shape, content-type, and duplicate behavior (manual re-fire within the dedupe window).
- **Pass criteria:** payload arrives intact and parseable; duplicate is detected; any TradingView-side quirks documented.

### Explicit no-POC statement
SQLite persistence, Context/reducer UI plumbing, Tailwind styling, auth, and audit logging carry **no material technical uncertainty** — they are standard, well-trodden engineering. Building POCs for them would violate the owner's "do not expand the POC into the MVP prematurely" rule.

### Gate
**MVP Phase 1 is ON HOLD.** POC-2 is PASS; POC-1 remains OPEN despite a 22/22 scoped run and a separate manual MT5 check. The owner confirmed the demo MT5 account flat after two manual cancellations; that does not prove MetaApi cancellation/SL/TP/reconciliation. POC code lives in `poc/` and never ships into production. Gate 7 requires an evidence-backed POC-1 pass and the owner must subsequently confirm it before Phase 1 starts (unless explicitly changing authorization); documentation preparation, PR merge and offline planning do not lift the hold.

## Phase 1 first slice — implementation plan, ON HOLD (2026-10-10)

This is a ready-to-activate **plan, not implementation approval**. Start only after MetaApi POC-1 has an evidence-backed PASS, the owner subsequently confirms it, and unresolved limitations have explicit fail-closed controls (or the owner separately changes authorization). POC-2 is documented PASS. No production code, dependency, migration or external service is authorized by this section.

1. **Contract and durable store.** On activation, choose the smallest existing stack after confirming deployment/runtime and owner approval of any dependency. Define typed normalized signal, account, setup/order/revision/deal/position, risk snapshot, incident scope, protection and audit-event records. Add durable transactional persistence before network sends; schema/migrations preserve source timestamps, IDs, accepted revisions, filled/residual/actual volume, quote/spec/FX/margin inputs and owner events. Secrets are server-only, encrypted at rest, excluded from logs/API responses. Tests: migration round trip, uniqueness and restart recovery.
2. **Ingress and validation.** Move the proven POC-2 webhook behavior into production isolation (do not reuse its verbatim body/token logging); authenticate before accepting, bounded payload, stable fingerprint/TTL, fast acknowledgement after durable enqueue, error/replay states. Parse TradingView string numerics, validate symbol/order/SL/TP, and reject missing inputs explicitly. Offline contract tests: malformed/auth/replay/window and concurrent duplicates; integration of a real alert requires its own authorization.
3. **Per-account risk and preview.** For each enabled account, validate current directional quote/time interpretation, broker symbol spec, deposit-currency tick value/conversion and age, margin/session and risk mode. Compute raw and rounded-down volume; never clamp up to unaffordable minimum. Persist intended and broker-confirmed risk separately, actual fill exposure separately; missing/stale/contradictory inputs yield UNKNOWN/blocked, never zero. Show preview and reject reasons without promising realized loss. Tests: boundary, currency, stale/clock-skew, min lot, partial and margin cases; do not invent thresholds before POC validation.
4. **Execution and read-only reconciler.** Transactionally fence a unique intent before submitting; strictly one attempted send, no retry of ambiguous sends. Reconcile ticket plus linked orders/deals/positions/history with synchronization, pagination and time-window overlap; store UNKNOWN and stop at any gap/contradiction. Distinguish requested, acknowledged, accepted, partial, residual, final canceled, filled and closed; no auto replacement on partial and no auto residual cancel. For risk revisions, final canceled **and** complete zero-fill proof are prerequisites for a new, separately validated intent. Read back pending and resulting position SL/TP and classify confirmed/mismatched/unverified (N/A only with authoritative zero exposure). Tests: crash before/after send, replay, delayed fill/cancel race, out-of-order and incomplete histories, gaps, and late contradictions using fixtures; provider claims require separate empirical evidence.
5. **Incident scope, resolution, UI.** Persist a fence at setup, account or shared-service dependency scope; setup-only requires objective unaffected account exposure, shared margin, account state and calculations, otherwise widen. Shared outage blocks dependent submissions only; independent reliable accounts can continue. Resolution reconciles exposure and protection; resumption is a distinct authorized event, only after confirmed protection or authoritative zero exposure. On unblock discard stale replacement intent; never auto-send, release parked orders or replay alerts. Existing unprotected exposure gets immediate warning/owner escalation and no unapproved auto remediation. Provide mobile-first status cards for accepted, UNKNOWN, protection, risk, response and owner actions. Tests: isolation proof missing vs present, service dependency, concurrent accounts, owner acknowledgement insufficient, resume no-send, late re-block.
6. **Verification and handoff.** Ship in small reviewed slices with offline unit/fixture tests first; add integration only under later explicit authorization. Document configuration, migrations/rollback, observability, bounded read-only reconciliation limits and incident runbook; exercise restart and kill switch. Definition of done: each transition/audit input is durable and explainable, all negative-path tests pass, no credentials in diff/logs, no unsupported provider assertion, and owner reviews the demonstrated evidence. Leave every empirically unresolved rule fail-closed and visible.
