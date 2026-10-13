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
