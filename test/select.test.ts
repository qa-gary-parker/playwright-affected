import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';
import { select } from '../src/select.js';

const config = parseConfig(`
version: 1
test_dir: e2e/tests
always_run_tags: ["@smoke"]
full_run_triggers:
  - "package-lock.json"
  - "e2e/fixtures/**"
  - "docs/release-checklist.md"
ignore_paths:
  - "docs/**"
  - "**/*.md"
mappings:
  - paths: ["src/editor/**"]
    tags: ["@editor"]
  - paths: ["src/billing/**", "services/billing/**"]
    tags: ["@billing"]
    tests: ["billing/"]
unmapped_behavior: full
`);

describe('select', () => {
  it('runs the full suite when a global trigger changes', () => {
    const result = select(config, ['src/editor/a.ts', 'package-lock.json']);
    expect(result.mode).toBe('full');
    expect(result.full_reason).toBe('global_trigger');
    expect(result.trigger_paths).toEqual(['package-lock.json']);
    expect(result.grep).toBeNull();
  });

  it('selects mapped tags plus the always-run tags', () => {
    const result = select(config, ['src/editor/a.ts', 'src/editor/b.ts']);
    expect(result.mode).toBe('selected');
    expect(result.full_reason).toBeNull();
    expect(result.tags).toEqual(['@editor', '@smoke']);
    expect(result.tests).toEqual([]);
    expect(result.grep).toBe('@editor|@smoke');
  });

  it('unions tags and test paths across mappings', () => {
    const result = select(config, ['src/editor/a.ts', 'services/billing/x.php']);
    expect(result.tags).toEqual(['@billing', '@editor', '@smoke']);
    expect(result.tests).toEqual(['billing/']);
    expect(result.grep).toBe('@billing|@editor|@smoke|(?:^|\\s)billing/');
  });

  it('fails open when an app file has no mapping', () => {
    const result = select(config, ['src/editor/a.ts', 'src/search/index.ts']);
    expect(result.mode).toBe('full');
    expect(result.full_reason).toBe('unmapped_paths');
    expect(result.unmapped_paths).toEqual(['src/search/index.ts']);
  });

  it('only warns about unmapped files when unmapped_behavior is warn_only', () => {
    const warnOnly = { ...config, unmappedBehavior: 'warn_only' as const };
    const result = select(warnOnly, ['src/editor/a.ts', 'src/search/index.ts']);
    expect(result.mode).toBe('selected');
    expect(result.unmapped_paths).toEqual(['src/search/index.ts']);
    expect(result.tags).toEqual(['@editor', '@smoke']);
  });

  it('runs only the always-run set when every change is ignored', () => {
    const result = select(config, ['docs/guide.md', 'README.md']);
    expect(result.mode).toBe('selected');
    expect(result.tags).toEqual(['@smoke']);
    expect(result.grep).toBe('@smoke');
  });

  it('checks triggers before ignore rules', () => {
    const result = select(config, ['docs/release-checklist.md']);
    expect(result.mode).toBe('full');
    expect(result.full_reason).toBe('global_trigger');
  });

  it('selects a changed test file by its path under test_dir', () => {
    const result = select(config, ['e2e/tests/auth/login.test.ts']);
    expect(result.mode).toBe('selected');
    expect(result.tests).toEqual(['auth/login.test.ts']);
    expect(result.grep).toBe('@smoke|(?:^|\\s)auth/login\\.test\\.ts');
  });

  it('selects a changed test file even when an ignore rule also matches it', () => {
    const broadIgnore = { ...config, ignorePaths: ['e2e/**'] };
    const result = select(broadIgnore, ['e2e/tests/auth/login.test.ts', 'e2e/tests/auth/helpers.ts']);
    expect(result.tests).toEqual(['auth/login.test.ts']);
    expect(result.ignored_paths).toEqual(['e2e/tests/auth/helpers.ts']);
  });

  it('treats a changed non-test helper under test_dir as unmapped', () => {
    const result = select(config, ['e2e/tests/auth/helpers.ts']);
    expect(result.mode).toBe('full');
    expect(result.unmapped_paths).toEqual(['e2e/tests/auth/helpers.ts']);
  });

  it('never selects zero tests when there is no always-run set', () => {
    const noSmoke = { ...config, alwaysRunTags: [] };
    const result = select(noSmoke, ['docs/guide.md']);
    expect(result.mode).toBe('full');
    expect(result.full_reason).toBe('empty_selection');
  });

  it('runs the full suite for an empty diff instead of only the always-run set', () => {
    const result = select(config, []);
    expect(result.mode).toBe('full');
    expect(result.full_reason).toBe('no_changes');
  });

  it('selects a changed test file when test_dir is written with a leading ./', () => {
    const result = select(parseConfig('version: 1\ntest_dir: ./e2e/tests\nmappings:\n  - paths: ["e2e/**"]\n    tags: ["@e2e"]\n'), [
      'e2e/tests/auth/login.test.ts',
    ]);
    expect(result.tests).toEqual(['auth/login.test.ts']);
  });

  it('treats test_dir "." as the repo root', () => {
    const result = select(parseConfig('version: 1\ntest_dir: .\nmappings: []\n'), ['auth/login.test.ts']);
    expect(result.mode).toBe('selected');
    expect(result.tests).toEqual(['auth/login.test.ts']);
  });
});

