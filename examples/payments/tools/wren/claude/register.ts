import type { EngineInterface, HookFailure, Register } from 'claude-code';
import { commandPermission } from '../permissions/command-permission.ts';
import {
  type Checkout,
  commandRefusal,
  pathRefusal,
} from '../worktree/guard.ts';

// Claude Code's native worktrees do the isolation. This module makes it compulsory and starts each one from a fresh origin/main.

/** Path tools that other Claude Code builds have, with the input field that holds the path. */
const OPTIONAL_PATH_TOOLS: Readonly<Record<string, string>> = {
  MultiEdit: 'file_path',
};

const GIT_TIMEOUT_MS = 60_000;

type GitResult = {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
};

/** A directory outside any Git repository has nothing to isolate. */
type Located = Checkout | 'outside-git';

/** The checkout of a directory never changes, so each is read once per module load. */
const checkouts = new Map<string, Promise<Located>>();

const git = (
  $: EngineInterface,
  cwd: string,
  arguments_: readonly string[],
): Promise<GitResult> =>
  $.process.run(['git', '-C', cwd, ...arguments_], {
    timeoutMs: GIT_TIMEOUT_MS,
  });

const detail = (result: GitResult, fallback: string): string =>
  result.stderr.trim() === '' ? fallback : result.stderr.trim();

const readCheckout = async (
  $: EngineInterface,
  cwd: string,
): Promise<Located> => {
  const toplevel = await git($, cwd, ['rev-parse', '--show-toplevel']);
  if (toplevel.exitCode !== 0) {
    if (toplevel.stderr.includes('not a git repository')) return 'outside-git';
    throw new Error(detail(toplevel, 'git rev-parse failed'));
  }
  const listed = await git($, cwd, ['worktree', 'list', '--porcelain']);
  const primaryRoot = /^worktree (?<path>.+)$/mu.exec(listed.stdout)?.groups
    ?.path;
  if (listed.exitCode !== 0 || primaryRoot === undefined) {
    throw new Error(detail(listed, 'git worktree list found no checkout'));
  }
  return { primaryRoot, root: toplevel.stdout.trim() };
};

const checkoutOf = ($: EngineInterface, cwd: string): Promise<Located> => {
  const cached = checkouts.get(cwd);
  if (cached !== undefined) return cached;
  const reading = readCheckout($, cwd);
  checkouts.set(cwd, reading);
  // A failure is not kept, so the next call reads the checkout again.
  reading.catch(() => checkouts.delete(cwd));
  return reading;
};

/** The directory a call runs in: a subagent's own, such as its worktree, else the session's. */
async function callDirectory(
  $: EngineInterface,
  agentId: string | undefined,
): Promise<string> {
  const agent =
    agentId === undefined
      ? undefined
      : (await $.agent.list()).find((candidate) => candidate.id === agentId);
  return agent?.cwd ?? (await $.session.cwd());
}

async function refusePath(
  $: EngineInterface,
  agentId: string | undefined,
  path: string,
): Promise<string | undefined> {
  const cwd = await callDirectory($, agentId);
  const checkout = await checkoutOf($, cwd);
  return checkout === 'outside-git'
    ? undefined
    : pathRefusal(path, cwd, checkout);
}

async function refuseCommand(
  $: EngineInterface,
  agentId: string | undefined,
  command: string,
): Promise<string | undefined> {
  const checkout = await checkoutOf($, await callDirectory($, agentId));
  return checkout === 'outside-git'
    ? undefined
    : commandRefusal(command, checkout);
}

/** The reason to refuse a destructive or AWS-changing command, or `undefined` when it may run. */
async function refuseUnsafeCommand(
  $: EngineInterface,
  command: string,
): Promise<string | undefined> {
  const permission = commandPermission(command);
  if (permission === undefined) return undefined;
  if (permission.action === 'deny') return permission.reason;
  // A run with no one to ask refuses, because the alternative runs the command unconfirmed.
  if ((await $.session.surface()) === null) {
    return `${permission.reason} No interactive UI is available.`;
  }
  const answer = await $.ui
    .ask(`${permission.reason} Allow \`${command}\`?`, {
      header: 'wren',
      options: ['Allow', 'Deny'],
    })
    .catch((error: unknown) =>
      error instanceof Error ? error : new Error('no answer'),
    );
  if (answer instanceof Error) {
    return `${permission.reason} The confirmation got no answer: ${answer.message}`;
  }
  return answer === 'Allow' ? undefined : 'The user declined this command.';
}

const hookFailureDetail = (failure: HookFailure): string =>
  failure.kind === 'timeout'
    ? 'it ran out of time'
    : (failure.message ?? 'it threw');

