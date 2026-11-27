import type { AgentInfo, On } from 'claude-code';
import { describe, expect, test } from 'claude-code/testing';

const PRIMARY = '/repo';
const WORKTREE = '/repo/.claude/worktrees/task';
const ENTER_WORKTREE =
  'wren makes every change in a worktree. Call EnterWorktree first, then repeat this call with paths inside the new worktree.';

type Git = {
  readonly fetchFails?: boolean;
  readonly hasOriginHead?: boolean;
};

const subagent = (id: string, cwd: string): AgentInfo => ({
  cwd,
  description: 'Run the checks',
  hasRow: true,
  id,
  kind: 'local_agent',
  label: 'Run the checks',
  startTime: 0,
  status: 'running',
  taskStatus: 'running',
  tokenCount: 0,
  tokenSamples: [],
  type: 'general-purpose',
});

const answerSession = (on: On, cwd: string, agents: AgentInfo[] = []): void => {
  on('session.cwd', () => ({ value: cwd }));
  on('agent.list', () => ({ value: agents }));
};

/** Answers the Git commands the module runs, as a repository with one linked worktree would, and records each one. */
const answerGit = (on: On, options: Git = {}): string[][] => {
  const calls: string[][] = [];
  on('process.run', (_$, e) => {
    const [, , cwd = '', ...arguments_] = e.argv;
    calls.push(arguments_);
    const answer = (exitCode: number, stdout = '', stderr = '') => ({
      value: {
        exitCode,
        isStderrTruncated: false,
        isStdoutTruncated: false,
        stderr,
        stdout,
      },
    });
    const command = arguments_.join(' ');
    if (cwd === '/tmp') return answer(128, '', 'fatal: not a git repository');
    if (command === 'rev-parse --show-toplevel') {
      return answer(0, cwd.startsWith(WORKTREE) ? WORKTREE : PRIMARY);
    }
    if (command === 'worktree list --porcelain') {
      return answer(0, `worktree ${PRIMARY}\nHEAD a\n\nworktree ${WORKTREE}\n`);
    }
    if (command === 'fetch origin main' && options.fetchFails === true) {
      return answer(1, '', 'fatal: unable to access origin');
    }
    if (command.startsWith('symbolic-ref') && options.hasOriginHead === false) {
      return answer(1);
    }
    if (command.endsWith('--git-common-dir'))
      return answer(0, `${PRIMARY}/.git\n`);
    return answer(0);
  });
  return calls;
};

/** The tools beneath the plugin, recording each call that reaches them. */
const answerTools = (on: On): string[] => {
  const reached: string[] = [];
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    reached.push(e.command);
    return { result: { interrupted: false, stderr: '', stdout: '' } };
  });
  on('tool.call', { tool: 'Write' }, (_$, e) => {
    reached.push(e.file_path);
    return { result: '' };
  });
  on('tool.call', { tool: 'EnterWorktree' }, () => {
    reached.push('EnterWorktree');
    return { result: { message: 'entered', worktreePath: WORKTREE } };
  });
  return reached;
};

describe('in the primary checkout', () => {
  test('refuses every shell command until the session enters a worktree', async ($, on) => {
    answerSession(on, PRIMARY);
    answerGit(on);
    const reached = answerTools(on);

    const result = await $.tool.call({ command: 'git status', tool: 'Bash' });

    expect(result.deny).toBe(ENTER_WORKTREE);
    expect(reached).toEqual([]);
  });

  test('refuses a write into the repository', async ($, on) => {
    answerSession(on, `${PRIMARY}/next`);
    answerGit(on);
    answerTools(on);

    const result = await $.tool.call({
      content: 'x',
      file_path: `${PRIMARY}/next/core/account.ts`,
      tool: 'Write',
    });

    expect(result.deny).toBe(ENTER_WORKTREE);
  });

  test('allows a write outside the repository', async ($, on) => {
    answerSession(on, PRIMARY);
    answerGit(on);
    const reached = answerTools(on);

    await $.tool.call({
      content: 'x',
      file_path: '/tmp/notes.md',
      tool: 'Write',
    });

    expect(reached).toEqual(['/tmp/notes.md']);
  });
});

describe('in a worktree', () => {
  test('allows commands and writes inside it', async ($, on) => {
    answerSession(on, WORKTREE);
    answerGit(on);
    const reached = answerTools(on);

    await $.tool.call({ command: 'bun verify', tool: 'Bash' });
    await $.tool.call({
      content: 'x',
      file_path: `${WORKTREE}/core/account.ts`,
      tool: 'Write',
    });

    expect(reached).toEqual(['bun verify', `${WORKTREE}/core/account.ts`]);
  });

  test('refuses a write into the primary checkout', async ($, on) => {
    answerSession(on, WORKTREE);
    answerGit(on);
    const reached = answerTools(on);

    const result = await $.tool.call({
      content: 'x',
      file_path: `${PRIMARY}/core/account.ts`,
      tool: 'Write',
    });

    expect(result.deny).toBe(
      `${PRIMARY}/core/account.ts is outside this session's worktree at ${WORKTREE}. Change the copy inside the worktree.`,
    );
    expect(reached).toEqual([]);
  });

  test('checks a subagent from its own directory', async ($, on) => {
    answerSession(on, PRIMARY, [subagent('agent-1', WORKTREE)]);
    answerGit(on);
    const reached = answerTools(on);

    await $.tool.call({
      agentId: 'agent-1',
      command: 'bun verify',
      tool: 'Bash',
    });

    expect(reached).toEqual(['bun verify']);
  });
});

