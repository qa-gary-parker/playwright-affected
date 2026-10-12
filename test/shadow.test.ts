import { describe, expect, it } from 'vitest';
import { flattenReport, type ListedTest } from '../src/playwright.js';
import { shadow } from '../src/shadow.js';
import { runFixture } from './helpers.js';

const fullRun = flattenReport(runFixture([], { FAIL_EDITOR: '1', FLAKY_BILLING: '1' }));

const listed = (id: string, grepTitle: string, durationMs: number): ListedTest => ({
  id,
  project: 'p',
  file: 'f',
  grepTitle,
  status: 'expected',
  durationMs,
  ran: true,
});

describe('shadow', () => {
  it('reports deterministic failures the selection skipped', () => {
    const row = shadow({ mode: 'selected', grep: '@auth|@smoke', head_sha: 'abc' }, fullRun, '42');
    expect(row.pr_id).toBe('42');
    expect(row.head_sha).toBe('abc');
    expect(row.total_tests).toBe(12);
    expect(row.selected_tests).toBe(4);
    expect(row.unrun_tests).toBe(0);
    expect(row.full_suite_failures).toEqual([
      'api › editor/editor.test.ts › editor @editor › saves a draft',
      'chromium › editor/editor.test.ts › editor @editor › saves a draft',
    ]);
    expect(row.missed_failures).toEqual(row.full_suite_failures);
    expect(row.flaky_excluded).toEqual([
      'api › billing/billing.test.ts › billing › upgrades plan',
      'chromium › billing/billing.test.ts › billing › upgrades plan',
    ]);
  });

  it('reports no misses when the selection covers the failures', () => {
    const row = shadow({ mode: 'selected', grep: '@editor|@smoke' }, fullRun, null);
    expect(row.full_suite_failures).toHaveLength(2);
    expect(row.missed_failures).toEqual([]);
  });

  it('treats a full-mode selection as selecting every test', () => {
    const row = shadow({ mode: 'full', grep: null }, fullRun, null);
    expect(row.selected_tests).toBe(12);
    expect(row.missed_failures).toEqual([]);
    expect(row.unselected_test_time_s).toBe(0);
  });

  it('sums the durations of unselected tests in seconds', () => {
    const tests = [listed('1', ' p f one @a', 5000), listed('2', ' p f two', 1250), listed('3', ' p f three', 2000)];
    expect(shadow({ mode: 'selected', grep: '@a' }, tests, null).unselected_test_time_s).toBe(3.3);
  });

  it('counts tests that a stopped run never ran', () => {
    const stopped = flattenReport(runFixture(['--max-failures=1', '--workers=1', '--retries=0'], { FAIL_AUTH: '1' }));
    const row = shadow({ mode: 'full', grep: null }, stopped, null);
    expect(row.full_suite_failures).toHaveLength(1);
    expect(row.unrun_tests).toBe(10);
  });

  it('counts every test as unrun when given a --list report', () => {
    const row = shadow({ mode: 'full', grep: null }, flattenReport(runFixture(['--list'])), null);
    expect(row.unrun_tests).toBe(12);
  });
});
