import { basename, extname } from 'node:path';

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
