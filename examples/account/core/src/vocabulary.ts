// Every name DOMAIN.md defines. The domain drift fitness function fails when the two disagree.
export const vocabulary = {
  commands: [
    'open_account',
    'deposit_funds',
    'withdraw_funds',
    'close_account',
  ],
  // if: event-sourcing
  events: [
    'account_opened',
    'funds_deposited',
    'funds_withdrawn',
    'account_closed',
  ],
  // if: crud
  events: [],
  // end
  statuses: ['open', 'closed'],
  invariants: [
    'account-opens-first',
    'balance-never-negative',
    'closed-account-is-empty',
    'closed-account-is-final',
  ],
} as const;

export type CommandName = (typeof vocabulary.commands)[number];
export type EventName = (typeof vocabulary.events)[number];
export type StatusName = (typeof vocabulary.statuses)[number];
export type InvariantName = (typeof vocabulary.invariants)[number];
