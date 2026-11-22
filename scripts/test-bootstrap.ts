// The acceptance test for arca. Bootstraps every profile, verifies the fresh copy, lays the account example over it,
// verifies it again, then proves that deliberate architecture, domain and concurrency breakages fail the checks.
// Usage: bun scripts/test-bootstrap.ts [--profile <id>] [--keep]
import { existsSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { type Profile, renderFile, SCRIPT_PLACEHOLDERS, type State } from './bootstrap.ts';

const BOOTSTRAP = join(import.meta.dirname, 'bootstrap.ts');
const EXAMPLES = join(import.meta.dirname, '../examples');
const NAME = 'sample';
const OWNER = '@org/team';
const APP_DIR = 'next';

type ProfileCase = { readonly id: string; readonly state: State; readonly appDir: string | undefined };

const PROFILES: readonly ProfileCase[] = [
  { id: 'greenfield-event-sourcing', state: 'event-sourcing', appDir: undefined },
  { id: 'greenfield-crud', state: 'crud', appDir: undefined },
  { id: 'migration-event-sourcing', state: 'event-sourcing', appDir: APP_DIR },
  { id: 'migration-crud', state: 'crud', appDir: APP_DIR },
];

const { values: options } = parseArgs({
  options: { profile: { type: 'string' }, keep: { type: 'boolean', default: false } },
});

type Result = { readonly exitCode: number; readonly output: string };

const run = async (
  command: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string>> = {},
): Promise<Result> => {
  const child = Bun.spawn([...command], {
    cwd,
    env: { ...process.env, ...env, FORCE_COLOR: '0', NO_COLOR: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, output: `${stdout}\n${stderr}` };
};

class CheckFailed extends Error {}

const check = (condition: boolean, message: string, output = ''): void => {
  if (!condition) {
    throw new CheckFailed(output === '' ? message : `${message}\n--- output ---\n${output.slice(-6000)}`);
  }
};

const mustPass = async (label: string, command: readonly string[], cwd: string, env = {}): Promise<Result> => {
  const result = await run(command, cwd, env);
  check(result.exitCode === 0, `${label} failed with exit code ${result.exitCode}`, result.output);
  return result;
};

const listFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      if (['node_modules', '.git', '.turbo', 'cdk.out', '.stryker-tmp'].includes(entry.name)) return [];
      const path = join(directory, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    }),
  );
  return nested.flat();
};

