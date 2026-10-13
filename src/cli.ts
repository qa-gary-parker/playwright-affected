#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { runLint, runReplay, runSelect, runShadow, runShadowReport } from './commands.js';

const USAGE = `Usage:
  playwright-affected select --config <map.yml> --base <ref> [--head <ref>] [--list <list.json>] [--out <result.json>]
  playwright-affected lint   --config <map.yml> --list <list.json>
  playwright-affected shadow --result <result.json> --report <report.json> [--pr <id>]
  playwright-affected shadow-report --rows <rows.jsonl>
  playwright-affected replay --config <map.yml> --repo <owner/name> --base <branch> [--limit <n>] [--list <list.json>] [--out <file>]

<list.json>:   PLAYWRIGHT_JSON_OUTPUT_NAME=list.json npx playwright test --list --reporter=json
<report.json>: a full run with --reporter=json`;

const OPTIONS = {
  config: { type: 'string' },
  base: { type: 'string' },
  head: { type: 'string' },
  list: { type: 'string' },
  out: { type: 'string' },
  result: { type: 'string' },
  report: { type: 'string' },
  pr: { type: 'string' },
  repo: { type: 'string' },
  limit: { type: 'string' },
  rows: { type: 'string' },
} as const;

function required(values: Record<string, string | undefined>, ...names: string[]): string[] {
  const missing = names.filter((n) => !values[n]);
  if (missing.length > 0) throw new UsageError(`missing ${missing.map((n) => `--${n}`).join(', ')}`);
  return names.map((n) => values[n] as string);
}

class UsageError extends Error {}

function emit(data: unknown, out?: string) {
  const json = `${JSON.stringify(data, null, 2)}\n`;
  if (out) writeFileSync(out, json);
  else process.stdout.write(json);
}

const log = (message: string) => process.stderr.write(`playwright-affected: ${message}\n`);
const pct = (v: number | null) => (v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`);

function main(argv: string[]): number {
  const [command, ...rest] = argv;
  const { values } = parseArgs({ args: rest, options: OPTIONS, strict: true });

  switch (command) {
    case 'select': {
      const [config, base] = required(values, 'config', 'base');
      const result = runSelect({ config, base, head: values.head, list: values.list });
      emit(result, values.out);
      const counts = result.total === null ? '' : ` (${result.selected}/${result.total} tests)`;
      const detail = result.error ?? result.dead_entries?.join(', ');
      if (result.mode === 'selected') log(`selected ${result.grep}${counts}`);
      else log(`full suite: ${result.full_reason}${detail ? ` (${detail})` : ''}${counts}`);
      if (result.unmapped_paths.length > 0) log(`unmapped paths:\n  ${result.unmapped_paths.join('\n  ')}`);
      return 0;
    }
    case 'lint': {
      const [config, list] = required(values, 'config', 'list');
      const { unreachable, dead_entries } = runLint({ config, list });
      emit({ unreachable: unreachable.map((t) => t.id), dead_entries });
      log(`unreachable tests: ${unreachable.length}, map entries matching no test: ${dead_entries.length}`);
      return unreachable.length > 0 || dead_entries.length > 0 ? 1 : 0;
    }
    case 'shadow': {
      const [result, report] = required(values, 'result', 'report');
      const row = runShadow({ result, report, pr: values.pr });
      emit(row);
      log(`${row.missed_failures.length} missed of ${row.full_suite_failures.length} deterministic failure(s)`);
      if (row.unrun_tests > 0) log(`incomplete report: ${row.unrun_tests} test(s) did not run`);
      if (row.report_errors.length > 0) log(`incomplete report: ${row.report_errors.join('; ')}`);
      if (row.listed_tests !== null && row.listed_tests !== row.total_tests) {
        log(`incomplete report: the selection listed ${row.listed_tests} tests, the report has ${row.total_tests}`);
      }
      return 0;
    }
    case 'shadow-report': {
      const [rows] = required(values, 'rows');
      const report = runShadowReport({ rows });
      emit(report);
      log(
        `${report.rows_with_misses} of ${report.selected_rows} selected rows missed a failure (${pct(report.miss_rate)}), ` +
          `${report.incomplete_rows} incomplete rows left out`,
      );
      return 0;
    }
    case 'replay': {
      const [config, repo, base] = required(values, 'config', 'repo', 'base');
      const limit = Number(values.limit ?? 200);
      if (!Number.isInteger(limit) || limit < 1) throw new UsageError('--limit must be a positive integer');
      const summary = runReplay({ config, repo, base, limit, list: values.list });
      emit(summary, values.out);
      log(
        [
          `${summary.prs} merged PRs: ${summary.selected_prs} selected, full ${JSON.stringify(summary.full_prs)}`,
          `mapping coverage ${pct(summary.mapping_coverage)} (${summary.unmapped_files}/${summary.considered_files} files unmapped)`,
          `mean share of tests run ${pct(summary.mean_selected_share)}`,
        ].join('\n  '),
      );
      return 0;
    }
    default:
      throw new UsageError(command ? `unknown command "${command}"` : 'missing command');
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  log(error instanceof Error ? error.message : String(error));
  if (error instanceof UsageError || (error as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) {
    process.stderr.write(`\n${USAGE}\n`);
    process.exitCode = 2;
  } else {
    process.exitCode = 1;
  }
}
