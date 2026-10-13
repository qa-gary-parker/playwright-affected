import { relative } from 'node:path';
import type { ListedTest } from './playwright.js';

const SHOWN = 20;

const count = (n: number) => `${n} test${n === 1 ? '' : 's'}`;
const quote = (text: string) => JSON.stringify(text);
const outside = (path: string) => path === '..' || path.startsWith('../');

function ranked(keys: string[]): string[] {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return [...counts]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .slice(0, SHOWN)
    .map(([key, n]) => `#   ${key} (${count(n)})`);
}

// A folder that holds every test is no use as a "tests" entry, so group one level below it.
function folders(files: string[]): string[] {
  const dirs = files.map((file) => file.split('/').slice(0, -1));
  let depth = 0;
  while (dirs.every((d) => d.length > depth && d[depth] === dirs[0][depth])) depth++;
  return files.map((file) => {
    const parts = file.split('/');
    return parts.length > depth + 1 ? `${parts.slice(0, depth + 1).join('/')}/` : file;
  });
}

// A map that selects only changed specs and the full suite for anything else, plus the
// tags, folders and projects to build mappings from.
export function starterMap(report: unknown, tests: ListedTest[], repoRoot: string): string {
  const { rootDir, configFile } = (report as { config?: { rootDir?: string; configFile?: string } }).config ?? {};
  if (!rootDir) throw new Error('not a Playwright JSON report: missing config.rootDir');
  const testDir = relative(repoRoot, rootDir);
  if (outside(testDir)) throw new Error(`${rootDir} is outside the git repo ${repoRoot}`);

  const triggers = ['**/package-lock.json', '**/pnpm-lock.yaml', '**/yarn.lock', '.github/workflows/**'];
  const config = configFile && relative(repoRoot, configFile);
  if (config && !outside(config)) triggers.push(config);
  const projects = [...new Set(tests.map((t) => t.project))].sort();

  return [
    '# Starter map from playwright-affected init. Rules: https://github.com/qa-gary-parker/playwright-affected#config',
    'version: 1',
    '',
    '# Playwright reports test files relative to this folder.',
    `test_dir: ${quote(testDir || '.')}`,
    '',
    '# Tags to select on every PR, such as ["@smoke"]. Tags in this suite:',
    ...ranked(tests.flatMap((t) => t.tags)),
    'always_run_tags: []',
    '',
    '# Any match runs the full suite.',
    'full_run_triggers:',
    ...triggers.map((t) => `  - ${quote(t)}`),
    '',
    '# Changes here never affect the tests.',
    'ignore_paths:',
    '  - "**/*.md"',
    '',
    '# Source globs and the tests they affect. Until you add some, any change other than a',
    '# test file runs the full suite. `replay` lists the folders that most often do.',
    '# Test folders, for "tests":',
    ...ranked(folders(tests.map((t) => t.file))),
    `# Projects: ${projects.join(', ')}`,
    '# Example:',
    '#   - paths: ["src/auth/**"]',
    '#     tests: ["auth/"]',
    'mappings: []',
    '',
    '# full: a changed file that matches no rule runs the full suite.',
    'unmapped_behavior: full',
    '',
  ].join('\n');
}
