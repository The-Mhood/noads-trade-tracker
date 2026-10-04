#!/usr/bin/env node
// Debug helper: dump the raw MetaApi account list for this user (POC-1).
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync(new URL('./.env.local', import.meta.url).pathname, 'utf8')
  .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const PROV = 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai';
const r = await fetch(`${PROV}/users/current/accounts`, { headers: { 'auth-token': env.METAAPI_TOKEN } });
console.log('HTTP', r.status);
console.log(JSON.stringify(await r.json(), null, 2).slice(0, 6000));
