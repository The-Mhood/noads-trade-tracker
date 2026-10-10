# POC-2 RESULTS — TradingView webhook delivery

**Date:** 2026-10-03 · **Verdict: PASS** · Owner directive: docs/ARCHITECTURE.md §17

## What was tested
1. That the owner's real TradingView plan (webhooks + 2FA enabled) delivers a configured
   alert payload to an external public HTTPS endpoint, with placeholder substitution.
2. That our receiver (`poc/webhook-receiver.mjs`) parses, token-checks, and dedupes the
   captured real payload.

## Method
- **Real delivery** was captured at an external capture service (webhook.site) because the
  sandbox sleeps between turns (killing in-sandbox servers) and blocks outbound calls —
  the capture service never sleeps. Owner fired the alert from a **BTCUSDT** chart
  (crypto trades Saturdays; XAUUSD does not — see limitations #1).
- **Receiver validation** replayed the captured body byte-identical against our in-sandbox
  receiver (which is our production-shaped code).

## Results
Real delivery evidence (owner's capture, 2026-10-03 13:53:35):
- Source IP 54.218.53.128 (TradingView AWS infra), `user-agent: TradingView Webhook`,
  `content-type: application/json; charset=utf-8`, 85 bytes.
- Body (placeholders substituted):
  ```json
  {"v": 1,"action": "buy","symbol": "BTCUSDT","entry": "84862.01","sl": "2640","tp": "2670"}
  ```

Receiver replay of that exact body:
- 1st POST → `{"status":"received"}`, JSON parsed intact.
- 2nd identical POST → `{"status":"duplicate_ignored"}`, same fingerprint `84c39aa359f00184`.
- Wrong token → HTTP 401.

## Limitations & findings
1. **Market-hours gate:** an alert only fires when its symbol's market is open. Gold did
   not fire on a Saturday; crypto did. Product fact to surface in UI copy: alert-driven
   automation is bounded by the alerted symbol's trading hours. No code change needed.
2. **Numbers arrive as strings** (`"84862.01"`). The alert input adapter must type-coerce
   and validate every numeric field — recorded as a hard rule for
   `server/pipeline/inputs/alertInput.ts` (§3B note added).
3. **Sandbox is not a production webhook target:** it sleeps between sessions and has
   restricted outbound. ⇒ **Architecture impact: deployment only.** The production backend
   must live on always-on hosting (small VPS/PaaS). Pipeline design unchanged.
4. **No observed retry recovery:** earlier alerts sent at a dead endpoint were simply
   lost. Dedupe stays as a safety net; production must monitor endpoint health
   (heartbeat + visible "receiver down" state) since missed alerts are not redelivered.

## Architecture change required?
**No structural change.** Additions absorbed into the spec: string→number coercion rule
(§3B), market-hours note, deployment requirement confirmed for Phase 1 hosting.