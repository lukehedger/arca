// Copies template/ into a project: resolves the conditional blocks, fills the script placeholders and places the automation.
// Usage: bun scripts/bootstrap.ts --target <dir> --name <project> --owner <owner> --state <event-sourcing|crud> [--title <Project>] [--migration <app-dir>] [--skip-existing]
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  destinationOf,
  type Profile,
  remainingPlaceholders,
  renderFile,
  type State,
} from './template.ts';

const TEMPLATE = join(import.meta.dirname, '../template');
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  '.turbo',
  'cdk.out',
  '.stryker-tmp',
]);
const NAME = /^[a-z][a-z0-9-]*$/;
const APP_DIR = /^[a-z0-9][a-z0-9._-]*$/;

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const { values } = parseArgs({
  options: {
    target: { type: 'string' },
    name: { type: 'string' },
    title: { type: 'string' },
    owner: { type: 'string' },
    state: { type: 'string' },
    migration: { type: 'string' },
    'skip-existing': { type: 'boolean', default: false },
  },
});

const target = resolve(values.target ?? fail('--target is required'));
const name = values.name ?? fail('--name is required');
if (!NAME.test(name)) {
  fail(`--name must be lower-case kebab-case, such as order-service, not ${name}`);
}
const owner = values.owner ?? fail('--owner is required, such as @org/team');
const state = values.state;
if (state !== 'event-sourcing' && state !== 'crud') {
  fail('--state must be event-sourcing or crud');
}
const appDir = values.migration;
if (appDir !== undefined && !APP_DIR.test(appDir)) {
  fail(`--migration must be a single directory name, not ${appDir}`);
}

const profile: Profile = {
  name,
  title: values.title ?? name,
  owner,
  state: state as State,
  appDir,
};

if (appDir === undefined) {
  const entries = existsSync(target) ? await readdir(target) : [];
  const unexpected = entries.filter((entry) => entry !== '.git');
  if (unexpected.length > 0) {
    fail(
      `${target} already holds ${unexpected.join(', ')}. A new project needs a directory that holds nothing but .git.`,
    );
  }
} else {
  if (!existsSync(target)) fail(`${target} does not exist`);
  if (existsSync(join(target, appDir))) {
    fail(`${join(target, appDir)} already exists`);
  }
}

const listFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return SKIPPED_DIRECTORIES.has(entry.name) ? [] : listFiles(path);
      }
      return entry.name === 'bun.lock' ? [] : [path];
    }),
  );
  return nested.flat();
};

const rendered = (
  await Promise.all(
    (await listFiles(TEMPLATE)).map(async (path) => {
      const source = relative(TEMPLATE, path);
      const content = renderFile(source, await readFile(path, 'utf8'), profile);
      return content === undefined
        ? []
        : [{ destination: destinationOf(source, profile), content }];
    }),
  )
)
  .flat()
  .sort((a, b) => a.destination.localeCompare(b.destination));

const existing = rendered.filter(({ destination }) =>
  existsSync(join(target, destination)),
);
if (existing.length > 0 && !values['skip-existing']) {
  fail(
    [
      'These files already exist, so nothing was written:',
      ...existing.map(({ destination }) => `  ${destination}`),
      'Ask the user how to merge them. Run again with --skip-existing to write everything else and leave them untouched.',
    ].join('\n'),
  );
}

const skippedCopies =
  existing.length > 0 ? await mkdtemp(join(tmpdir(), 'arca-skipped-')) : '';
for (const { destination, content } of rendered) {
  const isExisting = existing.some((file) => file.destination === destination);
  const path = isExisting
    ? join(skippedCopies, destination)
    : join(target, destination);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

console.info(
  `Wrote ${rendered.length - existing.length} files to ${target}${appDir === undefined ? '' : ` (${appDir}/ and .github/)`}.`,
);
if (existing.length > 0) {
  console.info(
    `Left ${existing.length} existing files untouched. Merge each one by hand from the rendered copy:`,
  );
  for (const { destination } of existing) {
    console.info(`  ${destination} <- ${join(skippedCopies, destination)}`);
  }
}

const open = rendered.flatMap(({ destination, content }) => {
  const placeholders = remainingPlaceholders(content);
  return placeholders.length === 0
    ? []
    : [`  ${destination}: ${placeholders.join(', ')}`];
});
if (open.length > 0) {
  console.info(['Placeholders left for the interview:', ...open].join('\n'));
}
