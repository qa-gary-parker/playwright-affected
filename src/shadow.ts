import { grepMatcher, type ListedTest } from './playwright.js';
import type { Selection } from './select.js';

export type ShadowRow = {
  pr_id: string | null;
  head_sha: string | null;
  mode: Selection['mode'];
  selected_tests: number;
  total_tests: number;
  unrun_tests: number;
  full_suite_failures: string[];
  missed_failures: string[];
  flaky_excluded: string[];
  unselected_test_time_s: number;
};

// Compares a selection with a full run of the same commit. Flaky tests (passed on
// retry) are excluded; only deterministic failures count as misses. A row with
// unrun_tests > 0 is incomplete: tests that never ran cannot show a miss.
export function shadow(
  selection: Pick<Selection, 'mode' | 'grep'> & { head_sha?: string | null },
  fullRun: ListedTest[],
  prId: string | null,
): ShadowRow {
  const isSelected = selection.mode === 'full' ? () => true : grepMatcher(selection.grep);
  const selected = fullRun.filter(isSelected);
  const ids = (tests: ListedTest[]) => tests.map((t) => t.id).sort();
  const failures = fullRun.filter((t) => t.status === 'unexpected');
  const unselectedMs = fullRun.filter((t) => !isSelected(t)).reduce((sum, t) => sum + t.durationMs, 0);

  return {
    pr_id: prId,
    head_sha: selection.head_sha ?? null,
    mode: selection.mode,
    selected_tests: selected.length,
    total_tests: fullRun.length,
    unrun_tests: fullRun.filter((t) => !t.ran).length,
    full_suite_failures: ids(failures),
    missed_failures: ids(failures.filter((t) => !isSelected(t))),
    flaky_excluded: ids(fullRun.filter((t) => t.status === 'flaky')),
    unselected_test_time_s: Math.round(unselectedMs / 100) / 10,
  };
}
