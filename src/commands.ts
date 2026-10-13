import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from './config.js';
import { changedFiles, revParse } from './git.js';
import { lint } from './lint.js';
import { flattenReport, type ListedTest, reportErrors } from './playwright.js';
import { type PrFiles, type ReplaySummary, replay } from './replay.js';
import { applyList, type Selection, select } from './select.js';
import { type ShadowRow, shadow } from './shadow.js';

export type SelectResult = Selection & {
  base_ref: string;
  head_sha: string | null;
  changed_files: string[];
  dead_entries: string[] | null;
  selected: number | null;
  total: number | null;
  error?: string;
};

function readReport(file: string, cwd?: string): { tests: ListedTest[]; errors: string[] } {
  const report = JSON.parse(readFileSync(resolve(cwd ?? '.', file), 'utf8'));
  const tests = flattenReport(report);
  const errors = reportErrors(report);
  if (tests.length === 0) throw new Error(`no tests in ${file}${errors.length > 0 ? `: ${errors[0]}` : ''}`);
  return { tests, errors };
}

// A list with errors is missing the tests of any spec that failed to load.
function readTests(file: string, cwd?: string): ListedTest[] {
  const { tests, errors } = readReport(file, cwd);
  if (errors.length > 0) throw new Error(`${file} has errors: ${errors[0]}`);
  return tests;
}

export type SelectOptions = { config: string; base: string; head?: string; list?: string; cwd?: string };

// Never throws: any failure yields a full-suite result (fail open).
export function runSelect(opts: SelectOptions): SelectResult {
  const head = opts.head ?? 'HEAD';
  let headSha: string | null = null;
  let files: string[] = [];
  try {
    const config = loadConfig(resolve(opts.cwd ?? '.', opts.config));
    headSha = revParse(head, opts.cwd);
    files = changedFiles(opts.base, head, opts.cwd);
    const selection = select(config, files);
    const result = { base_ref: opts.base, head_sha: headSha, changed_files: files };
    if (!opts.list) return { ...result, ...selection, dead_entries: null, selected: null, total: null };
    return { ...result, ...applyList(selection, readTests(opts.list, opts.cwd)) };
  } catch (error) {
    return {
      base_ref: opts.base,
      head_sha: headSha,
      changed_files: files,
      mode: 'full',
      full_reason: 'tool_error',
      trigger_paths: [],
      ignored_paths: [],
      unmapped_paths: [],
      tags: [],
      tests: [],
      grep: null,
      dead_entries: null,
      selected: null,
      total: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function runLint(opts: { config: string; list: string }) {
  return lint(loadConfig(opts.config), readTests(opts.list));
}

export function runShadow(opts: { result: string; report: string; pr?: string }): ShadowRow {
  const selection = JSON.parse(readFileSync(opts.result, 'utf8')) as SelectResult;
  const { tests, errors } = readReport(opts.report);
  return shadow(selection, tests, opts.pr ?? null, errors);
}

const gh = (args: string[]) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

// Files come from REST per PR: `gh pr list --json files` caps at 100 files per PR and 502s on large batches.
export function fetchMergedPrs(repo: string, base: string, limit: number): PrFiles[] {
  const prs = JSON.parse(
    gh(['pr', 'list', '--repo', repo, '--base', base, '--state', 'merged', '--limit', String(limit), '--json', 'number']),
  ) as { number: number }[];
  return prs.map((pr) => ({
    number: pr.number,
    files: gh(['api', '--paginate', `repos/${repo}/pulls/${pr.number}/files`, '--jq', '.[] | .filename, (.previous_filename // empty)']).split('\n').filter(Boolean),
  }));
}

export function runReplay(opts: { config: string; repo: string; base: string; limit: number; list?: string }): ReplaySummary {
  const config = loadConfig(opts.config);
  return replay(config, fetchMergedPrs(opts.repo, opts.base, opts.limit), opts.list ? readTests(opts.list) : null);
}
