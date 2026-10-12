import { describe, expect, it } from 'vitest';
import { flattenReport, grepMatcher } from '../src/playwright.js';
import { buildGrep } from '../src/select.js';
import { runFixture } from './helpers.js';

const all = flattenReport(runFixture(['--list']));

describe('flattenReport', () => {
  it('returns one entry per test per project', () => {
    expect(all).toHaveLength(12);
    expect(all.map((t) => t.id)).toContain('api › billing/billing.test.ts › billing › upgrades plan');
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
