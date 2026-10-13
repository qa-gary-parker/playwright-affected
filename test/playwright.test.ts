import { describe, expect, it } from 'vitest';
import { flattenReport, grepMatcher, reportErrors } from '../src/playwright.js';
import { buildGrep } from '../src/select.js';
import { runFixture } from './helpers.js';

const all = flattenReport(runFixture(['--list']));

describe('flattenReport', () => {
  it('returns one entry per test per project', () => {
    expect(all).toHaveLength(12);
    expect(all.map((t) => t.id)).toContain('api › billing/billing.test.ts › billing › upgrades plan');
  });

});

describe('flattenReport results', () => {
  const report = (results: { status: string; duration: number }[]) => ({
    suites: [{ title: 'a.test.ts', file: 'a.test.ts', specs: [{ title: 't', file: 'a.test.ts', tags: [], tests: [{ projectName: 'p', status: 'flaky', results }] }] }],
  });

  it('sums the duration of every attempt, including retries', () => {
    expect(flattenReport(report([{ status: 'failed', duration: 100 }, { status: 'passed', duration: 250 }]))[0].durationMs).toBe(350);
  });

  it('counts an interrupted test as not run', () => {
    expect(flattenReport(report([{ status: 'interrupted', duration: 5 }]))[0].ran).toBe(false);
    expect(flattenReport(report([{ status: 'passed', duration: 5 }]))[0].ran).toBe(true);
  });
});

describe('reportErrors', () => {
  it('returns the first line of each run-level error', () => {
    const report = { suites: [], errors: [{ message: 'SyntaxError: Unexpected token\n    at broken.test.ts:1' }] };
    expect(reportErrors(report)).toEqual(['SyntaxError: Unexpected token']);
  });

  it('strips colour codes from a run that stopped early', () => {
    const stopped = runFixture(['--max-failures=1', '--workers=1', '--retries=0'], { FAIL_AUTH: '1' });
    expect(reportErrors(stopped)).toEqual(['Testing stopped early after 1 maximum allowed failures.']);
  });

  it('returns nothing for a clean run', () => {
    expect(reportErrors(runFixture(['--list']))).toEqual([]);
  });
});

describe('grepMatcher matches what Playwright --grep selects', () => {
  it.each([
    ['@smoke', 4],
    ['@editor', 4],
    ['@billing', 4],
    [buildGrep(['@auth'], ['billing/']), 6],
    [buildGrep([], ['editor/editor.test.ts']), 4],
    [buildGrep([], ['uth/']), 0],
    ['@nomatch', 0],
    ['@SMOKE', 4],
    ['^chromium\\s', 6],
    [buildGrep(['@auth'], []), 2],
    [buildGrep(['@edit'], []), 0],
  ])('%s', (grep, expected) => {
    const ours = all.filter(grepMatcher(grep)).map((t) => t.id).sort();
    const playwrights = flattenReport(runFixture(['--list', '--grep', grep as string])).map((t) => t.id).sort();
    expect(ours).toEqual(playwrights);
    expect(ours).toHaveLength(expected);
  });

  it('matches everything when there is no grep', () => {
    expect(all.filter(grepMatcher(null))).toHaveLength(12);
  });
});
