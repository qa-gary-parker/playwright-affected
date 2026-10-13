import type { Config } from './config.js';
import { grepMatcher, type ListedTest } from './playwright.js';
import { buildGrep, deadEntries } from './select.js';

// A test no mapping can reach only runs on full-suite runs or when its own file changes.
export function lint(config: Config, tests: ListedTest[]): { unreachable: ListedTest[]; dead_entries: string[] } {
  const tags = [...config.alwaysRunTags, ...config.mappings.flatMap((m) => m.tags)];
  const paths = config.mappings.flatMap((m) => m.tests);
  const projects = config.mappings.flatMap((m) => m.projects);
  const reachable = grepMatcher(buildGrep(tags, paths, projects) ?? '(?!)');
  return { unreachable: tests.filter((t) => !reachable(t)), dead_entries: deadEntries(tags, paths, projects, tests) };
}
