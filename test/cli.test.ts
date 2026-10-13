import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runFixture } from './helpers.js';

// Runs the built CLI: `npm test` builds first.
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const MAP = 'version: 1\nalways_run_tags: ["@smoke"]\nmappings:\n  - paths: ["src/**"]\n    tags: ["@editor", "@billing", "@auth"]\n    tests: ["auth/"]\n';

let dir: string;

function run(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const file = (name: string, content: string) => writeFileSync(join(dir, name), content);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pw-affected-cli-'));
  file('list.json', JSON.stringify(runFixture(['--list'])));
  file('full.json', JSON.stringify(runFixture([], { FAIL_EDITOR: '1' })));
  file('map.yml', MAP);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('cli', () => {
  it('select writes --out and exits 0 when it falls back to the full suite', () => {
    const result = run(['select', '--config', 'map.yml', '--base', 'main', '--out', 'result.json'], { GIT_DIR: join(dir, 'none') });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8'))).toMatchObject({ mode: 'full', full_reason: 'tool_error' });
  });

  it('exits 2 and prints usage when a required flag is missing', () => {
    const result = run(['select', '--config', 'map.yml']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('missing --base');
    expect(result.stderr).toContain('Usage:');
  });

  it.each([
    [['select', '--config', 'map.yml', '--base', 'main', '--bogus'], /Unknown option '--bogus'/],
    [['frobnicate'], /unknown command "frobnicate"/],
    [['init'], /missing --list/],
    [['replay', '--config', 'map.yml', '--repo', 'o/r', '--base', 'main', '--limit', 'abc'], /--limit must be a positive integer/],
  ])('exits 2 and prints usage for bad arguments: %s', (args, message) => {
    const result = run(args);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(message);
    expect(result.stderr).toContain('Usage:');
  });

  it('init writes a starter map and never overwrites one', () => {
    const repo = fileURLToPath(new URL('..', import.meta.url));
    const out = join(dir, 'starter.yml');
    const init = () => spawnSync(process.execPath, [cli, 'init', '--list', join(dir, 'list.json'), '--out', out], { cwd: repo, encoding: 'utf8' });
    const first = init();
    expect(first.status).toBe(0);
    const text = readFileSync(out, 'utf8');
    expect(text).toContain('test_dir: "test/fixtures/pw/tests"');
    const second = init();
    expect(second.status).toBe(1);
    expect(second.stderr).toContain(`${out} already exists`);
    expect(readFileSync(out, 'utf8')).toBe(text);
  });

  it('select exits 1 when --out cannot be written', () => {
    const result = run(['select', '--config', 'map.yml', '--base', 'main', '--out', 'missing/result.json'], { GIT_DIR: join(dir, 'none') });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/ENOENT/);
  });

  it('lint exits 0 when the map reaches every test', () => {
    const result = run(['lint', '--config', 'map.yml', '--list', 'list.json']);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ unreachable: [], dead_entries: [] });
  });

  it('lint exits 1 and lists unreachable tests and dead entries', () => {
    file('narrow.yml', 'version: 1\nmappings:\n  - paths: ["src/**"]\n    tags: ["@billing", "@gone"]\n');
    const result = run(['lint', '--config', 'narrow.yml', '--list', 'list.json']);
    expect(result.status).toBe(1);
    const output = JSON.parse(result.stdout);
    expect(output.unreachable).toHaveLength(8);
    expect(output.unreachable).toContain('chromium › auth/login.test.ts › logs in');
    expect(output.dead_entries).toEqual(['@gone']);
  });

  it('shadow prints a row for a selection and a full run', () => {
    file('selected.json', JSON.stringify({ mode: 'selected', grep: '@auth|@smoke', head_sha: 'abc' }));
    const result = run(['shadow', '--result', 'selected.json', '--report', 'full.json', '--pr', '7']);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      pr_id: '7',
      head_sha: 'abc',
      selected_tests: 4,
      total_tests: 12,
      unrun_tests: 0,
      missed_failures: [
        'api › editor/editor.test.ts › editor @editor › saves a draft',
        'chromium › editor/editor.test.ts › editor @editor › saves a draft',
      ],
    });
  });

  it('shadow warns when the report and the selection list have different test counts', () => {
    file('selected.json', JSON.stringify({ mode: 'selected', grep: '@auth', head_sha: 'abc', total: 11 }));
    const result = run(['shadow', '--result', 'selected.json', '--report', 'full.json']);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).listed_tests).toBe(11);
    expect(result.stderr).toContain('incomplete report: the selection listed 11 tests, the report has 12');
  });

  it('shadow-report summarises rows from a JSON Lines file', () => {
    const row = { mode: 'selected', total_tests: 12, listed_tests: 12, unrun_tests: 0, report_errors: [], missed_failures: [], unselected_test_time_s: 2 };
    file('rows.jsonl', `${JSON.stringify({ ...row, pr_id: '1' })}\n${JSON.stringify({ ...row, pr_id: '2', missed_failures: ['x'] })}\n`);
    const result = run(['shadow-report', '--rows', 'rows.jsonl']);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ rows: 2, selected_rows: 2, rows_with_misses: 1, miss_rate: 0.5, unselected_test_time_s: 4 });
    expect(result.stderr).toContain('1 of 2 selected rows missed a failure (50.0%), 0 incomplete rows left out');
  });

  it('shadow-report names the line it cannot parse', () => {
    file('bad.jsonl', '{}\nnot json\n');
    const result = run(['shadow-report', '--rows', 'bad.jsonl']);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/bad\.jsonl:2: /);
  });

  it('shadow exits 1 when no spec in the full run loaded', () => {
    file('selected.json', JSON.stringify({ mode: 'selected', grep: '@auth', head_sha: 'abc' }));
    file('broken.json', JSON.stringify({ suites: [], errors: [{ message: 'SyntaxError: x' }] }));
    const result = run(['shadow', '--result', 'selected.json', '--report', 'broken.json']);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('no tests in broken.json: SyntaxError: x');
  });

  it('shadow marks a row incomplete when the full run has errors', () => {
    file('selected.json', JSON.stringify({ mode: 'selected', grep: '@auth', head_sha: 'abc' }));
    file('errors.json', JSON.stringify({ ...JSON.parse(readFileSync(join(dir, 'full.json'), 'utf8')), errors: [{ message: 'teardown failed' }] }));
    const result = run(['shadow', '--result', 'selected.json', '--report', 'errors.json']);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).report_errors).toEqual(['teardown failed']);
    expect(result.stderr).toContain('incomplete report: teardown failed');
  });

  it('replay reads merged PRs and their files through gh', () => {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const gh = join(bin, 'gh');
    writeFileSync(
      gh,
      `#!/bin/sh
printf '%s\\n' "$*" >> "${join(dir, 'gh.log')}"
case "$1" in
  pr) echo '[{"number":11},{"number":12}]' ;;
  api) case "$3" in
    */11/files) printf 'modified\\tsrc/a.ts\\n' ;;
    *) printf 'added\\tdocs/x.md\\nadded\\tsrc/new.ts\\nremoved\\tsrc/old.ts\\n' ;;
  esac ;;
esac
`,
    );
    chmodSync(gh, 0o755);
    const result = run(['replay', '--config', 'map.yml', '--repo', 'o/r', '--base', 'main', '--limit', '2'], {
      PATH: `${bin}:${process.env.PATH}`,
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      prs: 2,
      selected_prs: 1,
      full_prs: { unmapped_paths: 1 },
      considered_files: 4,
      unmapped_files: 1,
      top_unmapped_dirs: [{ dir: 'docs', files: 1, prs: 1 }],
    });
    expect(readFileSync(join(dir, 'gh.log'), 'utf8').split('\n').slice(0, 2)).toEqual([
      'pr list --repo o/r --base main --state merged --limit 2 --json number',
      'api --paginate repos/o/r/pulls/11/files --jq .[] | .status + "\\t" + .filename, (.previous_filename // empty | "removed\\t" + .)',
    ]);
  });
});
