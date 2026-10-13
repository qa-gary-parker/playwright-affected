export type TestStatus = 'expected' | 'unexpected' | 'flaky' | 'skipped';

export type ListedTest = {
  id: string;
  project: string;
  file: string;
  tags: string[];
  grepTitle: string;
  status: TestStatus;
  durationMs: number;
  // False when the run never started the test: interrupted, stopped by maxFailures, or a --list report.
  ran: boolean;
};

type JsonSpec = {
  title: string;
  file: string;
  tags: string[];
  tests: { projectName: string; status: TestStatus; results: { duration: number; status: string }[] }[];
};

type JsonSuite = { title: string; file: string; specs?: JsonSpec[]; suites?: JsonSuite[] };

// Walks the output of `playwright test --reporter=json`, with or without --list.
// The JSON reporter drops the "@" from tags, so it is added back.
export function flattenReport(report: unknown): ListedTest[] {
  const suites = (report as { suites?: JsonSuite[] }).suites;
  if (!Array.isArray(suites)) throw new Error('not a Playwright JSON report: missing "suites"');

  const tests: ListedTest[] = [];
  const walk = (suite: JsonSuite, describes: string[]) => {
    for (const spec of suite.specs ?? []) {
      const tags = spec.tags.map((t) => (t.startsWith('@') ? t : `@${t}`));
      for (const test of spec.tests) {
        const titlePath = [...describes, spec.title];
        tests.push({
          id: [test.projectName, spec.file, ...titlePath].join(' › '),
          project: test.projectName,
          file: spec.file,
          tags,
          grepTitle: [test.projectName, spec.file, ...titlePath, ...tags].join(' '),
          status: test.status,
          durationMs: test.results.reduce((sum, r) => sum + r.duration, 0),
          ran: test.results.length > 0 && test.results.every((r) => r.status !== 'interrupted'),
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, [...describes, child.title]);
  };
  for (const fileSuite of suites) walk(fileSuite, []);
  return tests;
}

// Same flags as Playwright's CLI --grep: case-insensitive.
export function grepMatcher(grep: string | null): (test: ListedTest) => boolean {
  if (grep === null) return () => true;
  const regex = new RegExp(grep, 'i');
  return (test) => regex.test(test.grepTitle);
}
