# POC workspace (NOT production code)

This folder documents earlier POC runs; it does not ship to production. Node ≥22,
zero npm dependencies. See [POC-1 evidence](../docs/poc/POC-1-results.md),
[provider research](../docs/poc/MetaApi-provider-evidence.md), and the
[non-executable follow-up plan](../docs/poc/POC-1-next-run-plan.md).

## POC-1 — MetaApi: OPEN, execution disabled

**Do not run against MetaApi.** `node poc/metaapi-exec.mjs`, including
`--execute-demo` and historical `--cancel-order`, exits with code 2 **before
reading credentials or making any network call**. `poc/debug-list.mjs` is also
disabled before credential access. This is intentional: the historical harness
has no proven budget ceiling, finality, retry fence, or full protection readback.
The implementation after the lock is historical, not execution-ready. Do not
remove the lock without separate owner authorization, a reviewed safety change,
approved quote/FX limits and enforceable cost/cleanup plan. No billable create,
deploy, order, cancellation or API read is approved by the offline tests.

Offline-only checks (no .env.local, token, network, provider dependency or spend):

```bash
node --test poc/metaapi-safety.test.mjs
node --check poc/metaapi-exec.mjs
```

`metaapi-safety.mjs` contains pure exact-account, quote, response, readback,
cancellation and tiered-incident predicates. Unit tests validate these
predicates, **not their integration with the locked historical execution path**
or actual provider guarantees. `reconcileCanceledOrder` only returns a **candidate**, never broker finality,
even when callers claim complete synchronized history; proof of completeness
and negative-history finality remains an empirical blocker.

## POC-2 — TradingView webhook: documented PASS

The earlier real-alert delivery and replay evidence is in
[POC-2-results.md](../docs/poc/POC-2-results.md). The legacy receiver is a
POC, not a production auth/logging design. It now refuses an absent/placeholder
`WEBHOOK_TOKEN`; configure it privately in git-ignored `poc/.env.local` if a
**separately authorized** local replay is ever needed. GET `/` no longer reveals
the token, and server startup does not print it. Historical POC evidence is
unchanged. Do not expose this diagnostic server publicly as a product.

No credentials, IDs, private account data or run logs belong in Git. The
example `.env.example` intentionally contains no secrets.
