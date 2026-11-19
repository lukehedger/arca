import { assert, unreachable } from './assert.ts';
// if: event-sourcing
import type {
  CommandName,
  EventName,
  InvariantName,
  StatusName,
} from './vocabulary.ts';
// if: crud
import type { CommandName, InvariantName, StatusName } from './vocabulary.ts';
// end

type Command<
  Name extends CommandName,
  Fields = Record<never, never>,
> = Readonly<{ type: Name } & Fields>;

type Status<Name extends StatusName, Fields> = Readonly<
  { status: Name } & Fields
>;

// Amounts are whole minor units, such as pence, so no rounding can move money.
export type AccountCommand =
  | Command<'open_account'>
  | Command<'deposit_funds', { amount: number }>
  | Command<'withdraw_funds', { amount: number }>
  | Command<'close_account'>;

export type Account =
  | Status<'open', { balance: number }>
  | Status<'closed', { balance: 0 }>;

// Undefined until open_account creates the account.
export type AccountState = Account | undefined;

export type AccountRejection = { readonly invariant: InvariantName };

const assertAmount = (command: AccountCommand): void => {
  if (command.type !== 'deposit_funds' && command.type !== 'withdraw_funds') {
    return;
  }
  assert(
    Number.isSafeInteger(command.amount) && command.amount > 0,
    'Amount is not a positive whole number of minor units',
  );
};

const openWith = (balance: number): Account => {
  assert(balance >= 0, 'Balance is negative');
  return { status: 'open', balance };
};

const closed = (account: Account): Account => {
  assert(account.balance === 0, 'Closed an account that still holds funds');
  return { status: 'closed', balance: 0 };
};

// if: event-sourcing
type Event<Name extends EventName, Fields = Record<never, never>> = Readonly<
  { type: Name } & Fields
>;

export type AccountEvent =
  | Event<'account_opened'>
  | Event<'funds_deposited', { amount: number }>
  | Event<'funds_withdrawn', { amount: number }>
  | Event<'account_closed'>;

export type AccountDecision =
  | {
      readonly outcome: 'approved';
      readonly events: readonly [AccountEvent, ...AccountEvent[]];
    }
  | { readonly outcome: 'rejected'; readonly rejection: AccountRejection };

export const initialState: AccountState = undefined;

const approve = (event: AccountEvent): AccountDecision => ({
  outcome: 'approved',
  events: [event],
});

const reject = (invariant: InvariantName): AccountDecision => ({
  outcome: 'rejected',
  rejection: { invariant },
});

export const decide = (
  state: AccountState,
  command: AccountCommand,
): AccountDecision => {
  assertAmount(command);
  if (state === undefined) {
    return command.type === 'open_account'
      ? approve({ type: 'account_opened' })
      : reject('account-opens-first');
  }
  if (state.status === 'closed') return reject('closed-account-is-final');

  switch (command.type) {
    case 'open_account':
      return reject('account-opens-first');
    case 'deposit_funds':
      return approve({ type: 'funds_deposited', amount: command.amount });
    case 'withdraw_funds':
      return command.amount > state.balance
        ? reject('balance-never-negative')
        : approve({ type: 'funds_withdrawn', amount: command.amount });
    case 'close_account':
      return state.balance === 0
        ? approve({ type: 'account_closed' })
        : reject('closed-account-is-empty');
    default:
      return unreachable(command, 'Unhandled account command');
  }
};

// The decider rules these cases out, so each assertion fires only on a corrupt stream or a broken decider.
export const evolve = (
  state: AccountState,
  event: AccountEvent,
): AccountState => {
  if (state === undefined) {
    assert(
      event.type === 'account_opened',
      'An account event arrived before the account was opened',
    );
    return openWith(0);
  }
  assert(state.status === 'open', 'An event arrived after the account closed');
  assert(event.type !== 'account_opened', 'The account was opened twice');

  switch (event.type) {
    case 'funds_deposited':
      return openWith(state.balance + event.amount);
    case 'funds_withdrawn':
      return openWith(state.balance - event.amount);
    case 'account_closed':
      return closed(state);
    default:
      return unreachable(event, 'Unhandled account event');
  }
};
// if: crud
export type AccountTransition =
  | { readonly outcome: 'approved'; readonly state: Account }
  | { readonly outcome: 'rejected'; readonly rejection: AccountRejection };

const approve = (state: Account): AccountTransition => ({
  outcome: 'approved',
  state,
});

const reject = (invariant: InvariantName): AccountTransition => ({
  outcome: 'rejected',
  rejection: { invariant },
});

export const decide = (
  current: AccountState,
  command: AccountCommand,
): AccountTransition => {
  assertAmount(command);
  if (current === undefined) {
    return command.type === 'open_account'
      ? approve(openWith(0))
      : reject('account-opens-first');
  }
  if (current.status === 'closed') return reject('closed-account-is-final');

  switch (command.type) {
    case 'open_account':
      return reject('account-opens-first');
    case 'deposit_funds':
      return approve(openWith(current.balance + command.amount));
    case 'withdraw_funds':
      return command.amount > current.balance
        ? reject('balance-never-negative')
        : approve(openWith(current.balance - command.amount));
    case 'close_account':
      return current.balance === 0
        ? approve(closed(current))
        : reject('closed-account-is-empty');
    default:
      return unreachable(command, 'Unhandled account command');
  }
};
// end
