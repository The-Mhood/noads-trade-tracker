# POC workspace — demo-only, not production

**POC-1 OPEN; Phase 1 ON HOLD.** The owner has authorized POC-1 offline development
and execution of all supported demo entry types when the designated MetaApi MT5
demo account, credentials and sufficient provider balance are available. There
are **no credentials or account access in this sandbox**; no broker tests have
run in this revision. Do not request billing screenshots or another general
work authorization. No live/prop-firm accounts, payment-method changes, new
accounts or unrelated services. The old `metaapi-exec.mjs` and `debug-list.mjs`
remain deliberately disabled before I/O; never remove that guard to execute
their historical path.

Read the [eight-case matrix and runbook](../docs/poc/POC-1-next-run-plan.md),
[provider evidence](../docs/poc/MetaApi-provider-evidence.md) and
[historical results](../docs/poc/POC-1-results.md). The new guarded files are:

- `poc1-engine.mjs`: exact demo identity, symbol entitlement, directional quote,
  session/stops/risk checks, write-ahead intent, one send, pending/position SL/TP
  readback, optional safe pending modification and single planned cancel/close.
- `poc1-metaapi-adapter.mjs`: exact-account REST adapter; no account-list scan,
  creation, deployment, upgrade or payment operations.
- `poc1-runner.mjs`: one case per invocation, with a durable ignored local journal.
  It never declares a broker PASS automatically; uncertainty halts further
  submissions. It does not retry an ambiguous POST. Any terminal-visible broker
  evidence and history finality require independent human review.

Safe **offline** commands (Node ≥22, no npm dependencies):

```bash
node poc/poc1-runner.mjs --plan
node poc/poc1-runner.mjs --status
node --test poc/metaapi-safety.test.mjs poc/poc1-engine.test.mjs
for f in poc/*.mjs; do node --check "$f"; done
```

Provider-dependent use on an **authorized, funded demo machine only**: create
private git-ignored `poc/.env.local` from `.env.example`, with the exact existing
demo account ID/login/server/platform and token, approved MetaApi provisioning
and trade hosts, and **independently verified broker UTC offset**. The runner
requires `XAUUSD`, USD account/profit/margin currency and validates min lot,
margin, fresh quote/quote broker time, stops/freeze and trade sessions before a
send. The hardcoded conservative 10-second quote age, 2-second future skew and
$10 per-order *POC-only* downside risk guard are operational preflight checks,
not claims that the broker guarantees freshness or that losses cannot exceed
$10. If any input is unavailable, do not trade. No account-deployment flow is
implemented; if undeployed, provider-dependent tests stop until it is safely
available. Keep credentials private and out of chat/Git.

`node poc/poc1-runner.mjs --run-case E01` through `E08` runs **one** case each,
not a batch. Do not start the next case until the preceding journal is
independently reviewed and any UNKNOWN is resolved. `--reconcile <journal-name>`
is read-only. `--review <journal-name> <evidence-file>` records a local human
attestation of broker finality/zero exposure and the individual verdict; its
JSON must include `caseId`, `caseVerdict`, `brokerFinalityConfirmed`,
`zeroExposureConfirmed`, `protectionConfirmed`, `linkedHistoryVerified`,
`reviewer`, `evidenceRef`. A manually entered attestation is **not itself broker
proof**; retain linked orders/deals/positions/history and any terminal
corroboration. Journals are mode 0600 under `poc/.poc1-journals/` (ignored).
Never place credentials in evidence. If in doubt, stop and follow the incident
runbook instead of clearing a fence. This runner remains untested on the actual
broker; classify its live behavior honestly when access is available.

POC-2's documented TradingView webhook PASS is preserved in
[POC-2-results.md](../docs/poc/POC-2-results.md). Its receiver remains a POC,
not a production authentication/logging design.