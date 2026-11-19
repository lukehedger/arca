// Copies template/ into a project: resolves the conditional blocks, fills the script placeholders and places the automation.
// Usage: bun scripts/bootstrap.ts --target <dir> --name <project> --owner <owner> --state <event-sourcing|crud> [--title <Project>] [--migration <app-dir>] [--skip-existing]
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

export type Flag = 'greenfield' | 'migration' | 'event-sourcing' | 'crud';

export type State = 'event-sourcing' | 'crud';

export type Profile = {
  readonly name: string;
  readonly title: string;
  readonly owner: string;
  readonly state: State;
  // Set for a migration: the directory inside the existing repository that holds the new implementation.
  readonly appDir: string | undefined;
};

const FLAGS: ReadonlySet<string> = new Set<Flag>([
  'greenfield',
  'migration',
  'event-sourcing',
  'crud',
]);

// The placeholders the script fills. The agent fills the domain placeholders during the interview.
export const SCRIPT_PLACEHOLDERS = [
  '<project>',
  '<Project>',
  '<owner>',
  '<app-dir>',
  '<app-root>',
  '<workflow-prefix>',
] as const;

export const AGENT_PLACEHOLDERS = [
  '<Domain>',
  '<Entity>',
  '<entity>',
  '<ENTITY>',
  '<Term>',
  '<path to core model>',
  '<routing config>',
] as const;

export const flagsOf = (profile: Profile): ReadonlySet<Flag> =>
  new Set<Flag>([
    profile.appDir === undefined ? 'greenfield' : 'migration',
    profile.state,
  ]);

export const placeholdersOf = (
  profile: Profile,
): Readonly<Record<(typeof SCRIPT_PLACEHOLDERS)[number], string | undefined>> => ({
  '<project>': profile.name,
  '<Project>': profile.title,
  '<owner>': profile.owner,
  // A new project has no app directory, so the placeholder may appear only inside a migration block.
  '<app-dir>': profile.appDir,
  '<app-root>': profile.appDir ?? '.',
  '<workflow-prefix>': profile.appDir === undefined ? '' : `${profile.appDir}-`,
});

type MarkerStyle = 'html' | 'slash' | 'hash';

const STYLE_BY_EXTENSION: Readonly<Record<string, MarkerStyle>> = {
  '.md': 'html',
  '.ts': 'slash',
  '.grit': 'slash',
  '.yml': 'hash',
  '.yaml': 'hash',
};

const STYLE_BY_NAME: Readonly<Record<string, MarkerStyle>> = {
  CODEOWNERS: 'hash',
  '.gitignore': 'hash',
};

const MARKER: Readonly<Record<MarkerStyle, RegExp>> = {
  html: /^\s*<!--\s*(if: [a-z-]+|end)\s*-->\s*$/,
  slash: /^\s*\/\/\s*(if: [a-z-]+|end)\s*$/,
  hash: /^\s*#\s*(if: [a-z-]+|end)\s*$/,
};

const markerStyleOf = (path: string): MarkerStyle | undefined =>
  STYLE_BY_NAME[basename(path)] ?? STYLE_BY_EXTENSION[extname(path)];

// A block runs from an `if` marker to the next `if` marker or `end` marker. Blocks do not nest.
export const resolveBlocks = (
  path: string,
  text: string,
  flags: ReadonlySet<Flag>,
): string => {
  const style = markerStyleOf(path);
  if (style === undefined) return text;

  const kept: string[] = [];
  let block: Flag | undefined;
  let lineNumber = 0;
  for (const line of text.split('\n')) {
    lineNumber++;
    const marker = MARKER[style].exec(line)?.[1];
    if (marker === undefined) {
      if (block === undefined || flags.has(block)) kept.push(line);
      continue;
    }
    if (marker === 'end') {
      if (block === undefined) {
        throw new Error(`${path}:${lineNumber}: end marker outside a block`);
      }
      block = undefined;
      continue;
    }
    const flag = marker.slice('if: '.length);
    if (!FLAGS.has(flag)) {
      throw new Error(`${path}:${lineNumber}: unknown flag ${flag}`);
    }
    block = flag as Flag;
  }
  if (block !== undefined) {
    throw new Error(`${path}: the ${block} block has no end marker`);
  }

  return kept
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n{3,}/g, '\n\n');
};

export const fillPlaceholders = (
  path: string,
  text: string,
  values: Readonly<Record<string, string | undefined>>,
): string =>
  Object.entries(values).reduce((current, [placeholder, value]) => {
    if (value !== undefined) return current.replaceAll(placeholder, value);
    if (current.includes(placeholder)) {
      throw new Error(
        `${path}: ${placeholder} has no value in this profile. Move it into a conditional block.`,
      );
    }
    return current;
  }, text);

// Undefined means the file belongs to the other mode, so the project does not receive it.
export const renderFile = (
  path: string,
  text: string,
  profile: Profile,
): string | undefined => {
  const resolved = resolveBlocks(path, text, flagsOf(profile));
  if (resolved.trim() === '') return undefined;

  return fillPlaceholders(path, resolved, placeholdersOf(profile));
};

const WORKFLOW = /^\.github\/workflows\/([^/]+)$/;

// GitHub reads automation only from the repository root, so a migration places `.github/` there.
export const destinationOf = (path: string, profile: Profile): string => {
  if (profile.appDir === undefined) return path;
  if (!path.startsWith('.github/')) return `${profile.appDir}/${path}`;

  const workflow = WORKFLOW.exec(path)?.[1];
  return workflow === undefined
    ? path
    : `.github/workflows/${profile.appDir}-${workflow}`;
};

export const remainingPlaceholders = (text: string): readonly string[] =>
  AGENT_PLACEHOLDERS.filter((placeholder) => text.includes(placeholder));

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

const main = async (): Promise<void> => {
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
};

if (import.meta.main) await main();
