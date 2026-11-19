import fc from 'fast-check';
// if: event-sourcing
import {
  type AccountCommand,
  type AccountState,
  decide,
  evolve,
  initialState,
} from '../index.ts';
// if: crud
import {
  type AccountCommand,
  type AccountState,
  decide,
} from '../index.ts';
// end

export type Step = {
  readonly before: AccountState;
  readonly command: AccountCommand;
  readonly approved: boolean;
  readonly after: AccountState;
};

const amount = fc.integer({ min: 1, max: 1_000 });

export const command: fc.Arbitrary<AccountCommand> = fc.oneof(
  fc.constant<AccountCommand>({ type: 'open_account' }),
  amount.map(
    (value): AccountCommand => ({ type: 'deposit_funds', amount: value }),
  ),
  amount.map(
    (value): AccountCommand => ({ type: 'withdraw_funds', amount: value }),
  ),
  fc.constant<AccountCommand>({ type: 'close_account' }),
);

// if: event-sourcing
const apply = (state: AccountState, next: AccountCommand): Step => {
  const decision = decide(state, next);
  const after =
    decision.outcome === 'approved'
      ? decision.events.reduce(evolve, state)
      : state;

  return {
    before: state,
    command: next,
    approved: decision.outcome === 'approved',
    after,
  };
};

const startState = initialState;
// if: crud
const apply = (state: AccountState, next: AccountCommand): Step => {
  const transition = decide(state, next);
  const after = transition.outcome === 'approved' ? transition.state : state;

  return {
    before: state,
    command: next,
    approved: transition.outcome === 'approved',
    after,
  };
};

const startState: AccountState = undefined;
// end

// Every step of a generated command history, each decided on the state the steps before it produced.
export const history: fc.Arbitrary<readonly Step[]> = fc
  .array(command, { maxLength: 40 })
  .map((commands) => {
    const steps: Step[] = [];
    for (const next of commands) {
      steps.push(apply(steps.at(-1)?.after ?? startState, next));
    }
    return steps;
  });
