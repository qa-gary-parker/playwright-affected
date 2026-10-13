import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';
import { starterMap } from '../src/init.js';
import { flattenReport } from '../src/playwright.js';
import { select } from '../src/select.js';
import { runFixture } from './helpers.js';

const repoRoot = realpathSync(fileURLToPath(new URL('..', import.meta.url)));

const report = (rootDir: string, files: string[]) => ({
  config: { rootDir, configFile: `${rootDir}/playwright.config.ts` },
  suites: files.map((file) => ({
    title: file,
    file,
    specs: [{ title: 't', file, tags: ['smoke'], tests: [{ projectName: 'chromium', status: 'expected', results: [] }] }],
  })),
});

const starter = (r: ReturnType<typeof report>, root = '/repo') => starterMap(r, flattenReport(r), root);

describe('starterMap', () => {
  let fixture: unknown;
  beforeAll(() => {
    fixture = runFixture(['--list']);
  });

  it('works out test_dir and the config trigger from the list, and parses as a valid map', () => {
    const config = parseConfig(starterMap(fixture, flattenReport(fixture), repoRoot));
    expect(config.testDir).toBe('test/fixtures/pw/tests');
    expect(config.fullRunTriggers).toContain('test/fixtures/pw/playwright.config.ts');
    expect(config.mappings).toEqual([]);
    expect(config.alwaysRunTags).toEqual([]);
    expect(config.unmappedBehavior).toBe('full');
  });

  it('lists the test folders, tags and projects to map', () => {
    const text = starterMap(fixture, flattenReport(fixture), repoRoot);
    expect(text).toContain('#   auth/ (4 tests)\n#   billing/ (4 tests)\n#   editor/ (4 tests)\n');
    expect(text).toContain('#   @smoke (4 tests)\n');
    expect(text).toContain('# Projects: api, chromium\n');
  });

  it('groups by the level below a folder that holds every test', () => {
    const text = starter(report('/repo/e2e', ['tests/a/x.spec.ts', 'tests/a/y.spec.ts', 'tests/b/z.spec.ts']));
    expect(text).toContain('#   tests/a/ (2 tests)\n#   tests/b/ (1 test)\n');
  });

  it('writes "." when the tests are reported relative to the repo root', () => {
    expect(parseConfig(starter(report('/repo', ['a.spec.ts']))).testDir).toBe('');
  });

  it('rejects a list whose rootDir is outside the repo', () => {
    expect(() => starter(report('/elsewhere', ['a.spec.ts']))).toThrow('/elsewhere is outside the git repo /repo');
  });

  it('rejects a report without config.rootDir', () => {
    expect(() => starterMap({ suites: [] }, [], '/repo')).toThrow('missing config.rootDir');
  });

  it('selects a changed spec and runs the full suite for any other change', () => {
    const config = parseConfig(starter(report('/repo/e2e', ['a/x.spec.ts'])));
    expect(select(config, ['e2e/a/x.spec.ts'])).toMatchObject({ mode: 'selected', tests: ['a/x.spec.ts'] });
    expect(select(config, ['src/app.ts'])).toMatchObject({ mode: 'full', full_reason: 'unmapped_paths' });
    expect(select(config, ['pnpm-lock.yaml'])).toMatchObject({ mode: 'full', full_reason: 'global_trigger' });
  });
});
