import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';
import { flattenReport } from '../src/playwright.js';
import { replay } from '../src/replay.js';
import { runFixture } from './helpers.js';

const config = parseConfig(`
version: 1
test_dir: e2e/tests
always_run_tags: ["@smoke"]
full_run_triggers: ["package-lock.json"]
ignore_paths: ["**/*.md"]
mappings:
  - paths: ["src/editor/**"]
    tags: ["@editor"]
`);

const prs = [
  { number: 1, files: ['src/editor/a.ts', 'README.md'] },
  { number: 2, files: ['package-lock.json', 'src/editor/a.ts'] },
  { number: 3, files: ['src/search/deep/x.ts', 'src/search/deep/y.ts', 'src/editor/b.ts'] },
  { number: 4, files: ['src/search/deep/z.ts'] },
  { number: 5, files: ['e2e/tests/auth/login.test.ts'] },
  { number: 6, files: ['e2e/tests/auth/removed.test.ts'] },
];

describe('replay', () => {
  const summary = replay(config, prs, flattenReport(runFixture(['--list'])));

  it('counts how each PR would have run', () => {
    expect(summary.prs).toBe(6);
    expect(summary.selected_prs).toBe(2);
    expect(summary.full_prs).toEqual({ global_trigger: 1, unmapped_paths: 2, dead_entry: 1 });
  });

  it('measures mapping coverage over files that are neither ignored nor triggers', () => {
    // considered: a.ts(1), a.ts(2), x, y, b(3), z(4), login.test.ts(5), removed.test.ts(6) = 8; unmapped: x, y, z = 3
    expect(summary.considered_files).toBe(8);
    expect(summary.unmapped_files).toBe(3);
    expect(summary.mapping_coverage).toBeCloseTo(5 / 8);
  });

  it('reports the share of tests each PR would run', () => {
    // PR 1: @editor|@smoke = 6 of 12; PR 5: @smoke or auth/login.test.ts = 6 of 12; full PRs = 1
    expect(summary.rows.map((r) => [r.pr, r.selected_share])).toEqual([
      [1, 0.5],
      [2, 1],
      [3, 1],
      [4, 1],
      [5, 0.5],
      [6, 1],
    ]);
    expect(summary.mean_selected_share).toBeCloseTo(5 / 6);
  });

  it('leaves test shares empty without a test list', () => {
    const noList = replay(config, prs, null);
    expect(noList.rows[0].selected_share).toBeNull();
    expect(noList.mean_selected_share).toBeNull();
  });

  it('ranks unmapped dirs by PRs, then files, and keeps the top 20', () => {
    const many = [
      { number: 1, files: ['lib/a/1.ts', 'lib/c/1.ts'] },
      { number: 2, files: ['lib/a/2.ts', 'lib/b/1.ts', 'lib/b/2.ts', 'lib/b/3.ts'] },
      ...Array.from({ length: 20 }, (_, i) => ({ number: 100 + i, files: [`gen/d${i}/x.ts`, 'package-lock.json'] })),
    ];
    const ranked = replay(config, many, null);
    expect(ranked.top_unmapped_dirs.slice(0, 3)).toEqual([
      { dir: 'lib/a', files: 2, prs: 2 },
      { dir: 'lib/b', files: 3, prs: 1 },
      { dir: 'lib/c', files: 1, prs: 1 },
    ]);
    expect(ranked.top_unmapped_dirs).toHaveLength(20);
    expect(ranked.top_triggers).toEqual([{ path: 'package-lock.json', prs: 20 }]);
  });
});
