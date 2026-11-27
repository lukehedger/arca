import { describe, expect, test } from 'bun:test';
import {
  AWS_REFUSAL,
  commandPermission,
} from '../permissions/command-permission.ts';

describe('commandPermission', () => {
  test('refuses an AWS write', () => {
    expect(commandPermission('aws dynamodb scan --table-name table')).toEqual({
      action: 'deny',
      reason: AWS_REFUSAL,
    });
  });

  test('refuses an AWS write before it asks about a removal', () => {
    expect(
      commandPermission('rm -r build && aws s3 rm s3://bucket/key'),
    ).toEqual({ action: 'deny', reason: AWS_REFUSAL });
  });

  test('asks before a recursive removal', () => {
    expect(commandPermission('rm -r build')?.action).toBe('ask');
  });

  test('refuses a force push', () => {
    expect(commandPermission('git push -f origin feature')?.action).toBe(
      'deny',
    );
  });

  test.each(['aws sts get-caller-identity', 'bun verify', 'git status'])(
    'runs an ordinary command: %s',
    (command) => {
      expect(commandPermission(command)).toBeUndefined();
    },
  );
});
