import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureConfig = fileURLToPath(new URL('./fixtures/pw/playwright.config.ts', import.meta.url));

// The fixture fails or flakes on these, so a caller's own values must not leak in.
const FIXTURE_SWITCHES = /^(FAIL|FLAKY)_/;

export function runFixture(args: string[], env: Record<string, string> = {}): unknown {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !FIXTURE_SWITCHES.test(key)));
  // Playwright also prints to stdout (its git info plugin, a config's own logs), so the report goes to a file.
  const dir = mkdtempSync(join(tmpdir(), 'pw-affected-'));
  const reportFile = join(dir, 'report.json');
  try {
    const result = spawnSync('npx', ['playwright', 'test', '--config', fixtureConfig, '--reporter=json', ...args], {
      encoding: 'utf8',
      env: { ...inherited, ...env, PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile },
      timeout: 60_000,
    });
    if (result.error) throw result.error;
    if (!existsSync(reportFile)) throw new Error(`playwright produced no report: ${result.stderr}`);
    return JSON.parse(readFileSync(reportFile, 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
