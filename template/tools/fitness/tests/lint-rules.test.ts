import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';

// Each probe is a deliberate violation written where the rule applies, so a weakened Biome config fails this test.
type Probe = {
  readonly rule: string;
  readonly directory: string;
  readonly source: string;
  readonly expected: string;
};

const root = join(import.meta.dirname, '../../..');

const probes: readonly Probe[] = [
  {
    rule: 'the core calls Math.random',
    directory: 'core',
    source: 'export const roll = (): number => Math.random();',
    expected: 'cannot call Math.random',
  },
  {
    rule: 'the core reads Math with a computed key',
    directory: 'core',
    source:
      "const key = 'random';\nexport const roll = (): unknown => Math[key];",
    expected: 'A computed key can reach Math.random',
  },
  {
    rule: 'the core aliases Math',
    directory: 'core',
    source:
      'const { random } = Math;\nexport const roll = (): number => random();',
    expected: 'An alias of Math can reach Math.random',
  },
  {
    rule: 'the core reads the clock',
    directory: 'core',
    source: 'export const now = (): number => Date.now();',
    expected: 'global variable Date',
  },
  {
    rule: 'the core reads a high-resolution clock',
    directory: 'core',
    source: 'export const now = (): number => performance.now();',
    expected: 'global variable performance',
  },
  {
    rule: 'the core generates an identifier',
    directory: 'core',
    source: 'export const id = (): string => crypto.randomUUID();',
    expected: 'global variable crypto',
  },
  {
    rule: 'the core reaches a global through globalThis',
    directory: 'core',
    source: 'export const roll = (): number => globalThis.Math.random();',
    expected: 'global variable globalThis',
  },
  {
    rule: 'the core reads the environment',
    directory: 'core',
    source: "export const flag = (): unknown => process.env['FLAG'];",
    expected: 'global variable process',
  },
  {
    rule: 'the core schedules work',
    directory: 'core',
    source:
      'export const later = (): unknown => setTimeout(() => undefined, 1);',
    expected: 'global variable setTimeout',
  },
  {
    rule: 'the core imports a Node.js module',
    directory: 'core',
    source:
      "import { readFile } from 'node:fs/promises';\nexport const read = readFile;",
    expected: 'Node.js builtin module',
  },
  {
    rule: 'the core imports the store',
    directory: 'core',
    source:
      "import type { EventLog } from '@<project>/store';\nexport type Log = EventLog<never>;",
    expected: 'The core is pure',
  },
  {
    rule: 'a handler imports the gate',
    directory: 'api',
    source:
      "import { createEventSourcedGate } from '@<project>/gate';\nexport const gate = createEventSourcedGate;",
    expected: 'A handler only parses, validates, routes and maps the result',
  },
  {
    rule: 'a handler calls an AWS SDK',
    directory: 'api',
    source:
      "import { DynamoDBClient } from '@aws-sdk/client-dynamodb';\nexport const client = new DynamoDBClient({});",
    expected: 'A handler only parses, validates, routes and maps the result',
  },
  {
    rule: 'a handler imports a package by its path',
    directory: 'api',
    source:
      "import { registry } from '../../packages/router/index.ts';\nexport const routes = registry;",
    expected: 'Import another workspace package by its name',
  },
  {
    rule: 'deployed code uses Bun',
    directory: 'api',
    source: "export const file = (): unknown => Bun.file('x');",
    expected: 'global variable Bun',
  },
  {
    rule: 'the router skips the adapters',
    directory: 'packages/router',
    source:
      "import type { EventSourcedGate } from '@<project>/gate';\nexport type Gate = EventSourcedGate<never, never, never, never>;",
    expected: 'The router only resolves the adapter for a variant',
  },
  {
    rule: 'an adapter skips the gate',
    directory: 'packages/adapters',
    source:
      "import { createDocumentClient } from '@<project>/store';\nexport const client = createDocumentClient;",
    expected: 'An adapter translates a request into a command',
  },
  {
    rule: 'the gate calls upward',
    directory: 'packages/gate',
    source:
      "import { registry } from '@<project>/router';\nexport const routes = registry;",
    expected: 'The gate loads state from the store',
  },
  {
    rule: 'the store imports the core',
    directory: 'packages/store',
    source:
      "import { vocabulary } from '@<project>/core';\nexport const names = vocabulary;",
    expected: 'The store persists state',
  },
  {
    rule: 'a leaf package imports another package',
    directory: 'packages/schema',
    source:
      "import { classifyError } from '@<project>/errors';\nexport const classify = classifyError;",
    expected: 'This package is a leaf',
  },
];

const clean = {
  directory: 'core',
  source:
    'export const clamp = (value: number, limit: number): number =>\n  Math.min(Math.max(0, Math.round(value)), limit);',
};

const diagnosticsSchema = z.object({
  diagnostics: z.array(
    z.object({
      message: z.string(),
      location: z.object({ path: z.string().optional() }).optional(),
    }),
  ),
});

const probePath = (directory: string): string =>
  join(directory, `lint-probe-${randomUUID()}.ts`);

const probeFiles = probes.map((probe) => ({
  ...probe,
  path: probePath(probe.directory),
}));
const cleanFile = { ...clean, path: probePath(clean.directory) };
const written = [...probeFiles, cleanFile];
const createdDirectories = [
  ...new Set(written.map(({ directory }) => directory)),
].filter((directory) => !existsSync(join(root, directory)));

const messagesByPath = new Map<string, string[]>();

beforeAll(async () => {
  for (const { path, source } of written) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), `${source}\n`);
  }

  const lint = Bun.spawnSync(
    [
      join(root, 'node_modules/.bin/biome'),
      'lint',
      '--reporter=json',
      '--max-diagnostics=none',
      ...written.map(({ path }) => path),
    ],
    { cwd: root, stderr: 'ignore' },
  );
  const { diagnostics } = diagnosticsSchema.parse(
    JSON.parse(lint.stdout.toString()),
  );
  for (const { message, location } of diagnostics) {
    const path = location?.path ?? '';
    messagesByPath.set(path, [...(messagesByPath.get(path) ?? []), message]);
  }
});

afterAll(async () => {
  for (const { path } of written) await rm(join(root, path), { force: true });
  for (const directory of createdDirectories) {
    await rm(join(root, directory), { recursive: true, force: true });
  }
});

describe('lint rules', () => {
  test.each(probeFiles)('fail when $rule', ({ path, expected }) => {
    const messages = messagesByPath.get(path) ?? [];
    expect(messages.some((message) => message.includes(expected))).toBe(true);
  });

  test('pass deterministic core code that uses Math functions directly', () => {
    expect(messagesByPath.get(cleanFile.path) ?? []).toEqual([]);
  });
});
