import { describe, expect, test } from 'bun:test';
import {
  findUntestedInvariants,
  type PropertyResult,
  parsePropertyResults,
} from '../invariants.ts';

const junit = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="5">
  <testsuite name="tests/account.test.ts" file="tests/account.test.ts">
    <testcase name="invariant: balance-never-negative" classname="" assertions="1" />
    <testcase name="rejects a withdrawal over the balance" classname="decide" assertions="2" />
    <testsuite name="skipped block">
      <testcase name="invariant: closed-account-is-empty" classname="skipped block" assertions="0">
        <skipped />
      </testcase>
    </testsuite>
    <testcase name="invariant: account-opens-first" classname="" assertions="0">
      <skipped message="TODO" />
    </testcase>
    <testcase name="invariant: closed-account-is-final" classname="" assertions="0">
      <failure type="AssertionError" />
    </testcase>
  </testsuite>
</testsuites>`;

const result = (
  invariant: string,
  outcome: PropertyResult['outcome'],
  assertions = 1,
): PropertyResult => ({ invariant, outcome, assertions });

describe('parsePropertyResults', () => {
  test('reads the outcome of every property and ignores other tests', () => {
    expect(parsePropertyResults(junit)).toEqual([
      result('balance-never-negative', 'passed'),
      result('closed-account-is-empty', 'skipped', 0),
      result('account-opens-first', 'skipped', 0),
      result('closed-account-is-final', 'failed', 0),
    ]);
  });

  test('decodes XML entities in the test name', () => {
    expect(
      parsePropertyResults(
        '<testcase name="invariant: a&amp;b" assertions="1" />',
      ),
    ).toEqual([result('a&b', 'passed')]);
  });
});

describe('findUntestedInvariants', () => {
  test('passes an invariant whose property ran and passed', () => {
    expect(
      findUntestedInvariants(
        ['balance-never-negative'],
        [
          result('balance-never-negative', 'skipped'),
          result('balance-never-negative', 'passed'),
        ],
      ),
    ).toEqual([]);
  });

  test('reports an invariant with no property that ran', () => {
    expect(findUntestedInvariants(['balance-never-negative'], [])).toEqual([
      "Invariant coverage: invariant `balance-never-negative` has no property test that runs. Add `invariant('balance-never-negative', ...)` to a test in core/tests.",
    ]);
  });

  test.each([
    ['skipped', 1, 'is skipped'],
    ['failed', 1, 'fails'],
    ['passed', 0, 'checks nothing'],
  ] as const)(
    'reports a property that is %s with %d assertions',
    (outcome, assertions, expected) => {
      const [finding] = findUntestedInvariants(
        ['balance-never-negative'],
        [result('balance-never-negative', outcome, assertions)],
      );
      expect(finding).toContain(expected);
    },
  );
});
