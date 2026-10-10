// CLI/journal/restart tests for the guarded runner. Offline only: exercises
// --plan, usage guards and the --review evidence gate against fixture journals.
// Never reads poc/.env.local, never touches the network, never sends a trade.
// Fixture journals use unique poc1-test-* names and are removed after each test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const runner = join(here, 'poc1-runner.mjs');
const jdir = join(here, '.poc1-journals');
const run = (...args) => spawnSync(process.execPath, [runner, ...args], { encoding: 'utf8', env: {}, timeout: 15000 });
let seq = 0;

function makeJournal(rows) {
  const name = `poc1-test-${Date.now()}-${++seq}.jsonl`;
  mkdirSync(jdir, { recursive: true, mode: 0o700 });
  writeFileSync(join(jdir, name), rows.map(r => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 });
  return name;
}
function makeEvidence(obj) {
  const p = join(tmpdir(), `poc1-test-evidence-${Date.now()}-${++seq}.json`);
  writeFileSync(p, JSON.stringify(obj));
  return p;
}
const rows = name => readFileSync(join(jdir, name), 'utf8').trim().split('\n').map(x => JSON.parse(x));
const lastRow = name => rows(name).at(-1);
const cleanup = (...paths) => { for (const p of paths) { try { rmSync(p, { force: true }); } catch { /* test hygiene only */ } } };

const interruptedRows = [
  { event: 'started', caseId: 'E03' },
  { event: 'pre_send_intent', caseId: 'E03', request: { actionType: 'ORDER_TYPE_BUY_LIMIT' } },
  { event: 'send_result', caseId: 'E03', httpOk: false, numericCode: null, orderId: null, positionId: null, transportError: true, transportErrorDetail: 'ETIMEDOUT' },
];
const fullEvidence = { caseId: 'E03', caseVerdict: 'FAIL', brokerFinalityConfirmed: true,
  zeroExposureConfirmed: true, protectionConfirmed: true, linkedHistoryVerified: true,
  reviewer: 'owner', evidenceRef: 'MT5 terminal screenshot 2026-10-10' };

test('interrupted journal: no review before reconciliation, never PASS, then closable with human verdict', () => {
  const j = makeJournal(interruptedRows);
  const ev = makeEvidence(fullEvidence);
  try {
    // Crash before case_result: review must refuse until a read-only reconciliation exists.
    let r = run('--review', j, ev);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /reconciliation/i);
    // Simulate the state after a successful --reconcile (provider reads appended this row).
    writeFileSync(join(jdir, j), JSON.stringify({ event: 'read_only_reconciliation', caseId: 'E03', ticket: null, orders: [], positions: [], deals: [] }) + '\n', { flag: 'a' });
    // An interrupted journal can NEVER be reviewed as PASS, even with full attestations.
    r = run('--review', j, makeEvidence({ ...fullEvidence, caseVerdict: 'PASS' }));
    assert.equal(r.status, 2);
    // A FAIL/UNVERIFIED/BLOCKED human verdict closes it, flagged as an interrupted journal.
    r = run('--review', j, ev);
    assert.equal(r.status, 0, r.stderr);
    const done = lastRow(j);
    assert.equal(done.event, 'reviewed');
    assert.equal(done.verdict, 'FAIL');
    assert.equal(done.interruptedJournal, true);
    // Re-review of an already reviewed journal is refused.
    r = run('--review', j, ev);
    assert.equal(r.status, 2);
  } finally { cleanup(join(jdir, j), ev); }
});

test('completed case: PASS gate requires well-formed empty final_candidate plus protection and linked history', () => {
  const completed = [
    { event: 'started', caseId: 'E01' },
    { event: 'send_result', caseId: 'E01', httpOk: true, numericCode: 10009, orderId: 't1', positionId: 'p1' },
    { event: 'final_candidate', caseId: 'E01', openOrders: [], positions: [], historyStates: [], linkedDeals: [] },
    { event: 'case_result', caseId: 'E01', status: 'REVIEW_REQUIRED' },
  ];
  const passEvidence = { caseId: 'E01', caseVerdict: 'PASS', brokerFinalityConfirmed: true,
    zeroExposureConfirmed: true, protectionConfirmed: true, linkedHistoryVerified: true,
    reviewer: 'owner', evidenceRef: 'linked history export 2026-10-10' };
  const j1 = makeJournal(completed);
  const e1 = makeEvidence(passEvidence);
  try {
    assert.equal(run('--review', j1, e1).status, 0);
    assert.equal(lastRow(j1).verdict, 'PASS');
  } finally { cleanup(join(jdir, j1), e1); }
  // Malformed final_candidate (missing array fields) must NOT satisfy the PASS gate.
  const malformed = completed.map(r => r.event === 'final_candidate' ? { event: 'final_candidate', caseId: 'E01' } : r);
  const j2 = makeJournal(malformed);
  const e2 = makeEvidence(passEvidence);
  try {
    const r = run('--review', j2, e2);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /insufficient/i);
  } finally { cleanup(join(jdir, j2), e2); }
  // PASS is refused when protection or linked-history attestation is missing.
  const j3 = makeJournal(completed);
  const e3 = makeEvidence({ ...passEvidence, protectionConfirmed: false });
  try { assert.equal(run('--review', j3, e3).status, 2); } finally { cleanup(join(jdir, j3), e3); }
});

test('review evidence validation: wrong case, missing attestations and unknown verdicts are refused', () => {
  const j = makeJournal([...interruptedRows, { event: 'read_only_reconciliation', caseId: 'E03', ticket: null, orders: [], positions: [], deals: [] }]);
  try {
    for (const bad of [
      { ...fullEvidence, caseId: 'E04' },
      { ...fullEvidence, brokerFinalityConfirmed: false },
      { ...fullEvidence, zeroExposureConfirmed: 'yes' },
      { ...fullEvidence, caseVerdict: 'MAYBE' },
      { ...fullEvidence, reviewer: '' },
      { ...fullEvidence, evidenceRef: '' },
    ]) {
      const ev = makeEvidence(bad);
      try { assert.equal(run('--review', j, ev).status, 2, JSON.stringify(bad)); } finally { cleanup(ev); }
    }
    // BLOCKED is an accepted human verdict for a journal whose case could not complete.
    const ev = makeEvidence({ ...fullEvidence, caseVerdict: 'BLOCKED' });
    try { assert.equal(run('--review', j, ev).status, 0); } finally { cleanup(ev); }
    assert.equal(lastRow(j).verdict, 'BLOCKED');
  } finally { cleanup(join(jdir, j)); }
});

test('usage guards exit 2 before any configuration or provider access', () => {
  assert.equal(run('--run-case', 'E09').status, 2);          // unknown case id
  assert.equal(run('--run-case', 'E01', 'extra').status, 2); // no batch arguments
  assert.equal(run('--reconcile').status, 2);                // missing journal name
  assert.equal(run('--review', '../../etc/passwd', 'x').status, 2); // journal name traversal refused
  assert.equal(run('--review', 'poc1-missing.jsonl', 'x').status, 2);
  const plan = run('--plan');
  assert.equal(plan.status, 0);
  assert.equal(Object.keys(JSON.parse(plan.stdout)).length, 8);
});
