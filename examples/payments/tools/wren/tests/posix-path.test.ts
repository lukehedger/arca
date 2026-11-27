import { describe, expect, test } from 'bun:test';
import { basename, dirname, join, resolve } from 'node:path';
import {
  basenamePath,
  dirnamePath,
  isAbsolutePath,
  joinPath,
  resolvePath,
} from '../worktree/posix-path.ts';

describe('POSIX paths for the Claude Code mod', () => {
  test.each([
    [['/repo']],
    [['/repo/', 'tools//wren/']],
    [['/repo/.worktrees/wren-1', '../../CLAUDE.md']],
    [['/repo', '../../../../etc/passwd']],
    [['/repo', '/elsewhere', './file.ts']],
    [['/repo/./tools/../tools/wren']],
  ])('resolves %p as node:path does', (paths) => {
    expect(resolvePath(...paths)).toBe(resolve(...paths));
  });

  test('refuses to resolve without an absolute path', () => {
    expect(() => resolvePath('tools', 'wren')).toThrow('no absolute path');
  });

  test.each([
    [['/repo', '.worktrees', 'wren-1']],
    [['/repo/', '/tools/', 'wren']],
    [['/repo/.worktrees/wren-1', 'src/../README.md']],
    [['/', '..']],
  ])('joins %p as node:path does', (paths) => {
    const [base = '/', ...rest] = paths;
    expect(joinPath(base, ...rest)).toBe(join(base, ...rest));
  });

  test('refuses to join onto a relative base', () => {
    expect(() => joinPath('repo', 'file')).toThrow('not an absolute path');
  });

  test.each([
    '/repo/.worktrees/wren-1',
    '/repo/.worktrees/wren-1/',
    '/repo',
    '/',
    'file.ts',
  ])('splits %p as node:path does', (path) => {
    expect(basenamePath(path)).toBe(basename(path));
    expect(dirnamePath(path)).toBe(dirname(path));
  });

  test('tells absolute paths apart', () => {
    expect(isAbsolutePath('/repo')).toBe(true);
    expect(isAbsolutePath('repo')).toBe(false);
  });
});
