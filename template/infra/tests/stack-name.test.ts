import { describe, expect, test } from 'bun:test';
import {
  MAX_STACK_NAME_LENGTH,
  PROJECT,
  stackNameFor,
} from '../stack-name.ts';

describe('stackNameFor', () => {
  test('prefixes the environment name with the project', () => {
    expect(stackNameFor('pr-42')).toBe(`${PROJECT}-pr-42`);
  });

  test.each(['', 'PR-42', 'feature/login', 'pr--42', '-pr', 'pr-'])(
    'rejects the environment name %p',
    (environment) => {
      expect(() => stackNameFor(environment)).toThrow('Environment name');
    },
  );

  test('rejects a stack name over the length limit', () => {
    expect(() => stackNameFor('a'.repeat(MAX_STACK_NAME_LENGTH))).toThrow(
      'longer than',
    );
  });
});
