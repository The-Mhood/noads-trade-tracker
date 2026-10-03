# POC workspace (NOT production code)

Per owner directive (docs/ARCHITECTURE.md §17): minimum code to validate material
technical uncertainties before MVP Phase 1. Nothing in this folder ships to production.

## POC-1 — MetaApi end-to-end demo execution
Tests the REAL integration (no mocks): demo account connect → balance/margin →
live symbol spec → §8A sizing math on real spec → min-lot market order with SL/TP
+ idempotency comment → verify fill → close → away-from-market limit order →
cancel → capture a deliberate broker rejection. Latency + raw responses logged.

Run:
```bash
cp poc/.env.example poc/.env.local   # then fill in real values (git-ignored)
node poc/metaapi-exec.mjs
```
Requires: Node ≥ 18, zero npm dependencies. Owner prerequisites: free MetaApi
account + token, and a DEMO MT4/MT5 login. NEVER use live/prop-firm credentials here.

## POC-2 — real TradingView webhook → our receiver
Tests REAL alert delivery from the owner's TradingView plan to our public endpoint.

Run:
```bash
node poc/webhook-receiver.mjs        # listens on 0.0.0.0:8790
```
Then create a TradingView alert with the webhook URL given by the engineer and the
JSON template from docs §17/POC-2, fire it, and re-fire it within 2 minutes to
prove duplicate detection. Deliveries are appended to `poc/webhook-received.log.jsonl`.

## Results
Each run's outcome, limitations, and architecture impact are written to
`docs/poc/POC-1-results.md` / `docs/poc/POC-2-results.md` before MVP starts.
