import { describe, expect, test } from 'bun:test';
import { resolveEnvironment, toEnvironmentName } from '../environment.ts';

describe('toEnvironmentName', () => {
  test('turns a branch into lower-case words joined by single hyphens', () => {
    expect(toEnvironmentName('feat/PROJ-12_Order--Expiry', 30)).toBe(
      'feat-proj-12-order-expiry',
    );
  });

  test('keeps two long names that share a prefix apart', () => {
    const first = toEnvironmentName('feat/a-very-long-branch-name-one', 20);
    const second = toEnvironmentName('feat/a-very-long-branch-name-two', 20);

    expect(first).not.toBe(second);
    expect(first.length).toBeLessThanOrEqual(20);
    expect(second.length).toBeLessThanOrEqual(20);
  });

  test('rejects a name with no letters or digits', () => {
    expect(() => toEnvironmentName('///', 20)).toThrow('Cannot derive');
  });
});

describe('resolveEnvironment', () => {
  test('prefers ENVIRONMENT_NAME over the branch', () => {
    expect(
      resolveEnvironment({ explicit: 'pr-7', branch: 'feat/login' }, 20),
    ).toBe('pr-7');
  });

  test('falls back to the branch', () => {
    expect(
      resolveEnvironment({ explicit: undefined, branch: 'feat/login' }, 20),
    ).toBe('feat-login');
  });

  test.each(['prod', 'main', 'dev'])(
    'refuses the pipeline environment %s',
    (name) => {
      expect(() =>
        resolveEnvironment({ explicit: undefined, branch: name }, 20),
      ).toThrow('pipeline environment');
    },
  );

  test('refuses to run without a name', () => {
    expect(() =>
      resolveEnvironment({ explicit: undefined, branch: undefined }, 20),
    ).toThrow('Set ENVIRONMENT_NAME');
  });
});