// Lays an example over a bootstrapped project. The example replaces any file it also holds.
const applyExample = async (name: string, appRoot: string, profile: Profile): Promise<void> => {
  const source = join(EXAMPLES, name);
  for (const path of await listFiles(source)) {
    const file = relative(source, path);
    if (file === 'README.md') continue;
    const content = renderFile(file, await readFile(path, 'utf8'), profile);
    const destination = join(appRoot, file);
    if (content === undefined) {
      await rm(destination, { force: true });
      continue;
    }
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
};

const bootstrapArgs = (target: string, profile: ProfileCase): string[] => [
  'bun',
  BOOTSTRAP,
  '--target',
  target,
  '--name',
  NAME,
  '--owner',
  OWNER,
  '--state',
  profile.state,
  ...(profile.appDir === undefined ? [] : ['--migration', profile.appDir]),
];

const LEGACY_FILES: Readonly<Record<string, string>> = {
  'README.md': '# Legacy service\n',
  'src/server.js': "export const serve = () => 'legacy';\n",
  '.github/workflows/ci.yml': 'name: legacy-ci\non: [push]\njobs: {}\n',
  '.github/CODEOWNERS': '* @legacy/owners\n',
};

const seedLegacyRepository = async (root: string): Promise<void> => {
  for (const [path, content] of Object.entries(LEGACY_FILES)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
};

// Every marker and every script placeholder must be gone, and the other mode's files must be absent.
const checkRendered = async (root: string, appRoot: string, profile: ProfileCase): Promise<void> => {
  const files = [...(await listFiles(appRoot)), ...(await listFiles(join(root, '.github')))];
  const marker = /^\s*(<!--\s*(if: [a-z-]+|end)\s*-->|\/\/\s*(if: [a-z-]+|end)|#\s*(if: [a-z-]+|end))\s*$/m;
  for (const path of files) {
    if (path.includes('/.github/') && relative(root, path) in LEGACY_FILES) continue;
    const content = await readFile(path, 'utf8');
    check(!marker.test(content), `${relative(root, path)} still holds a conditional marker`);
    for (const placeholder of SCRIPT_PLACEHOLDERS) {
      check(!content.includes(placeholder), `${relative(root, path)} still holds ${placeholder}`);
    }
  }

  const otherMode = profile.state === 'crud' ? 'event-sourcing' : 'crud';
  for (const path of [`packages/store/${otherMode}.ts`, `packages/gate/${otherMode}.ts`]) {
    check(!existsSync(join(appRoot, path)), `${path} belongs to the other mode but was copied`);
  }
};

const workflowSchemaOf = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

// GitHub reads workflows only at the repository root, so each one must run from the app root and reference real files.
const checkAutomation = async (root: string, profile: ProfileCase): Promise<void> => {
  const appRoot = profile.appDir ?? '.';
  const prefix = profile.appDir === undefined ? '' : `${profile.appDir}-`;
  const workflows = ['ci', 'cd', 'deploy', 'dependencies'].map((name) => `.github/workflows/${prefix}${name}.yml`);

  for (const path of workflows) {
    check(existsSync(join(root, path)), `${path} is missing from the repository root`);
    const text = await readFile(join(root, path), 'utf8');
    const workflow = workflowSchemaOf(Bun.YAML.parse(text));
    const defaults = workflowSchemaOf(workflowSchemaOf(workflow.defaults).run);
    if (/^\s+run: /m.test(text)) {
      check(defaults['working-directory'] === appRoot, `${path} runs commands outside ${appRoot}`);
    }

    for (const [, reference] of text.matchAll(/uses: \.\/(\.github\/workflows\/[^\s]+)/g)) {
      check(existsSync(join(root, reference ?? '')), `${path} calls ${reference}, which does not exist`);
    }
    for (const [, file] of text.matchAll(/bun-version-file: (\S+)/g)) {
      check(existsSync(join(root, file ?? '')), `${path} reads the Bun version from ${file}, which does not exist`);
    }
    for (const [, directory] of text.matchAll(/^ {8}working-directory: (\S+)/gm)) {
      check(existsSync(join(root, directory ?? '')), `${path} runs a step in ${directory}, which does not exist`);
    }
  }

  if (profile.appDir !== undefined) {
    const ci = workflowSchemaOf(Bun.YAML.parse(await readFile(join(root, workflows[0] ?? ''), 'utf8')));
    const pullRequest = workflowSchemaOf(workflowSchemaOf(ci.on).pull_request);
    check(
      Array.isArray(pullRequest.paths) && pullRequest.paths.includes(`${profile.appDir}/**`),
      'The migration CI workflow does not trigger on changes to the app directory',
    );
    for (const [path, content] of Object.entries(LEGACY_FILES)) {
      check((await readFile(join(root, path), 'utf8')) === content, `Bootstrap changed the existing file ${path}`);
    }
  }

  const settings = await readFile(join(root, appRoot, '.claude/settings.json'), 'utf8');
  const { attribution } = workflowSchemaOf(JSON.parse(settings));
  check(
    JSON.stringify(attribution) === JSON.stringify({ commit: '', pr: '' }),
    'The Claude Code settings let it add attribution to commits or pull requests',
  );
  const statusLine = /show-toplevel\)\/([^"\\]+)/.exec(settings)?.[1] ?? '';
  check(existsSync(join(root, statusLine)), `The status line command points at ${statusLine}, which does not exist`);
  await checkWrenPlugin(join(root, appRoot), workflowSchemaOf(JSON.parse(settings)));
};

// The settings enable wren from the project's own marketplace, so a session in the app root loads the worktree hooks.
const checkWrenPlugin = async (appRoot: string, settings: Record<string, unknown>): Promise<void> => {
  check(workflowSchemaOf(settings.enabledPlugins)[`wren@${NAME}`] === true, 'The Claude Code settings do not enable the wren plugin');
  const source = workflowSchemaOf(workflowSchemaOf(workflowSchemaOf(settings.extraKnownMarketplaces)[NAME]).source);
  const marketplaceRoot = join(appRoot, typeof source.path === 'string' ? source.path : '');
  const marketplace = workflowSchemaOf(
    JSON.parse(await readFile(join(marketplaceRoot, '.claude-plugin/marketplace.json'), 'utf8')),
  );
  check(marketplace.name === NAME, `The marketplace is named ${String(marketplace.name)}, not ${NAME}`);
  const plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins.map(workflowSchemaOf) : [];
  const wren = plugins.find((plugin) => plugin.name === 'wren');
  const pluginRoot = join(marketplaceRoot, typeof wren?.source === 'string' ? wren.source : '');
  check(existsSync(join(pluginRoot, '.claude-plugin/plugin.json')), `The wren plugin source ${pluginRoot} has no plugin.json`);
  check(existsSync(join(pluginRoot, 'hooks/hooks.json')), 'The wren plugin has no hooks module');
};

type Breakage = {
  readonly name: string;
  readonly files: readonly string[];
  readonly expected: string;
  readonly apply: (appRoot: string) => Promise<void>;
};

const edit = async (path: string, from: string, to: string): Promise<void> => {
  const content = await readFile(path, 'utf8');
  check(content.includes(from), `Breakage could not find its target in ${path}: ${from.slice(0, 80)}`);
  await writeFile(path, content.replace(from, to));
};

const append = async (path: string, text: string): Promise<void> => {
  await writeFile(path, `${await readFile(path, 'utf8')}\n${text}\n`);
};

const NEW_INVARIANT = 'overdraft-limit-respected';

const addInvariant = async (appRoot: string): Promise<void> => {
  await edit(
    join(appRoot, 'core/vocabulary.ts'),
    "'closed-account-is-final',",
    `'closed-account-is-final',\n    '${NEW_INVARIANT}',`,
  );
  await edit(
    join(appRoot, 'DOMAIN.md'),
    '| `closed-account-is-final` |',
    `| \`${NEW_INVARIANT}\` | A withdrawal never passes the overdraft limit |\n| \`closed-account-is-final\` |`,
  );
};

const breakagesFor = (state: State): readonly Breakage[] => [
  {
    name: 'isolation: the guard lets an edit into the primary checkout',
    files: ['tools/wren/worktree/guard.ts'],
    expected: '(fail) pathRefusal > refuses a repository file before the worktree',
    apply: (appRoot) =>
      edit(
        join(appRoot, 'tools/wren/worktree/guard.ts'),
        '  if (!isWorktree(checkout)) return ENTER_WORKTREE;',
        '  if (!isWorktree(checkout)) return undefined;',
      ),
  },
  {
    name: 'isolation: the hooks module reads a field the engine does not send',
    files: ['tools/wren/claude/register.ts'],
    expected: 'error file="tools/wren/claude/register.ts"',
    apply: (appRoot) =>
      edit(
        join(appRoot, 'tools/wren/claude/register.ts'),
        'refusePath($, e.agentId, e.notebook_path)',
        'refusePath($, e.agentId, e.path)',
      ),
  },
  {
    name: 'architecture: a handler imports the gate',
    files: ['api/accounts/handler.ts'],
    expected: 'A handler only parses, validates, routes and maps the result',
    apply: (appRoot) =>
      append(
        join(appRoot, 'api/accounts/handler.ts'),
        `import type { AccountGate } from '@${NAME}/gate';\nexport type LeakedGate = AccountGate;`,
      ),
  },
  {
    name: 'architecture: the core imports the store',
    files: ['core/account.ts'],
    expected: 'The core is pure',
    apply: (appRoot) =>
      append(
        join(appRoot, 'core/account.ts'),
        `import type { createDocumentClient } from '@${NAME}/store';\nexport type Leaked = typeof createDocumentClient;`,
      ),
  },
  {
    name: 'architecture: a new variant has no adapter in the registry',
    files: ['packages/schema/variant.ts'],
    expected: 'error file="packages/router/registry.ts"',
    apply: (appRoot) =>
      edit(join(appRoot, 'packages/schema/variant.ts'), "['ledger'] as const", "['ledger', 'acme'] as const"),
  },
  {
    name: 'determinism: the core calls Math.random',
    files: ['core/account.ts'],
    expected: 'cannot call Math.random',
    apply: (appRoot) =>
      edit(
        join(appRoot, 'core/account.ts'),
        "assert(balance >= 0, 'Balance is negative');",
        "assert(balance >= Math.random() - 1, 'Balance is negative');",
      ),
  },
  {
    name: 'determinism: the core reads the clock',
    files: ['core/account.ts'],
    expected: 'global variable Date',
    apply: (appRoot) => append(join(appRoot, 'core/account.ts'), 'export const decidedAt = (): number => Date.now();'),
  },
  {
    name: 'domain: DOMAIN.md names an invariant the vocabulary lacks',
    files: ['DOMAIN.md'],
    expected: `DOMAIN.md defines invariant \`${NEW_INVARIANT}\``,
    apply: (appRoot) =>
      edit(
        join(appRoot, 'DOMAIN.md'),
        '| `closed-account-is-final` |',
        `| \`${NEW_INVARIANT}\` | A withdrawal never passes the overdraft limit |\n| \`closed-account-is-final\` |`,
      ),
  },
  {
    name: 'domain: the vocabulary declares a command DOMAIN.md lacks',
    files: ['core/vocabulary.ts'],
    expected: 'declares command `freeze_account` but DOMAIN.md',
    apply: (appRoot) =>
      edit(join(appRoot, 'core/vocabulary.ts'), "'close_account',", "'close_account',\n    'freeze_account',"),
  },
  {
    name: 'domain: an invariant whose property is commented out',
    files: ['core/vocabulary.ts', 'DOMAIN.md', 'core/tests/account-invariants.test.ts'],
    expected: `invariant \`${NEW_INVARIANT}\` has no property test that runs`,
    apply: async (appRoot) => {
      await addInvariant(appRoot);
      await append(
        join(appRoot, 'core/tests/account-invariants.test.ts'),
        `// invariant('${NEW_INVARIANT}', history, () => true);`,
      );
    },
  },
  {
    name: 'domain: an invariant whose property is skipped',
    files: ['core/tests/account-invariants.test.ts'],
    expected: 'the property for invariant `balance-never-negative` is skipped',
    apply: async (appRoot) => {
      const path = join(appRoot, 'core/tests/account-invariants.test.ts');
      await edit(path, "invariant('balance-never-negative',", "describe.skip('paused', () => invariant('balance-never-negative',");
      await edit(path, 'after.balance >= 0),\n);', 'after.balance >= 0),\n));');
      await writeFile(path, `import { describe } from 'bun:test';\n${await readFile(path, 'utf8')}`);
    },
  },
  state === 'event-sourcing'
    ? {
        name: 'concurrency: the event log yields between its version check and its write',
        files: ['packages/store/event-sourcing.ts'],
        expected: '(fail) in-memory event log contract > lets exactly one of two concurrent',
        apply: (appRoot) =>
          edit(
            join(appRoot, 'packages/store/event-sourcing.ts'),
            'const current = streams.get(streamId) ?? emptyStream;',
            'const current = await read(streamId);',
          ),
      }
    : {
        name: 'concurrency: the record store yields between its version check and its write',
        files: ['packages/store/crud.ts'],
        expected: '(fail) in-memory record store contract > lets exactly one of two concurrent',
        apply: (appRoot) =>
          edit(join(appRoot, 'packages/store/crud.ts'), 'const current = records.get(id);', 'const current = await read(id);'),
      },
  ...(state === 'event-sourcing'
    ? [
        {
          name: 'concurrency: the gate appends before the core checks the new state',
          files: ['packages/gate/event-sourcing.ts'],
          expected: '(fail) event-sourced gate > appends nothing when projecting the decision fails an assertion',
          apply: async (appRoot: string) => {
            const path = join(appRoot, 'packages/gate/event-sourcing.ts');
            await edit(path, '    const next = project(state, decision.events);\n', '');
            await edit(path, 'state: next,', 'state: project(state, decision.events),');
          },
        },
      ]
    : []),
];

const proveBreakageFails = async (appRoot: string, breakage: Breakage): Promise<void> => {
  const originals = await Promise.all(
    breakage.files.map(async (file) => [file, await readFile(join(appRoot, file), 'utf8')] as const),
  );
  try {
    await breakage.apply(appRoot);
    const result = await run(['bun', 'verify'], appRoot);
    check(result.exitCode !== 0, `bun verify passed despite ${breakage.name}`, result.output);
    check(
      result.output.includes(breakage.expected),
      `bun verify failed for another reason than ${breakage.name}. Expected: ${breakage.expected}`,
      result.output,
    );
  } finally {
    for (const [file, content] of originals) await writeFile(join(appRoot, file), content);
  }
};

const synthEnvironments = async (appRoot: string): Promise<void> => {
  const outdir = await mkdtemp(join(tmpdir(), 'arca-synth-'));
  for (const environment of ['pr-1', 'pr-2']) {
    await mustPass(`Synthesising ${environment}`, ['bun', 'app.ts'], join(appRoot, 'infra'), {
      CDK_OUTDIR: join(outdir, environment),
      CDK_DEFAULT_ACCOUNT: '123456789012',
      CDK_DEFAULT_REGION: 'eu-west-1',
      CONFIG_ENVIRONMENT: 'test',
      DELETION_PROTECTION: 'false',
      ENVIRONMENT_NAME: environment,
    });
    const template = join(outdir, environment, `${NAME}-${environment}.template.json`);
    check(existsSync(template), `ENVIRONMENT_NAME=${environment} did not synthesise the stack ${NAME}-${environment}`);
    check(
      (await readFile(template, 'utf8')).includes(`${NAME}-${environment}-state`),
      `The ${environment} stack does not name its table after the environment`,
    );
  }
  await rm(outdir, { recursive: true, force: true });
};

const step = async (label: string, work: () => Promise<void>): Promise<void> => {
  const started = performance.now();
  await work();
  console.info(`  ok ${label} (${((performance.now() - started) / 1000).toFixed(1)}s)`);
};

const testProfile = async (profile: ProfileCase): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), `arca-${profile.id}-`));
  try {
    await testProfileIn(root, profile);
  } catch (error: unknown) {
    if (error instanceof CheckFailed) console.error(`  kept ${root} for inspection`);
    throw error;
  }
  return root;
};

