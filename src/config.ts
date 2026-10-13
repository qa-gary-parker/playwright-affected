import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

export type Mapping = { paths: string[]; tags: string[]; tests: string[] };

export type Config = {
  // Repo-relative; '' is the repo root.
  testDir: string | null;
  alwaysRunTags: string[];
  fullRunTriggers: string[];
  ignorePaths: string[];
  mappings: Mapping[];
  unmappedBehavior: 'full' | 'warn_only';
};

function stringList(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string' && v !== '')) {
    throw new Error(`${field} must be a list of non-empty strings`);
  }
  return value;
}

function tagList(value: unknown, field: string): string[] {
  const tags = stringList(value, field);
  for (const tag of tags) {
    if (!tag.startsWith('@') || tag.length === 1) throw new Error(`${field}: tag "${tag}" must start with "@" and have a name`);
  }
  return tags;
}

// Git paths never start with "./" or "/", so such a glob would silently match nothing.
function globList(value: unknown, field: string): string[] {
  const globs = stringList(value, field);
  for (const glob of globs) {
    if (glob.startsWith('./') || glob.startsWith('/')) throw new Error(`${field}: glob "${glob}" must be relative to the repo root, without "./" or "/"`);
  }
  return globs;
}

// A misspelt key would silently drop rules (e.g. every full-run trigger), so unknown keys are errors.
function rejectUnknownKeys(obj: Record<string, unknown>, allowed: string[], prefix: string) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) throw new Error(`${prefix}unknown key "${key}"`);
  }
}

function testDir(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error('test_dir must be a string');
  const dir = value.replace(/^(\.\/)+/, '').replace(/\/+$/, '');
  if (dir.startsWith('/') || dir.split('/').includes('..')) throw new Error('test_dir must be relative to the repo root, without ".."');
  return dir === '.' ? '' : dir;
}

export function parseConfig(text: string): Config {
  const raw = parse(text) ?? {};
  rejectUnknownKeys(raw, ['version', 'test_dir', 'always_run_tags', 'full_run_triggers', 'ignore_paths', 'mappings', 'unmapped_behavior'], '');
  if (raw.version !== 1) throw new Error('version must be 1');

  const unmappedBehavior = raw.unmapped_behavior ?? 'full';
  if (unmappedBehavior !== 'full' && unmappedBehavior !== 'warn_only') {
    throw new Error('unmapped_behavior must be "full" or "warn_only"');
  }

  if (!Array.isArray(raw.mappings ?? [])) throw new Error('mappings must be a list');
  const mappings = (raw.mappings ?? []).map((m: unknown, i: number) => {
    const field = `mappings[${i}]`;
    if (m === null || typeof m !== 'object' || Array.isArray(m)) throw new Error(`${field} must be a mapping`);
    rejectUnknownKeys(m as Record<string, unknown>, ['paths', 'tags', 'tests'], `${field}: `);
    const { paths: rawPaths, tags: rawTags, tests: rawTests } = m as Record<string, unknown>;
    const paths = globList(rawPaths, `${field}.paths`);
    if (paths.length === 0) throw new Error(`${field}.paths must not be empty`);
    const tags = tagList(rawTags, `${field}.tags`);
    const tests = stringList(rawTests, `${field}.tests`);
    if (tags.length === 0 && tests.length === 0) throw new Error(`${field} needs tags or tests`);
    return { paths, tags, tests };
  });

  return {
    testDir: testDir(raw.test_dir),
    alwaysRunTags: tagList(raw.always_run_tags, 'always_run_tags'),
    fullRunTriggers: globList(raw.full_run_triggers, 'full_run_triggers'),
    ignorePaths: globList(raw.ignore_paths, 'ignore_paths'),
    mappings,
    unmappedBehavior,
  };
}

export function loadConfig(file: string): Config {
  return parseConfig(readFileSync(file, 'utf8'));
}
