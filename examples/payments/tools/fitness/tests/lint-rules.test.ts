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
      "import type { EventLog } from '@payments/store';\nexport type Log = EventLog<never>;",
    expected: 'The core is pure',
  },
  {
    rule: 'a handler imports the core',
    directory: 'api',
    source:
      "import { vocabulary } from '@payments/core';\nexport const names = vocabulary;",
    expected: 'A handler declares its route with createApiHandler',
  },
  {
    rule: 'a handler imports the store',
    directory: 'api',
    source:
      "import { createDocumentClient } from '@payments/store';\nexport const client = createDocumentClient;",
    expected: 'A handler declares its route with createApiHandler',
  },
  {
    rule: 'a handler calls an AWS SDK',
    directory: 'api',
    source:
      "import { DynamoDBClient } from '@aws-sdk/client-dynamodb';\nexport const client = new DynamoDBClient({});",
    expected: 'A handler declares its route with createApiHandler',
  },
  {
    rule: 'a handler maps errors by hand',
    directory: 'api',
    source:
      "import { mapErrorToResponse } from '@payments/errors';\nexport const map = mapErrorToResponse;",
    expected: 'A handler declares its route with createApiHandler',
  },
  {
    rule: 'an async handler imports the store',
    directory: 'async',
    source:
      "import { createDocumentClient } from '@payments/store';\nexport const client = createDocumentClient;",
    expected: 'A handler parses the request into a command',
  },
  {
    rule: 'a handler imports a package by its path',
    directory: 'api',
    source:
      "import { jsonBody } from '../../packages/schema/index.ts';\nexport const body = jsonBody;",
    expected: 'Import another workspace package by its name',
  },
  {
    rule: 'deployed code uses Bun',
    directory: 'api',
    source: "export const file = (): unknown => Bun.file('x');",
    expected: 'global variable Bun',
  },
  {
    rule: 'the gate parses requests',
    directory: 'packages/gate',
    source:
      "import { jsonBody } from '@payments/schema';\nexport const body = jsonBody;",
    expected: 'The gate loads state from the store',
  },
  {
    rule: 'the HTTP package calls the gate',
    directory: 'packages/http',
    source: "import * as gate from '@payments/gate';\nexport const all = gate;",
    expected: 'The HTTP package turns a route declaration into a handler',
  },
  {
    rule: 'the store imports the core',
    directory: 'packages/store',
    source:
      "import { vocabulary } from '@payments/core';\nexport const names = vocabulary;",
    expected: 'The store persists state',
  },
  {
    rule: 'the schema imports the store',
    directory: 'packages/schema',
    source:
      "import { createDocumentClient } from '@payments/store';\nexport const client = createDocumentClient;",
    expected: "The schema parses data at the boundary into the core's types",
  },
  {
    rule: 'a leaf package imports another package',
    directory: 'packages/errors',
    source:
      "import { jsonBody } from '@payments/schema';\nexport const body = jsonBody;",
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
