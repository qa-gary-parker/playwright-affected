import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runSelect } from '../src/commands.js';
import { changedFiles, revParse } from '../src/git.js';
import { runFixture } from './helpers.js';

const CONFIG = `
version: 1
test_dir: e2e/tests
always_run_tags: ["@smoke"]
full_run_triggers: ["package-lock.json"]
mappings:
  - paths: ["src/editor/**"]
    tags: ["@editor"]
  - paths: ["src/billing/**"]
    tags: ["@billing"]
  - paths: ["src/legacy/**"]
    tags: ["@legacy"]
`;

let repo: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();

function commit(files: Record<string, string | null>, message: string) {
  for (const [file, content] of Object.entries(files)) {
    if (content === null) {
      git('rm', '-q', '--', file);
      continue;
    }
    mkdirSync(join(repo, file, '..'), { recursive: true });
    writeFileSync(join(repo, file), content);
    git('add', '--', file);
  }
  git('commit', '-qm', message);
}

function withGitConfig<T>(key: string, value: string, fn: () => T): T {
  Object.assign(process.env, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: key, GIT_CONFIG_VALUE_0: value });
  try {
    return fn();
  } finally {
    delete process.env.GIT_CONFIG_COUNT;
    delete process.env.GIT_CONFIG_KEY_0;
    delete process.env.GIT_CONFIG_VALUE_0;
  }
}

