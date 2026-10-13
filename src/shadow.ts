import { grepMatcher, type ListedTest } from './playwright.js';
import type { Selection } from './select.js';

export type ShadowRow = {
  pr_id: string | null;
  head_sha: string | null;
  mode: Selection['mode'];
  selected_tests: number;
  total_tests: number;
  listed_tests: number | null;
  unrun_tests: number;
  report_errors: string[];
  full_suite_failures: string[];
  missed_failures: string[];
  flaky_excluded: string[];
  unselected_test_time_s: number;
};

// Compares a selection with a full run of the same commit. Flaky tests (passed on
// retry) are excluded; only deterministic failures count as misses. A row with
// unrun_tests > 0 or report_errors is incomplete: tests that never ran cannot show a miss.
// So is a row whose report has a different test count than the list the selection used.
export function shadow(
  selection: Pick<Selection, 'mode' | 'grep'> & { head_sha?: string | null; total?: number | null },
  fullRun: ListedTest[],
  prId: string | null,
  reportErrors: string[] = [],
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
    listed_tests: selection.total ?? null,
    unrun_tests: fullRun.filter((t) => !t.ran).length,
    report_errors: reportErrors,
    full_suite_failures: ids(failures),
    missed_failures: ids(failures.filter((t) => !isSelected(t))),
    flaky_excluded: ids(fullRun.filter((t) => t.status === 'flaky')),
    unselected_test_time_s: Math.round(unselectedMs / 100) / 10,
  };
}

const isComplete = (row: ShadowRow) =>
  row.unrun_tests === 0 && row.report_errors.length === 0 && (row.listed_tests === null || row.listed_tests === row.total_tests);

export type ShadowReport = {
  rows: number;
  incomplete_rows: number;
  selected_rows: number;
  rows_with_misses: number;
  miss_rate: number | null;
  unselected_test_time_s: number;
  misses: Pick<ShadowRow, 'pr_id' | 'head_sha' | 'missed_failures'>[];
};

// The evidence for making selection blocking: how often a complete selected row missed a failure.
export function shadowReport(rows: ShadowRow[]): ShadowReport {
  const complete = rows.filter(isComplete);
  const selected = complete.filter((r) => r.mode === 'selected');
  const missed = selected.filter((r) => r.missed_failures.length > 0);
  return {
    rows: rows.length,
    incomplete_rows: rows.length - complete.length,
    selected_rows: selected.length,
    rows_with_misses: missed.length,
    miss_rate: selected.length === 0 ? null : missed.length / selected.length,
    unselected_test_time_s: Math.round(selected.reduce((sum, r) => sum + r.unselected_test_time_s, 0) * 10) / 10,
    misses: missed.map((r) => ({ pr_id: r.pr_id, head_sha: r.head_sha, missed_failures: r.missed_failures })),
  };
}
