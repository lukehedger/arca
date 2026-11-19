import { vocabulary } from '@<project>/core';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDomain } from '../domain.ts';
import { findDrift } from '../drift.ts';
import { findUntestedInvariants, parsePropertyResults } from '../invariants.ts';

const root = join(import.meta.dirname, '../../..');

const domain = parseDomain(await readFile(join(root, 'DOMAIN.md'), 'utf8'));

// Runs the core tests, so a property that is commented out, skipped or failing does not count.
const runProperties = async (): Promise<string> => {
  const report = join(tmpdir(), `invariants-${randomUUID()}.xml`);
  Bun.spawnSync(
    [
      process.execPath,
      'test',
      '--pass-with-no-tests',
      '--reporter=junit',
      `--reporter-outfile=${report}`,
    ],
    { cwd: join(root, 'core'), stdout: 'ignore', stderr: 'ignore' },
  );
  if (!existsSync(report)) {
    throw new Error(
      'Invariant coverage: the core tests wrote no report. Run `bun test` in core/ to see why.',
    );
  }

  const junit = await readFile(report, 'utf8');
  await rm(report);
  return junit;
};

const findings = [
  ...findDrift(domain, vocabulary),
  ...findUntestedInvariants(
    vocabulary.invariants,
    parsePropertyResults(await runProperties()),
  ),
];

for (const finding of findings) console.error(finding);
if (findings.length > 0) process.exit(1);

console.info('Fitness functions pass.');
