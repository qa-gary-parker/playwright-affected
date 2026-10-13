import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';
import { lint } from '../src/lint.js';
import { flattenReport } from '../src/playwright.js';
import { runFixture } from './helpers.js';

const all = flattenReport(runFixture(['--list']));

describe('lint', () => {
  it('lists tests that no mapping or always-run tag can select', () => {
    const config = parseConfig(`
version: 1
always_run_tags: ["@smoke"]
mappings:
  - paths: ["src/editor/**"]
    tags: ["@editor"]
  - paths: ["src/auth/**"]
    tests: ["auth/"]
`);
    const result = lint(config, all);
    expect(result.unreachable.map((t) => t.id)).toEqual([
      'chromium › billing/billing.test.ts › billing › shows invoices',
      'chromium › billing/billing.test.ts › billing › upgrades plan',
      'api › billing/billing.test.ts › billing › shows invoices',
      'api › billing/billing.test.ts › billing › upgrades plan',
    ]);
    expect(result.dead_entries).toEqual([]);
  });

  it('returns nothing when every test is reachable', () => {
    const config = parseConfig(`
version: 1
mappings:
  - paths: ["src/**"]
    tags: ["@editor", "@billing", "@auth"]
  - paths: ["src/auth/**"]
    tests: ["auth/"]
`);
    expect(lint(config, all)).toEqual({ unreachable: [], dead_entries: [] });
  });

  it('lists every test as unreachable for a map with no tags or tests', () => {
    expect(lint(parseConfig('version: 1\nmappings: []\n'), all).unreachable).toHaveLength(12);
  });

  it('counts a project mapping as reaching every test in that project', () => {
    const config = parseConfig('version: 1\nmappings:\n  - paths: ["src/**"]\n    projects: ["api", "firefox"]\n    tags: ["@billing"]\n');
    const result = lint(config, all);
    expect(result.unreachable.map((t) => t.id)).toEqual([
      'chromium › auth/login.test.ts › logs in',
      'chromium › auth/login.test.ts › resets password',
      'chromium › editor/editor.test.ts › editor @editor › opens a document @smoke',
      'chromium › editor/editor.test.ts › editor @editor › saves a draft',
    ]);
    expect(result.dead_entries).toEqual(['firefox']);
  });

    it('lists map entries that match no test', () => {
    const config = parseConfig(`
version: 1
always_run_tags: ["@smoke", "@nightly"]
mappings:
  - paths: ["src/editor/**"]
    tags: ["@editor", "@editing"]
    tests: ["editor/**", "auth/"]
  - paths: ["src/legacy/**"]
    tags: ["@editing"]
    tests: ["e2e/tests/billing/"]
`);
    expect(lint(config, all).dead_entries).toEqual(['@editing', '@nightly', 'e2e/tests/billing/', 'editor/**']);
  });
});
