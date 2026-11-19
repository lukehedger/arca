import { describe, expect, test } from 'bun:test';
import {
  type Checkout,
  commandRefusal,
  ENTER_WORKTREE,
  pathRefusal,
} from '../worktree/guard.ts';

const PRIMARY: Checkout = { primaryRoot: '/repo', root: '/repo' };
const WORKTREE: Checkout = {
  primaryRoot: '/repo',
  root: '/repo/.claude/worktrees/task',
};
const OUTSIDE = `is outside this session's worktree at ${WORKTREE.root}`;

describe('pathRefusal', () => {
  test.each([
    ['refuses a repository file before the worktree', '/repo/core/account.ts', PRIMARY, '/repo', ENTER_WORKTREE],
    ['refuses a relative path before the worktree', 'core/account.ts', PRIMARY, '/repo/next', ENTER_WORKTREE],
    ['allows a scratch file before the worktree', '/tmp/scratch.md', PRIMARY, '/repo', undefined],
    ['allows a sibling directory with a similar name', '/repository/core/account.ts', PRIMARY, '/repo', undefined],
    ['allows a file in the worktree', `${WORKTREE.root}/core/account.ts`, WORKTREE, WORKTREE.root, undefined],
    ['allows a relative path in the worktree', 'core/account.ts', WORKTREE, `${WORKTREE.root}/next`, undefined],
    ['allows a scratch file from the worktree', '/tmp/scratch.md', WORKTREE, WORKTREE.root, undefined],
  ] as const)('%s', (_name, path, checkout, cwd, expected) => {
    expect(pathRefusal(path, cwd, checkout)).toBe(expected);
  });

  test.each([
    ['/repo/core/account.ts'],
    ['/repo/.claude/worktrees/other/core/account.ts'],
    ['../../../core/account.ts'],
  ])('refuses %s from a worktree, because it is another checkout', (path) => {
    expect(pathRefusal(path, WORKTREE.root, WORKTREE)).toContain(OUTSIDE);
  });
});

describe('commandRefusal', () => {
  test('needs a worktree for every command', () => {
    expect(commandRefusal('git status', PRIMARY)).toBe(ENTER_WORKTREE);
  });

  test.each([
    ['bun verify'],
    [`cat ${WORKTREE.root}/core/account.ts`],
    [`git -C "${WORKTREE.root}" status`],
    ['cat /repository/core/account.ts /tmp/repo/notes'],
  ])('allows %s in a worktree', (command) => {
    expect(commandRefusal(command, WORKTREE)).toBeUndefined();
  });

  test.each([
    ['cd /repo && bun verify'],
    ['sed -i s/a/b/ /repo/core/account.ts'],
    ['git -C "/repo" commit'],
    [`cp ${WORKTREE.root}/a /repo/b`],
  ])('refuses %s, because it reaches the primary checkout', (command) => {
    expect(commandRefusal(command, WORKTREE)).toContain('/repo ');
  });
});
