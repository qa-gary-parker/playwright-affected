import { matchesGlob } from 'node:path';
import type { Config } from './config.js';
import { grepMatcher, type ListedTest } from './playwright.js';

export type FullReason = 'global_trigger' | 'unmapped_paths' | 'no_changes' | 'empty_selection' | 'dead_entry' | 'tool_error';

export type Selection = {
  mode: 'selected' | 'full';
  full_reason: FullReason | null;
  trigger_paths: string[];
  ignored_paths: string[];
  unmapped_paths: string[];
  tags: string[];
  tests: string[];
  grep: string | null;
};

export type ListedSelection = Selection & { dead_entries: string[]; selected: number; total: number };

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

// matchesGlob never lets * or ** match a name that starts with ".". Hiding that dot in both the
// path and the glob lets dot folders match like any other, and a literal ".github" still matches.
const undot = (text: string) => text.replace(/(^|[/{,])\./g, '$1\uE000');
const matchesAny = (file: string, globs: string[]) => globs.some((glob) => matchesGlob(undot(file), undot(glob)));

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Playwright greps "<project> <file relative to testDir> <describes> <title> <tags>",
// so a tag must be a whole token and a test path must start one.
export function buildGrep(tags: string[], tests: string[]): string | null {
  const group = (items: string[]) => `(?:${items.map(escapeRegExp).join('|')})`;
  const parts = [];
  if (tags.length > 0) parts.push(`(?:^|\\s)${group(tags)}(?=\\s|$)`);
  if (tests.length > 0) parts.push(`(?:^|\\s)${group(tests)}`);
  return parts.length > 0 ? parts.join('|') : null;
}

export function select(config: Config, changedFiles: string[], deletedFiles: string[] = []): Selection {
  const triggers: string[] = [];
  const ignored: string[] = [];
  const unmapped: string[] = [];
  const tags = new Set(config.alwaysRunTags);
  const tests = new Set<string>();
  const testDirPrefix = config.testDir === null || config.testDir === '' ? config.testDir : `${config.testDir}/`;

  for (const file of changedFiles) {
    if (matchesAny(file, config.fullRunTriggers)) {
      triggers.push(file);
      continue;
    }
    if (testDirPrefix !== null && file.startsWith(testDirPrefix) && TEST_FILE.test(file)) {
      // A deleted spec has no tests left to run.
      if (deletedFiles.includes(file)) ignored.push(file);
      else tests.add(file.slice(testDirPrefix.length));
      continue;
    }
    if (matchesAny(file, config.ignorePaths)) {
      ignored.push(file);
      continue;
    }
    const matched = config.mappings.filter((m) => matchesAny(file, m.paths));
    if (matched.length === 0) unmapped.push(file);
    for (const m of matched) {
      m.tags.forEach((t) => tags.add(t));
      m.tests.forEach((t) => tests.add(t));
    }
  }

  const base = { trigger_paths: triggers, ignored_paths: ignored, unmapped_paths: unmapped };
  const full = (reason: FullReason): Selection => ({ mode: 'full', full_reason: reason, ...base, tags: [], tests: [], grep: null });

  // An empty diff usually means a misconfigured base, not a PR that changes nothing.
  if (changedFiles.length === 0) return full('no_changes');
  if (triggers.length > 0) return full('global_trigger');
  if (unmapped.length > 0 && config.unmappedBehavior === 'full') return full('unmapped_paths');

  const sortedTags = [...tags].sort();
  const sortedTests = [...tests].sort();
  const grep = buildGrep(sortedTags, sortedTests);
  if (grep === null) return full('empty_selection');

  return { mode: 'selected', full_reason: null, ...base, tags: sortedTags, tests: sortedTests, grep };
}

// Checked against each test's tags and file, not the grep, so a stale entry cannot pass
// by matching a word in some title. Case-insensitive, like --grep.
export function deadEntries(tags: string[], tests: string[], listed: ListedTest[]): string[] {
  const lower = (text: string) => text.toLowerCase();
  const dead = [
    ...tags.filter((tag) => !listed.some((t) => t.tags.some((x) => lower(x) === lower(tag)))),
    ...tests.filter((path) => !listed.some((t) => lower(t.file).startsWith(lower(path)))),
  ];
  return [...new Set(dead)].sort();
}

// An entry that matches no listed test is a wrong map (a glob in `tests`, a renamed tag,
// a deleted spec), and dropping it silently would skip the tests it was meant to select.
export function applyList(selection: Selection, listed: ListedTest[]): ListedSelection {
  const total = listed.length;
  if (selection.mode === 'full') return { ...selection, dead_entries: [], selected: total, total };
  const dead = deadEntries(selection.tags, selection.tests, listed);
  if (dead.length > 0) {
    return { ...selection, mode: 'full', full_reason: 'dead_entry', tags: [], tests: [], grep: null, dead_entries: dead, selected: total, total };
  }
  return { ...selection, dead_entries: [], selected: listed.filter(grepMatcher(selection.grep)).length, total };
}