describe('outside Git', () => {
  test('has nothing to isolate', async ($, on) => {
    answerSession(on, '/tmp');
    answerGit(on);
    const reached = answerTools(on);

    await $.tool.call({ command: 'ls', tool: 'Bash' });

    expect(reached).toEqual(['ls']);
  });
});

/** A clone's exclude file, recording what the module writes to it. */
const answerExclude = (on: On, current: string): string[] => {
  const written: string[] = [];
  on('fs.read', () => ({ value: current }));
  on('fs.write', (_$, e) => {
    written.push(e.text);
    return { value: undefined };
  });
  return written;
};

describe('EnterWorktree', () => {
  test('fetches origin/main before Claude Code creates the worktree', async ($, on) => {
    answerSession(on, PRIMARY);
    const calls = answerGit(on, { hasOriginHead: false });
    answerExclude(on, '');
    const reached = answerTools(on);

    await $.tool.call({ tool: 'EnterWorktree' });

    expect(calls.slice(0, 3)).toEqual([
      ['fetch', 'origin', 'main'],
      ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'],
      ['remote', 'set-head', 'origin', 'main'],
    ]);
    expect(reached).toEqual(['EnterWorktree']);
  });

  test('ignores the worktrees in the clone', async ($, on) => {
    answerSession(on, PRIMARY);
    answerGit(on);
    const written = answerExclude(on, '*.log');
    answerTools(on);

    await $.tool.call({ tool: 'EnterWorktree' });

    expect(written).toEqual(['*.log\n/.claude/worktrees/\n']);
  });

  test('leaves an exclude file that already ignores them', async ($, on) => {
    answerSession(on, PRIMARY);
    answerGit(on);
    const written = answerExclude(on, '/.claude/worktrees/\n');
    answerTools(on);

    await $.tool.call({ tool: 'EnterWorktree' });

    expect(written).toEqual([]);
  });

  test('refuses the worktree when the fetch fails', async ($, on) => {
    answerSession(on, PRIMARY);
    answerGit(on, { fetchFails: true });
    const reached = answerTools(on);

    const result = await $.tool.call({ tool: 'EnterWorktree' });

    expect(result.deny).toBe(
      'wren starts every worktree from a fresh origin/main, and the fetch failed: fatal: unable to access origin. Report this to the user and stop.',
    );
    expect(reached).toEqual([]);
  });

  test('switches to an existing worktree without a fetch', async ($, on) => {
    answerSession(on, PRIMARY);
    const calls = answerGit(on);
    answerTools(on);

    await $.tool.call({ path: WORKTREE, tool: 'EnterWorktree' });

    expect(calls).toEqual([]);
  });
});

/** The person's answer to wren's confirmation, recording each question wren asks. */
const answerConfirmation = (on: On, answer: 'Allow' | 'Deny'): string[] => {
  const asked: string[] = [];
  on('session.surface', () => ({ value: 'terminal' }));
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const question = e.questions[0]?.question ?? '';
    asked.push(question);
    return {
      result: { answers: { [question]: answer }, questions: e.questions },
    };
  });
  return asked;
};

describe('the shell command guard', () => {
  for (const [command, reason] of [
    ['git reset --hard HEAD~1', '`git reset --hard` is blocked.'],
    ['git push --force origin main', 'Force pushes are blocked.'],
    [
      'rm -rf ~',
      'Recursive forced removal of a root, home, or parent directory is blocked.',
    ],
    [
      'aws s3 rm s3://bucket/report.csv',
      'wren may only run read-only AWS operations. Follow the aws skill and propose any change for the user to apply.',
    ],
    [
      'aws dynamodb scan --table-name accounts',
      'wren may only run read-only AWS operations. Follow the aws skill and propose any change for the user to apply.',
    ],
  ] as const) {
    test(`refuses ${command}`, async ($, on) => {
      answerSession(on, WORKTREE);
      answerGit(on);
      const reached = answerTools(on);

      const result = await $.tool.call({ command, tool: 'Bash' });

      expect(result.deny).toBe(reason);
      expect(reached).toEqual([]);
    });
  }

  test('refuses a command that needs confirmation when nobody can answer', async ($, on) => {
    answerSession(on, WORKTREE);
    answerGit(on);
    on('session.surface', () => ({ value: null }));
    const reached = answerTools(on);

    const result = await $.tool.call({ command: 'rm -r build', tool: 'Bash' });

    expect(result.deny).toBe(
      'Recursive file removal requires confirmation. No interactive UI is available.',
    );
    expect(reached).toEqual([]);
  });

  test('runs a command the user allows', async ($, on) => {
    answerSession(on, WORKTREE);
    answerGit(on);
    const asked = answerConfirmation(on, 'Allow');
    const reached = answerTools(on);

    await $.tool.call({ command: 'rm -r build', tool: 'Bash' });

    expect(asked).toEqual([
      'Recursive file removal requires confirmation. Allow `rm -r build`?',
    ]);
    expect(reached).toEqual(['rm -r build']);
  });

  test('refuses a command the user declines', async ($, on) => {
    answerSession(on, WORKTREE);
    answerGit(on);
    answerConfirmation(on, 'Deny');
    const reached = answerTools(on);

    const result = await $.tool.call({ command: 'rm -r build', tool: 'Bash' });

    expect(result.deny).toBe('The user declined this command.');
    expect(reached).toEqual([]);
  });

  test('refuses outside a worktree before it asks', async ($, on) => {
    answerSession(on, PRIMARY);
    answerGit(on);
    const asked = answerConfirmation(on, 'Allow');

    const result = await $.tool.call({ command: 'rm -r build', tool: 'Bash' });

    expect(result.deny).toBe(ENTER_WORKTREE);
    expect(asked).toEqual([]);
  });
});