describe('parseConfig', () => {
  it('applies defaults for optional fields', () => {
    const parsed = parseConfig('version: 1\nmappings: []\n');
    expect(parsed).toEqual({
      testDir: null,
      alwaysRunTags: [],
      fullRunTriggers: [],
      ignorePaths: [],
      mappings: [],
      unmappedBehavior: 'full',
    });
  });

  it.each([
    ['e2e/tests/', 'e2e/tests'],
    ['./e2e/tests', 'e2e/tests'],
    ['.', ''],
    ['./', ''],
  ])('normalises test_dir %s to %s', (input, expected) => {
    expect(parseConfig(`version: 1\ntest_dir: "${input}"\nmappings: []\n`).testDir).toBe(expected);
  });

  it('parses the shipped example', () => {
    const example = parseConfig(readFileSync(new URL('../examples/e2e-map.yml', import.meta.url), 'utf8'));
    expect(select(example, ['src/editor/a.ts']).grep).toBe('@editor|@smoke|(?:^|\\s)editor/');
  });

  it.each([
    ['version: 2\nmappings: []', /version/],
    ['version: 1\nmappings:\n  - paths: ["a/**"]\n    tags: ["editor"]', /must start with "@"/],
    ['version: 1\nmappings:\n  - paths: ["a/**"]', /needs tags or tests/],
    ['version: 1\nmappings:\n  - tags: ["@a"]', /paths/],
    ['version: 1\nunmapped_behavior: skip\nmappings: []', /unmapped_behavior/],
    ['version: 1\nalways_run_tags: "@smoke"\nmappings: []', /always_run_tags/],
    ['version: 1\nfull_run_trigger: ["a"]\nmappings: []', /unknown key "full_run_trigger"/],
    ['version: 1\nmappings:\n  - paths: ["a/**"]\n    tags: ["@a"]\n    test: ["x/"]', /mappings\[0\]: unknown key "test"/],
    ['version: 1\ntest_dir: 5\nmappings: []', /test_dir must be a string/],
    ['version: 1\ntest_dir: ../e2e\nmappings: []', /test_dir must be relative/],
    ['version: 1\ntest_dir: /e2e\nmappings: []', /test_dir must be relative/],
    ['version: 1\nalways_run_tags: ["smoke"]\nmappings: []', /always_run_tags: tag "smoke" must start with "@"/],
    ['version: 1\nmappings:\n  - paths: []\n    tags: ["@a"]', /mappings\[0\]\.paths must not be empty/],
  ])('rejects an invalid config: %s', (text, message) => {
    expect(() => parseConfig(text)).toThrow(message);
  });
});