beforeAll(() => {
  // Git hooks export these, and they would point every git call below at the outer repo.
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_PREFIX']) {
    delete process.env[key];
  }
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  repo = mkdtempSync(join(tmpdir(), 'pw-affected-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 't');
  git('config', 'user.email', 't@t');
  commit(
    {
      'src/editor/a.ts': '1',
      'src/billing/b.ts': '1',
      'src/billing/gone.ts': '1',
      'src/legacy/old.ts': '1',
      'e2e/tests/auth/old.test.ts': '1',
      'e2e-map.yml': CONFIG,
      'broken.yml': 'version: 9',
      'list.json': JSON.stringify(runFixture(['--list'])),
      'empty-list.json': JSON.stringify({ suites: [] }),
      'errors-list.json': JSON.stringify({ ...(runFixture(['--list']) as object), errors: [{ message: 'SyntaxError: x' }] }),
    },
    'base',
  );
  const sub = join(repo, '..', `${repo.split('/').pop()}-sub`);
  execFileSync('git', ['init', '-q', '-b', 'main', sub]);
  execFileSync('git', ['-C', sub, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'sub 1']);
  git('-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub, 'vendor/sub');
  git('config', '-f', '.gitmodules', 'submodule.vendor/sub.ignore', 'all');
  git('add', '.gitmodules');
  git('commit', '-qm', 'add submodule');
  git('branch', 'feature');
  git('branch', 'paths');
  git('branch', 'legacy-only');
  git('branch', 'bump-sub');
  git('branch', 'move-spec');
  commit({ 'src/legacy/old.ts': '2' }, 'main moves on');

  git('checkout', '-q', 'feature');
  commit({ 'src/editor/a.ts': '2' }, 'change editor');
  git('checkout', '-q', 'paths');
  git('mv', 'src/billing/b.ts', 'src/billing/café plan.ts');
  commit({ 'src/billing/gone.ts': null }, 'rename and delete');
  git('checkout', '-q', 'legacy-only');
  commit({ 'src/legacy/old.ts': '3' }, 'change legacy');
  git('checkout', '-q', 'move-spec');
  git('mv', 'e2e/tests/auth/old.test.ts', 'e2e/tests/auth/login.test.ts');
  git('commit', '-qm', 'rename spec');
  git('checkout', '-q', 'bump-sub');
  execFileSync('git', ['-C', join(repo, 'vendor/sub'), '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'sub 2']);
  git('add', 'vendor/sub');
  git('commit', '-qm', 'bump submodule');
  git('checkout', '-q', 'main');
  git('submodule', 'update', '-q');
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(`${repo}-sub`, { recursive: true, force: true });
});

describe('runSelect', () => {
  it('diffs the head against the merge base, not the moved base branch', () => {
    const result = runSelect({ config: 'e2e-map.yml', base: 'main', head: 'feature', list: 'list.json', cwd: repo });
    expect(result).toMatchObject({
      base_ref: 'main',
      head_sha: git('rev-parse', 'feature'),
      changed_files: ['src/editor/a.ts'],
      mode: 'selected',
      tags: ['@editor', '@smoke'],
      dead_entries: [],
      selected: 6,
      total: 12,
      selected_projects: ['api', 'chromium'],
    });
  });

  it('lists renamed, deleted and non-ASCII paths as they are in the repo', () => {
    const result = runSelect({ config: 'e2e-map.yml', base: 'main', head: 'paths', cwd: repo });
    expect(result.changed_files).toEqual(['src/billing/b.ts', 'src/billing/café plan.ts', 'src/billing/gone.ts']);
    expect(result).toMatchObject({ tags: ['@billing', '@smoke'], dead_entries: null, selected: null, total: null, selected_projects: null });
  });

  it('diffs the checked-out commit when no head is given', () => {
    git('checkout', '-q', 'feature');
    try {
      expect(runSelect({ config: 'e2e-map.yml', base: 'main', cwd: repo }).changed_files).toEqual(['src/editor/a.ts']);
    } finally {
      git('checkout', '-q', 'main');
    }
  });

  it('lists a submodule change even when .gitmodules ignores it', () => {
    const result = runSelect({ config: 'e2e-map.yml', base: 'main', head: 'bump-sub', cwd: repo });
    expect(result.changed_files).toEqual(['vendor/sub']);
    expect(result.full_reason).toBe('unmapped_paths');
  });

  it('selects the new path of a renamed spec and drops the old one', () => {
    const result = runSelect({ config: 'e2e-map.yml', base: 'main', head: 'move-spec', list: 'list.json', cwd: repo });
    expect(result).toMatchObject({
      changed_files: ['e2e/tests/auth/login.test.ts', 'e2e/tests/auth/old.test.ts'],
      mode: 'selected',
      tests: ['auth/login.test.ts'],
      ignored_paths: ['e2e/tests/auth/old.test.ts'],
      dead_entries: [],
      selected: 6,
      total: 12,
    });
  });

  it('lists repo-root paths when git is set to diff relative to a subdirectory', () => {
    const result = withGitConfig('diff.relative', 'true', () =>
      runSelect({ config: '../e2e-map.yml', base: 'main', head: 'feature', cwd: join(repo, 'src') }),
    );
    expect(result.changed_files).toEqual(['src/editor/a.ts']);
    expect(result.mode).toBe('selected');
  });

  it('fails open when a selected entry matches no listed test', () => {
    const result = runSelect({ config: 'e2e-map.yml', base: 'main', head: 'legacy-only', list: 'list.json', cwd: repo });
    expect(result).toMatchObject({
      mode: 'full',
      full_reason: 'dead_entry',
      dead_entries: ['@legacy'],
      grep: null,
      selected: 12,
      total: 12,
    });
  });

  it('fails open on a base ref that git would read as an option', () => {
    const target = join(repo, 'pwned');
    const result = runSelect({ config: 'e2e-map.yml', base: `--output=${target}`, head: 'feature', cwd: repo });
    expect(result.full_reason).toBe('tool_error');
    expect(result.error).toMatch(/invalid ref "--output=/);
    expect(existsSync(`${target}...feature`)).toBe(false);
  });

  it('fails open on a head ref that git would read as an option', () => {
    const result = runSelect({ config: 'e2e-map.yml', base: 'main', head: '--output=x', cwd: repo });
    expect(result.full_reason).toBe('tool_error');
    expect(result.error).toBe('invalid ref "--output=x"');
  });

  it('refuses refs that git would read as options in every git call', () => {
    expect(() => changedFiles('main', '--output=x', repo)).toThrow('invalid ref "--output=x"');
    expect(() => changedFiles('-p', 'main', repo)).toThrow('invalid ref "-p"');
    expect(() => revParse('--all', repo)).toThrow('invalid ref "--all"');
  });

    it('fails open when the base ref is missing', () => {
    const result = runSelect({ config: 'e2e-map.yml', base: 'origin/missing', cwd: repo });
    expect(result.mode).toBe('full');
    expect(result.full_reason).toBe('tool_error');
    expect(result.error).toMatch(/origin\/missing/);
  });

  it('fails open when the list has no tests', () => {
    const result = runSelect({ config: 'e2e-map.yml', base: 'main', head: 'feature', list: 'empty-list.json', cwd: repo });
    expect(result).toMatchObject({ mode: 'full', full_reason: 'tool_error', error: 'no tests in empty-list.json' });
  });

  it('fails open when the list has errors, because it is missing the tests of specs that failed to load', () => {
    const result = runSelect({ config: 'e2e-map.yml', base: 'main', head: 'feature', list: 'errors-list.json', cwd: repo });
    expect(result).toMatchObject({ mode: 'full', full_reason: 'tool_error', error: 'errors-list.json has errors: SyntaxError: x' });
  });

  it('fails open when the config is invalid', () => {
    const result = runSelect({ config: 'broken.yml', base: 'main', cwd: repo });
    expect(result.mode).toBe('full');
    expect(result.full_reason).toBe('tool_error');
    expect(result.error).toMatch(/version must be 1/);
  });
});
