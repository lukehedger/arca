import { expect, test } from 'bun:test';
import fc from 'fast-check';
import type { InvariantName } from '../src/index.ts';

// The test name carries the invariant. The fitness functions count it only when the property ran and passed.
export const invariant = <T>(
  name: InvariantName,
  arbitrary: fc.Arbitrary<T>,
  holds: (value: T) => boolean,
): void => {
  test(`invariant: ${name}`, () => {
    const details = fc.check(fc.property(arbitrary, holds));
    if (details.failed) throw new Error(fc.defaultReportMessage(details));

    expect(details.numRuns).toBeGreaterThan(0);
  });
};
