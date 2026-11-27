import { expect, test } from 'bun:test';
import type { Same } from '../index.ts';

type Command =
  | { readonly type: 'open_account' }
  | { readonly type: 'close_account'; readonly reason: string };

// The type check proves each annotation. The assertion keeps the values in use.
test('Same holds only when both types accept the same values', () => {
  const equal: Same<
    Command,
    { type: 'open_account' } | { type: 'close_account'; reason: string }
  > = true;
  const missingMember: Same<{ type: 'open_account' }, Command> = false;
  const extraMember: Same<Command | { type: 'freeze_account' }, Command> =
    false;

  expect([equal, missingMember, extraMember]).toEqual([true, false, false]);
});
