#!/usr/bin/env node
// Debug helper: dump the raw MetaApi account list for this user (POC-1).
// Deliberately disabled: this diagnostic reads account data and may print sensitive fields.
// Re-enable only in a separately approved, redacted read-only workflow.
console.error('BLOCKED: MetaApi account diagnostic is disabled; no provider call made.');
process.exit(2);
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync(new URL('./.env.local', import.meta.url).pathname, 'utf8')
  .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const PROV = 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai';
const r = await fetch(`${PROV}/users/current/accounts`, { headers: { 'auth-token': env.METAAPI_TOKEN } });
console.log('HTTP', r.status);
console.log(JSON.stringify(await r.json(), null, 2).slice(0, 6000));
