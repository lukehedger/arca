import fc from 'fast-check';
import {
  decide,
  evolve,
  initialState,
  type PaymentCommand,
  type PaymentState,
} from '../index.ts';

export type Step = {
  readonly before: PaymentState;
  readonly command: PaymentCommand;
  readonly approved: boolean;
  readonly after: PaymentState;
};

const amount = fc.integer({ min: 100, max: 1_000 });
// Smaller than an authorisation, so a history holds several captures and refunds before it reaches a limit.
const share = fc.integer({ min: 1, max: 400 });
// A small pool of ids, so histories reuse them and resolve the operations they requested.
const id = fc.constantFrom('a', 'b', 'c');

const weighted = (
  weight: number,
  arbitrary: fc.Arbitrary<PaymentCommand>,
): fc.WeightedArbitrary<PaymentCommand> => ({ weight, arbitrary });

export const command: fc.Arbitrary<PaymentCommand> = fc.oneof(
  weighted(
    1,
    amount.map((value) => ({
      type: 'request_authorisation',
      currency: 'GBP',
      amount: value,
    })),
  ),
  weighted(
    1,
    fc.constant({
      type: 'confirm_authorisation',
      providerReference: 'provider-1',
    }),
  ),
  weighted(1, fc.constant({ type: 'fail_authorisation' })),
  weighted(
    8,
    fc.tuple(id, share).map(([captureId, value]) => ({
      type: 'request_capture',
      captureId,
      amount: value,
    })),
  ),
  weighted(
    8,
    id.map((captureId) => ({ type: 'confirm_capture', captureId })),
  ),
  weighted(
    2,
    id.map((captureId) => ({ type: 'fail_capture', captureId })),
  ),
  weighted(
    8,
    fc.tuple(id, share).map(([refundId, value]) => ({
      type: 'request_refund',
      refundId,
      amount: value,
    })),
  ),
  weighted(
    8,
    id.map((refundId) => ({ type: 'confirm_refund', refundId })),
  ),
  weighted(
    2,
    id.map((refundId) => ({ type: 'fail_refund', refundId })),
  ),
  weighted(1, fc.constant({ type: 'request_void' })),
  weighted(2, fc.constant({ type: 'confirm_void' })),
  weighted(2, fc.constant({ type: 'fail_void' })),
);

const apply = (state: PaymentState, next: PaymentCommand): Step => {
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

const authorisation = (value: number): PaymentCommand => ({
  type: 'request_authorisation',
  currency: 'GBP',
  amount: value,
});

const confirmation: PaymentCommand = {
  type: 'confirm_authorisation',
  providerReference: 'provider-1',
};

// Most histories open with an approved authorisation, so the later steps reach every status.
const opening: fc.Arbitrary<readonly PaymentCommand[]> = fc.oneof(
  { weight: 1, arbitrary: fc.constant([]) },
  { weight: 1, arbitrary: amount.map((value) => [authorisation(value)]) },
  {
    weight: 6,
    arbitrary: amount.map((value) => [authorisation(value), confirmation]),
  },
);

const decideAll = (commands: readonly PaymentCommand[]): readonly Step[] => {
  const steps: Step[] = [];
  for (const next of commands) {
    steps.push(apply(steps.at(-1)?.after ?? initialState, next));
  }
  return steps;
};

// Every step of a generated command history, each decided on the state the steps before it produced.
export const history: fc.Arbitrary<readonly Step[]> = fc
  .tuple(opening, fc.array(command, { maxLength: 40, size: 'max' }))
  .map(([first, rest]) => decideAll([...first, ...rest]));
