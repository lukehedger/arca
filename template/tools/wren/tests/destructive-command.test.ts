import { describe, expect, test } from 'bun:test';
import { classifyCommandPermission } from '../permissions/destructive-command.ts';

describe('classifyCommandPermission', () => {
  test.each([
    'rm -rf build',
    'rm -fr build',
    'rm --recursive build',
    'echo done && rm -r build',
    '/bin/rm -r build',
  ])('asks before recursive removal: %s', (command) => {
    expect(classifyCommandPermission(command)?.action).toBe('ask');
  });

  test.each([
    'rm -rf /',
    'rm -fr ~',
    'rm --recursive --force $HOME',
    'rm -Rf /',
    'rm -rf ~/',
    'rm -rf $HOME/',
    'rm -rf $' + '{HOME}/',
    'rm -rf ./..',
    'sudo rm -rf ../..',
    'command rm -rf /',
    '(rm -rf /)',
    "sh -c 'rm -rf /'",
    "bash -lc 'rm -rf /'",
    "sh -c -- 'rm -rf /'",
    'sudo -u root rm -rf /',
  ])('denies catastrophic removal: %s', (command) => {
    expect(classifyCommandPermission(command)?.action).toBe('deny');
  });

  test.each([
    'git reset --hard HEAD~1',
    'git re\\\nset --hard HEAD~1',
    'git -C /tmp/repo reset --hard HEAD~1',
    "sh -c 'git -C /tmp/repo reset --hard HEAD~1'",
    'git clean -fdx',
    'git push --force-with-lease origin branch',
    'git push -f origin branch',
    'git push origin +HEAD:main',
    "git push origin '+HEAD:main'",
    'git branch -D old-branch',
  ])('denies destructive git operation: %s', (command) => {
    expect(classifyCommandPermission(command)?.action).toBe('deny');
  });

  test.each([
    'sudo apt update',
    '/usr/bin/sudo apt update',
    'env X=1 sudo apt update',
    'chmod 777 script.sh',
    'chmod 0777 script.sh',
    'chmod 00777 script.sh',
    'chown -R user directory',
  ])('asks before privileged operation: %s', (command) => {
    expect(classifyCommandPermission(command)?.action).toBe('ask');
  });

  test.each([
    'rm file.txt',
    'git reset --soft HEAD~1',
    'git clean -n',
    'git push origin branch',
    'git branch -d merged-branch',
    'git worktree list',
    'git worktree remove .worktrees/old',
    'git worktree prune',
    'git -C /repo worktree list',
    'git -C /repo worktree remove .worktrees/old',
    'git -C /repo worktree prune',
    'git switch -c wren/other origin/main',
    'echo "rm -rf build"',
  ])('allows ordinary operation: %s', (command) => {
    expect(classifyCommandPermission(command)).toBeUndefined();
  });
});
