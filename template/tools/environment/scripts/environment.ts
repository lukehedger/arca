// Deploys, tests and destroys a disposable environment named after ENVIRONMENT_NAME or the current git branch.
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { MAX_STACK_NAME_LENGTH, PROJECT, stackNameFor } from 'infra/stack-name';
import { z } from 'zod';
import { resolveEnvironment } from '../environment.ts';

const root = join(import.meta.dirname, '../../..');
const infra = join(root, 'infra');

const outputsSchema = z.record(
  z.string(),
  z.object({ StateTableName: z.string() }),
);

const run = (
  command: readonly string[],
  cwd: string,
  env: Record<string, string>,
): void => {
  const result = Bun.spawnSync([...command], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  if (result.exitCode !== 0) process.exit(result.exitCode);
};

const currentBranch = (): string | undefined => {
  const result = Bun.spawnSync(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: root,
  });
  return result.exitCode === 0 ? result.stdout.toString().trim() : undefined;
};

const environment = resolveEnvironment(
  { explicit: process.env.ENVIRONMENT_NAME, branch: currentBranch() },
  MAX_STACK_NAME_LENGTH - PROJECT.length - 1,
);
const stackName = stackNameFor(environment);
const outputsFile = join(root, '.environments', `${environment}.json`);
// A disposable environment leaves nothing behind when it is destroyed.
const cdkEnv = {
  ENVIRONMENT_NAME: environment,
  DELETION_PROTECTION: 'false',
};

const deploy = async (): Promise<void> => {
  await mkdir(dirname(outputsFile), { recursive: true });
  run(
    [
      'bun',
      'run',
      'cdk',
      'deploy',
      stackName,
      '--exclusively',
      '--require-approval',
      'never',
      '--outputs-file',
      outputsFile,
    ],
    infra,
    cdkEnv,
  );
};

const integrationTest = async (): Promise<void> => {
  if (!existsSync(outputsFile)) {
    throw new Error(
      `${stackName} has no outputs. Run \`bun env:deploy\` first.`,
    );
  }
  const outputs = outputsSchema.parse(
    JSON.parse(await readFile(outputsFile, 'utf8')),
  );
  const stack = outputs[stackName];
  if (stack === undefined) {
    throw new Error(
      `${outputsFile} holds no outputs for ${stackName}. Run \`bun env:deploy\` again.`,
    );
  }

  run(['bun', 'run', 'test:integration'], root, {
    STATE_TABLE_NAME: stack.StateTableName,
  });
};

const destroy = async (): Promise<void> => {
  run(
    ['bun', 'run', 'cdk', 'destroy', stackName, '--exclusively', '--force'],
    infra,
    cdkEnv,
  );
  await rm(outputsFile, { force: true });
};

const commands: Readonly<Record<string, () => Promise<void>>> = {
  deploy,
  test: integrationTest,
  destroy,
};

const command = commands[process.argv[2] ?? ''];
if (command === undefined) {
  console.error(
    'Usage: bun tools/environment/scripts/environment.ts <deploy|test|destroy>',
  );
  process.exit(1);
}
console.info(`Environment ${environment}, stack ${stackName}`);
await command();
