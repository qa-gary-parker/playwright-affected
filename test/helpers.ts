import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const fixtureConfig = fileURLToPath(new URL('./fixtures/pw/playwright.config.ts', import.meta.url));

export function runFixture(args: string[], env: Record<string, string> = {}): unknown {
  const result = spawnSync('npx', ['playwright', 'test', '--config', fixtureConfig, '--reporter=json', ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 60_000,
  });
  if (result.error) throw result.error;
  if (!result.stdout) throw new Error(`playwright produced no output: ${result.stderr}`);
  return JSON.parse(result.stdout);
}
