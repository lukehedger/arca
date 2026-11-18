import { createHash } from 'node:crypto';

// The pipeline deploys these. The environment tool must never deploy over them or destroy them.
export const PROTECTED_ENVIRONMENTS: ReadonlySet<string> = new Set([
  'acc',
  'dev',
  'main',
  'master',
  'prod',
  'production',
  'staging',
]);

const HASH_LENGTH = 6;

// A truncated name keeps a hash of the full name, so two long branches that share a prefix get different stacks.
export const toEnvironmentName = (
  source: string,
  maxLength: number,
): string => {
  const name = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (name === '') {
    throw new Error(`Cannot derive an environment name from ${source}`);
  }
  if (name.length <= maxLength) return name;

  const hash = createHash('sha256')
    .update(name)
    .digest('hex')
    .slice(0, HASH_LENGTH);
  const prefix = name.slice(0, maxLength - HASH_LENGTH - 1).replace(/-+$/, '');

  return `${prefix}-${hash}`;
};

export type EnvironmentSource = {
  readonly explicit: string | undefined;
  readonly branch: string | undefined;
};

export const resolveEnvironment = (
  source: EnvironmentSource,
  maxLength: number,
): string => {
  const raw = source.explicit ?? source.branch;
  if (raw === undefined || raw === '') {
    throw new Error(
      'Set ENVIRONMENT_NAME or run inside a git branch to name the disposable environment',
    );
  }

  const environment = toEnvironmentName(raw, maxLength);
  if (PROTECTED_ENVIRONMENTS.has(environment)) {
    throw new Error(
      `${environment} is a pipeline environment. The environment tool only manages disposable environments.`,
    );
  }

  return environment;
};
