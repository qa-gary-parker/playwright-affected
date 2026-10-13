import { dirname } from 'node:path';
import type { Config } from './config.js';
import type { ListedTest } from './playwright.js';
import { applyList, type FullReason, type Selection, select } from './select.js';

export type PrFiles = { number: number; files: string[]; deleted?: string[] };

export type ReplayRow = Pick<Selection, 'mode' | 'full_reason' | 'tags' | 'tests'> & {
  pr: number;
  selected_share: number | null;
};

export type ReplaySummary = {
  prs: number;
  selected_prs: number;
  full_prs: Partial<Record<FullReason, number>>;
  considered_files: number;
  unmapped_files: number;
  mapping_coverage: number | null;
  mean_selected_share: number | null;
  top_unmapped_dirs: { dir: string; files: number; prs: number }[];
  top_triggers: { path: string; prs: number }[];
  rows: ReplayRow[];
};

const TOP = 20;

function bump<T>(map: Map<string, T>, key: string, init: () => T, update: (v: T) => void) {
  if (!map.has(key)) map.set(key, init());
  update(map.get(key) as T);
}

// Replays historical PR diffs through the config: how often selection would run,
// how much of the changed code the mappings cover, and where they need extending.
export function replay(config: Config, prs: PrFiles[], tests: ListedTest[] | null): ReplaySummary {
  const fullPrs: Partial<Record<FullReason, number>> = {};
  const unmappedDirs = new Map<string, { files: number; prs: Set<number> }>();
  const triggers = new Map<string, Set<number>>();
  let considered = 0;
  let unmapped = 0;

  const rows = prs.map((pr): ReplayRow => {
    const selection = select(config, pr.files, pr.deleted);
    const listed = tests !== null && tests.length > 0 ? applyList(selection, tests) : null;
    const s = listed ?? selection;
    if (s.full_reason) fullPrs[s.full_reason] = (fullPrs[s.full_reason] ?? 0) + 1;
    considered += pr.files.length - s.trigger_paths.length - s.ignored_paths.length;
    unmapped += s.unmapped_paths.length;
    for (const file of s.unmapped_paths) {
      const dir = dirname(file).split('/').slice(0, 5).join('/');
      bump(unmappedDirs, dir, () => ({ files: 0, prs: new Set<number>() }), (v) => {
        v.files += 1;
        v.prs.add(pr.number);
      });
    }
    for (const file of s.trigger_paths) bump(triggers, file, () => new Set<number>(), (v) => v.add(pr.number));

    const share = listed && listed.selected / listed.total;
    return { pr: pr.number, mode: s.mode, full_reason: s.full_reason, tags: s.tags, tests: s.tests, selected_share: share };
  });

  const shares = rows.map((r) => r.selected_share).filter((v): v is number => v !== null);

  return {
    prs: prs.length,
    selected_prs: rows.filter((r) => r.mode === 'selected').length,
    full_prs: fullPrs,
    considered_files: considered,
    unmapped_files: unmapped,
    mapping_coverage: considered === 0 ? null : (considered - unmapped) / considered,
    mean_selected_share: shares.length === 0 ? null : shares.reduce((a, b) => a + b, 0) / shares.length,
    top_unmapped_dirs: [...unmappedDirs]
      .map(([dir, v]) => ({ dir, files: v.files, prs: v.prs.size }))
      .sort((a, b) => b.prs - a.prs || b.files - a.files)
      .slice(0, TOP),
    top_triggers: [...triggers]
      .map(([path, v]) => ({ path, prs: v.size }))
      .sort((a, b) => b.prs - a.prs)
      .slice(0, TOP),
    rows,
  };
}
