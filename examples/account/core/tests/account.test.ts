import { describe, expect, test } from 'bun:test';
// if: event-sourcing
import {
  type Account,
  type AccountEvent,
  AssertionError,
  decide,
  evolve,
} from '../src/index.ts';
// if: crud
import { type Account, AssertionError, decide } from '../src/index.ts';
// end

const open = (balance: number): Account => ({ status: 'open', balance });
const closedAccount: Account = { status: 'closed', balance: 0 };

describe('decide', () => {
  test.each([
    ['deposit_funds', 0],
    ['deposit_funds', -5],
    ['withdraw_funds', 1.5],
    ['withdraw_funds', Number.MAX_SAFE_INTEGER + 1],
  ] as const)(
    'asserts that a %s amount of %p is a positive whole number',
    (type, amount) => {
      const broken = () => decide(open(10), { type, amount });

      expect(broken).toThrow(AssertionError);
      expect(broken).toThrow(
        'Amount is not a positive whole number of minor units',
      );
    },
  );

  test.each([
    [undefined, { type: 'deposit_funds', amount: 1 }, 'account-opens-first'],
    [open(0), { type: 'open_account' }, 'account-opens-first'],
    [open(5), { type: 'withdraw_funds', amount: 6 }, 'balance-never-negative'],
    [open(5), { type: 'close_account' }, 'closed-account-is-empty'],
    [
      closedAccount,
      { type: 'deposit_funds', amount: 1 },
      'closed-account-is-final',
    ],
    [closedAccount, { type: 'open_account' }, 'closed-account-is-final'],
  ] as const)('rejects %p %p to protect %s', (state, command, invariant) => {
    expect(decide(state, command)).toEqual({
      outcome: 'rejected',
      rejection: { invariant },
    });
  });

  // if: event-sourcing
  test.each([
    [undefined, { type: 'open_account' }, { type: 'account_opened' }],
    [
      open(5),
      { type: 'deposit_funds', amount: 3 },
      { type: 'funds_deposited', amount: 3 },
    ],
    [
      open(5),
      { type: 'withdraw_funds', amount: 5 },
      { type: 'funds_withdrawn', amount: 5 },
    ],
    [open(0), { type: 'close_account' }, { type: 'account_closed' }],
  ] as const)('approves %p %p with %p', (state, command, event) => {
    expect(decide(state, command)).toEqual({
      outcome: 'approved',
      events: [event],
    });
  });
  // if: crud
  test.each([
    [undefined, { type: 'open_account' }, open(0)],
    [open(5), { type: 'deposit_funds', amount: 3 }, open(8)],
    [open(5), { type: 'withdraw_funds', amount: 5 }, open(0)],
    [open(0), { type: 'close_account' }, closedAccount],
  ] as const)('approves %p %p as %p', (state, command, next) => {
    expect(decide(state, command)).toEqual({
      outcome: 'approved',
      state: next,
    });
  });
  // end
});
// if: event-sourcing

describe('evolve', () => {
  test.each([
    [undefined, { type: 'account_opened' }, open(0)],
    [open(5), { type: 'funds_deposited', amount: 3 }, open(8)],
    [open(5), { type: 'funds_withdrawn', amount: 5 }, open(0)],
    [open(0), { type: 'account_closed' }, closedAccount],
  ] as const)('applies %p %p as %p', (state, event, next) => {
    expect(evolve(state, event)).toEqual(next);
  });

  test.each<[Account | undefined, AccountEvent, string]>([
    [
      undefined,
      { type: 'funds_deposited', amount: 1 },
      'An account event arrived before the account was opened',
    ],
    [
      closedAccount,
      { type: 'funds_deposited', amount: 1 },
      'An event arrived after the account closed',
    ],
    [open(0), { type: 'account_opened' }, 'The account was opened twice'],
    [open(5), { type: 'funds_withdrawn', amount: 6 }, 'Balance is negative'],
    [
      open(5),
      { type: 'account_closed' },
      'Closed an account that still holds funds',
    ],
  ])('asserts against %p %p', (state, event, message) => {
    const broken = () => evolve(state, event);

    expect(broken).toThrow(AssertionError);
    expect(broken).toThrow(message);
  });
});
// end
