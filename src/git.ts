import { execFileSync } from 'node:child_process';

const git = (args: string[], cwd?: string) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// git reads a leading "-" as an option, e.g. --output=<file>.
function ref(value: string): string {
  if (value.startsWith('-')) throw new Error(`invalid ref "${value}"`);
  return value;
}

// Three-dot diff against the merge base; needs the base ref's history (fetch-depth: 0 or a fetched base).
// --no-relative and --ignore-submodules=none override diff.relative and .gitmodules ignore settings.
// With --no-renames a rename is a deletion plus an addition.
export function changedFiles(base: string, head: string, cwd?: string): { files: string[]; deleted: string[] } {
  const args = ['diff', '--name-status', '--no-renames', '--no-relative', '--ignore-submodules=none', '-z', `${ref(base)}...${ref(head)}`];
  const fields = git(args, cwd).split('\0');
  const files: string[] = [];
  const deleted: string[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    files.push(fields[i + 1]);
    if (fields[i] === 'D') deleted.push(fields[i + 1]);
  }
  return { files, deleted };
}

export function revParse(value: string, cwd?: string): string {
  return git(['rev-parse', '--verify', ref(value)], cwd).trim();
}