/**
 * Fetches origin/main before Claude Code creates a worktree. Its own fetch is
 * skipped when the last one is under a day old and falls back to a stale ref
 * when it fails, so a worktree could otherwise start from old code.
 */
async function refreshOriginMain(
  $: EngineInterface,
): Promise<string | undefined> {
  const cwd = await $.session.cwd();
  const fetched = await git($, cwd, ['fetch', 'origin', 'main']);
  if (fetched.exitCode !== 0) {
    return `wren starts every worktree from a fresh origin/main, and the fetch failed: ${detail(fetched, 'git fetch failed')}. Report this to the user and stop.`;
  }
  // A repository that was not cloned has no origin/HEAD, so Claude Code would branch from the local HEAD.
  const head = await git($, cwd, [
    'symbolic-ref',
    '--quiet',
    'refs/remotes/origin/HEAD',
  ]);
  if (head.exitCode !== 0) {
    const set = await git($, cwd, ['remote', 'set-head', 'origin', 'main']);
    if (set.exitCode !== 0) {
      return `wren could not point origin/HEAD at origin/main: ${detail(set, 'git remote set-head failed')}. Report this to the user and stop.`;
    }
  }
  await ignoreWorktrees($, cwd).catch((error: unknown) =>
    $.ui.log(
      `wren could not add ${WORKTREE_PATTERN} to .git/info/exclude: ${error instanceof Error ? error.message : 'unknown error'}`,
    ),
  );
  return undefined;
}

const WORKTREE_PATTERN = '/.claude/worktrees/';

/** Claude Code does not ignore its worktrees, and a migration's `.gitignore` sits below the repository root, so the clone's own exclude file does it. */
async function ignoreWorktrees($: EngineInterface, cwd: string): Promise<void> {
  const common = await git($, cwd, [
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ]);
  if (common.exitCode !== 0)
    throw new Error(detail(common, 'git rev-parse failed'));
  const path = `${common.stdout.trim()}/info/exclude`;
  const current = await $.fs.read(path).catch(() => '');
  if (current.split('\n').includes(WORKTREE_PATTERN)) return;
  const separator = current === '' || current.endsWith('\n') ? '' : '\n';
  await $.fs.write(path, `${current}${separator}${WORKTREE_PATTERN}\n`);
}

export const register: Register = (on) => {
  on('tool.call', { tool: 'EnterWorktree' }, async ($, e, next) => {
    if (e.path !== undefined) return next(e);
    const refusal = await refreshOriginMain($);
    return refusal === undefined ? next(e) : { deny: refusal };
  }).catch((_$, e, next) =>
    next.called
      ? next(e)
      : {
          deny: `wren could not refresh origin/main, so the worktree is refused: ${hookFailureDetail(next.error)}`,
        },
  );

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const refusal =
      (await refuseCommand($, e.agentId, e.command)) ??
      (await refuseUnsafeCommand($, e.command));
    return refusal === undefined ? next(e) : { deny: refusal };
  }).catch((_$, e, next) =>
    next.called
      ? next(e)
      : {
          deny: `wren could not check this command, so it is refused: ${hookFailureDetail(next.error)}`,
        },
  );

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const refusal = await refusePath($, e.agentId, e.file_path);
    return refusal === undefined ? next(e) : { deny: refusal };
  }).catch((_$, e, next) =>
    next.called
      ? next(e)
      : {
          deny: `wren could not check this edit, so it is refused: ${hookFailureDetail(next.error)}`,
        },
  );

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const refusal = await refusePath($, e.agentId, e.file_path);
    return refusal === undefined ? next(e) : { deny: refusal };
  }).catch((_$, e, next) =>
    next.called
      ? next(e)
      : {
          deny: `wren could not check this write, so it is refused: ${hookFailureDetail(next.error)}`,
        },
  );

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const refusal = await refusePath($, e.agentId, e.notebook_path);
    return refusal === undefined ? next(e) : { deny: refusal };
  }).catch((_$, e, next) =>
    next.called
      ? next(e)
      : {
          deny: `wren could not check this edit, so it is refused: ${hookFailureDetail(next.error)}`,
        },
  );

  on('tool.call', async ($, e, next) => {
    const field = OPTIONAL_PATH_TOOLS[String(e.tool)];
    if (field === undefined) return next(e);
    const input: Record<string, unknown> = { ...e };
    const path = input[field];
    if (typeof path !== 'string') return next(e);
    const refusal = await refusePath($, e.agentId, path);
    return refusal === undefined ? next(e) : { deny: refusal };
  }).catch((_$, e, next) =>
    next.called
      ? next(e)
      : {
          deny: `wren could not check this call, so it is refused: ${hookFailureDetail(next.error)}`,
        },
  );
};