const testProfileIn = async (root: string, profile: ProfileCase): Promise<void> => {
  const appRoot = profile.appDir === undefined ? root : join(root, profile.appDir);
  const config: Profile = { name: NAME, title: NAME, owner: OWNER, state: profile.state, appDir: profile.appDir };
  await mustPass('git init', ['git', 'init', '--quiet'], root);

  await step('bootstrap refuses to overwrite', async () => {
    if (profile.appDir === undefined) {
      await writeFile(join(root, 'notes.txt'), 'keep me\n');
      const refused = await run(bootstrapArgs(root, profile), root);
      check(refused.exitCode !== 0 && refused.output.includes('notes.txt'), 'Bootstrap wrote into a directory that held files', refused.output);
      await rm(join(root, 'notes.txt'));
      return;
    }
    await seedLegacyRepository(root);
    const refused = await run(bootstrapArgs(root, profile), root);
    check(refused.exitCode !== 0 && refused.output.includes('.github/CODEOWNERS'), 'Bootstrap did not stop at the existing CODEOWNERS', refused.output);
    check(!existsSync(appRoot), 'Bootstrap wrote files before it stopped');
  });

  await step('bootstrap', async () => {
    const args = [...bootstrapArgs(root, profile), ...(profile.appDir === undefined ? [] : ['--skip-existing'])];
    await mustPass('Bootstrap', args, root);
    await checkRendered(root, appRoot, profile);
    await checkAutomation(root, profile);
  });

  await step('fresh copy installs and verifies', async () => {
    await mustPass('bun install', ['bun', 'install'], appRoot);
    await mustPass('bun verify', ['bun', 'verify'], appRoot);
  });

  await step('the wren hooks module passes its tests in Claude Code', async () => {
    if (Bun.which('claude') === null) {
      console.info('  skipped: claude is not on PATH, so `claude plugin test` cannot run');
      return;
    }
    await mustPass('bun run test:mod', ['bun', 'run', 'test:mod'], join(appRoot, 'tools/wren'));
  });

  await step('account example verifies and kills its mutants', async () => {
    await applyExample('account', appRoot, config);
    await mustPass('bun install', ['bun', 'install'], appRoot);
    await mustPass('bun verify', ['bun', 'verify'], appRoot);
    await mustPass('bun mutation', ['bun', 'mutation'], appRoot);
  });

  await step('each environment synthesises its own stack', () => synthEnvironments(appRoot));

  for (const breakage of breakagesFor(profile.state)) {
    await step(`fails: ${breakage.name}`, () => proveBreakageFails(appRoot, breakage));
  }

  await step('restored project verifies again', async () => {
    await mustPass('bun verify', ['bun', 'verify'], appRoot);
  });
};

const selected = PROFILES.filter((profile) => options.profile === undefined || profile.id === options.profile);
if (selected.length === 0) {
  console.error(`No profile named ${options.profile}. Choose one of ${PROFILES.map(({ id }) => id).join(', ')}.`);
  process.exit(1);
}

const failures: string[] = [];
for (const profile of selected) {
  console.info(profile.id);
  const root = await testProfile(profile).then(
    async (directory) => {
      if (!options.keep) await rm(directory, { recursive: true, force: true });
      return directory;
    },
    (error: unknown) => {
      if (!(error instanceof CheckFailed)) throw error;
      console.error(`  FAILED ${error.message}`);
      failures.push(profile.id);
      return undefined;
    },
  );
  if (options.keep && root !== undefined) console.info(`  kept ${root}`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} of ${selected.length} profiles failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.info(`\nAll ${selected.length} profiles pass.`);
