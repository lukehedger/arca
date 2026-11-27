import { AssertionError, assert, unreachable } from './assert.ts';
import type {
  CommandName,
  EventName,
  InvariantName,
  StatusName,
} from './vocabulary.ts';

type Command<
  Name extends CommandName,
  Fields = Record<never, never>,
> = Readonly<{ type: Name } & Fields>;

type Event<Name extends EventName, Fields = Record<never, never>> = Readonly<
  { type: Name } & Fields
>;

type Status<Name extends StatusName, Fields> = Readonly<
  { status: Name } & Fields
>;

// Amounts are whole minor units, such as pence, so no rounding can move money.
type Authorisation = { currency: string; amount: number };
type Capture = { captureId: string };
type Refund = { refundId: string };
type Confirmation = { providerReference: string };

export type PaymentCommand =
  | Command<'request_authorisation', Authorisation>
  | Command<'confirm_authorisation', Confirmation>
  | Command<'fail_authorisation'>
  | Command<'request_capture', Capture & { amount: number }>
  | Command<'confirm_capture', Capture>
  | Command<'fail_capture', Capture>
  | Command<'request_refund', Refund & { amount: number }>
  | Command<'confirm_refund', Refund>
  | Command<'fail_refund', Refund>
  | Command<'request_void'>
  | Command<'confirm_void'>
  | Command<'fail_void'>;

// The commands a caller may send. Only the provider's answer confirms or fails one.
export type PaymentRequestCommand = Extract<
  PaymentCommand,
  { readonly type: `request_${string}` }
>;

export type PaymentEvent =
  | Event<'authorisation_requested', Authorisation>
  | Event<'authorisation_confirmed', Confirmation>
  | Event<'authorisation_failed'>
  | Event<'capture_requested', Capture & { amount: number }>
  | Event<'capture_confirmed', Capture>
  | Event<'capture_failed', Capture>
  | Event<'refund_requested', Refund & { amount: number }>
  | Event<'refund_confirmed', Refund>
  | Event<'refund_failed', Refund>
  | Event<'void_requested'>
  | Event<'void_confirmed'>
  | Event<'void_failed'>;

export type Operation = Readonly<{
  amount: number;
  status: 'pending' | 'confirmed' | 'failed';
}>;

// Keyed by capture id or refund id.
export type Operations = Readonly<Record<string, Operation>>;

export type Payment =
  | Status<'authorising', Authorisation>
  | Status<'declined', Authorisation>
  | Status<
      'authorised' | 'voiding' | 'voided',
      Authorisation &
        Confirmation & { captures: Operations; refunds: Operations }
    >;

// Undefined until request_authorisation creates the payment.
export type PaymentState = Payment | undefined;

export type PaymentRejection = { readonly invariant: InvariantName };

export type PaymentDecision =
  | {
      readonly outcome: 'approved';
      readonly events: readonly [PaymentEvent, ...PaymentEvent[]];
    }
  | { readonly outcome: 'rejected'; readonly rejection: PaymentRejection };

// The provider call each pending operation waits on, with what the call needs.
export type PendingOperation =
  | Readonly<{ type: 'authorisation' } & Authorisation>
  | Readonly<{ type: 'capture' } & Capture & Confirmation & { amount: number }>
  | Readonly<{ type: 'refund' } & Refund & Confirmation & { amount: number }>
  | Readonly<{ type: 'void' } & Confirmation>;

export const initialState: PaymentState = undefined;

type AuthorisingPayment = Extract<Payment, { readonly status: 'authorising' }>;
// A payment the provider authorised, whatever has happened to it since.
type AuthorisedPayment = Extract<Payment, Confirmation>;
type LaterCommand = Exclude<
  PaymentCommand,
  { readonly type: 'request_authorisation' }
>;
type LaterEvent = Exclude<
  PaymentEvent,
  { readonly type: 'authorisation_requested' }
>;

const CURRENCY = /^[A-Z]{3}$/;

const approve = (event: PaymentEvent): PaymentDecision => ({
  outcome: 'approved',
  events: [event],
});

const reject = (invariant: InvariantName): PaymentDecision => ({
  outcome: 'rejected',
  rejection: { invariant },
});

const operationIn = (
  operations: Operations,
  id: string,
): Operation | undefined =>
  Object.hasOwn(operations, id) ? operations[id] : undefined;

const isPending = (operations: Operations, id: string): boolean =>
  operationIn(operations, id)?.status === 'pending';

const hasPending = (operations: Operations): boolean =>
  Object.values(operations).some(({ status }) => status === 'pending');

const total = (
  operations: Operations,
  counts: (status: Operation['status']) => boolean,
): number =>
  Object.values(operations).reduce(
    (sum, { amount, status }) => (counts(status) ? sum + amount : sum),
    0,
  );

// A pending operation holds its amount until the provider answers.
const committed = (operations: Operations): number =>
  total(operations, (status) => status !== 'failed');

const confirmed = (operations: Operations): number =>
  total(operations, (status) => status === 'confirmed');

const assertCommand = (command: PaymentCommand): void => {
  if ('amount' in command) {
    assert(
      Number.isSafeInteger(command.amount) && command.amount > 0,
      'Amount is not a positive whole number of minor units',
    );
  }
  if ('currency' in command) {
    assert(CURRENCY.test(command.currency), 'Currency is not an ISO 4217 code');
  }
  if ('captureId' in command) {
    assert(command.captureId.length > 0, 'Capture id is empty');
  }
  if ('refundId' in command) {
    assert(command.refundId.length > 0, 'Refund id is empty');
  }
  if ('providerReference' in command) {
    assert(command.providerReference.length > 0, 'Provider reference is empty');
  }
};

export const decide = (
  state: PaymentState,
  command: PaymentCommand,
): PaymentDecision => {
  assertCommand(command);
  if (state === undefined) {
    return command.type === 'request_authorisation'
      ? approve({
          type: 'authorisation_requested',
          currency: command.currency,
          amount: command.amount,
        })
      : reject('payment-authorises-first');
  }
  if (state.status === 'declined') return reject('declined-payment-is-final');
  if (command.type === 'request_authorisation') {
    return reject('payment-authorises-first');
  }
  if (state.status === 'authorising') return decideAuthorisation(command);

  return decideOperation(state, command);
};

const decideAuthorisation = (command: LaterCommand): PaymentDecision => {
  switch (command.type) {
    case 'confirm_authorisation':
      return approve({
        type: 'authorisation_confirmed',
        providerReference: command.providerReference,
      });
    case 'fail_authorisation':
      return approve({ type: 'authorisation_failed' });
    case 'request_capture':
      return reject('captures-only-while-authorised');
    case 'request_refund':
      return reject('refunds-within-captures');
    case 'request_void':
      return reject('void-waits-for-captures');
    case 'confirm_capture':
    case 'fail_capture':
    case 'confirm_refund':
    case 'fail_refund':
    case 'confirm_void':
    case 'fail_void':
      return reject('operations-resolve-once');
    default:
      return unreachable(command, 'Unhandled payment command');
  }
};

const decideOperation = (
  payment: AuthorisedPayment,
  command: LaterCommand,
): PaymentDecision => {
  switch (command.type) {
    case 'confirm_authorisation':
    case 'fail_authorisation':
      return reject('operations-resolve-once');
    case 'request_capture':
      return requestCapture(payment, command);
    case 'confirm_capture':
      return resolveIfPending(payment.captures, command.captureId, {
        type: 'capture_confirmed',
        captureId: command.captureId,
      });
    case 'fail_capture':
      return resolveIfPending(payment.captures, command.captureId, {
        type: 'capture_failed',
        captureId: command.captureId,
      });
    case 'request_refund':
      return requestRefund(payment, command);
    case 'confirm_refund':
      return resolveIfPending(payment.refunds, command.refundId, {
        type: 'refund_confirmed',
        refundId: command.refundId,
      });
    case 'fail_refund':
      return resolveIfPending(payment.refunds, command.refundId, {
        type: 'refund_failed',
        refundId: command.refundId,
      });
    case 'request_void':
      return payment.status === 'authorised' && !hasPending(payment.captures)
        ? approve({ type: 'void_requested' })
        : reject('void-waits-for-captures');
    case 'confirm_void':
      return payment.status === 'voiding'
        ? approve({ type: 'void_confirmed' })
        : reject('operations-resolve-once');
    case 'fail_void':
      return payment.status === 'voiding'
        ? approve({ type: 'void_failed' })
        : reject('operations-resolve-once');
    default:
      return unreachable(command, 'Unhandled payment command');
  }
};

const requestCapture = (
  payment: AuthorisedPayment,
  command: Extract<PaymentCommand, { readonly type: 'request_capture' }>,
): PaymentDecision => {
  if (payment.status !== 'authorised') {
    return reject('captures-only-while-authorised');
  }
  if (Object.hasOwn(payment.captures, command.captureId)) {
    return reject('operation-ids-are-unique');
  }
  if (committed(payment.captures) + command.amount > payment.amount) {
    return reject('captures-within-authorisation');
  }

  return approve({
    type: 'capture_requested',
    captureId: command.captureId,
    amount: command.amount,
  });
};

const requestRefund = (
  payment: AuthorisedPayment,
  command: Extract<PaymentCommand, { readonly type: 'request_refund' }>,
): PaymentDecision => {
  if (Object.hasOwn(payment.refunds, command.refundId)) {
    return reject('operation-ids-are-unique');
  }
  if (
    committed(payment.refunds) + command.amount >
    confirmed(payment.captures)
  ) {
    return reject('refunds-within-captures');
  }

  return approve({
    type: 'refund_requested',
    refundId: command.refundId,
    amount: command.amount,
  });
};

const resolveIfPending = (
  operations: Operations,
  id: string,
  event: PaymentEvent,
): PaymentDecision =>
  isPending(operations, id)
    ? approve(event)
    : reject('operations-resolve-once');

const authorisedWith = (payment: AuthorisedPayment): AuthorisedPayment => {
  assert(
    committed(payment.captures) <= payment.amount,
    'Captures exceed the authorised amount',
  );
  assert(
    committed(payment.refunds) <= confirmed(payment.captures),
    'Refunds exceed the captured amount',
  );
  assert(
    payment.status === 'authorised' || !hasPending(payment.captures),
    'A capture is pending after the void was requested',
  );
  return payment;
};

const withOperation = (
  operations: Operations,
  id: string,
  amount: number,
): Operations => {
  assert(!Object.hasOwn(operations, id), 'An operation id was used twice');
  return { ...operations, [id]: { amount, status: 'pending' } };
};

const resolved = (
  operations: Operations,
  id: string,
  status: 'confirmed' | 'failed',
): Operations => {
  const operation = operationIn(operations, id);
  assert(
    operation?.status === 'pending',
    'An operation resolved that was not pending',
  );
  return { ...operations, [id]: { amount: operation.amount, status } };
};

export const pendingOperations = (
  payment: Payment,
): readonly PendingOperation[] => {
  switch (payment.status) {
    case 'authorising':
      return [
        {
          type: 'authorisation',
          currency: payment.currency,
          amount: payment.amount,
        },
      ];
    case 'declined':
      return [];
    case 'authorised':
    case 'voiding':
    case 'voided':
      return pendingAfterAuthorisation(payment);
    default:
      return unreachable(payment, 'Unhandled payment status');
  }
};

const pendingAfterAuthorisation = (
  payment: AuthorisedPayment,
): readonly PendingOperation[] => {
  const { providerReference } = payment;
  const captures = pendingIn(payment.captures).map(
    ([captureId, amount]): PendingOperation => ({
      type: 'capture',
      captureId,
      amount,
      providerReference,
    }),
  );
  const refunds = pendingIn(payment.refunds).map(
    ([refundId, amount]): PendingOperation => ({
      type: 'refund',
      refundId,
      amount,
      providerReference,
    }),
  );
  const voids: readonly PendingOperation[] =
    payment.status === 'voiding' ? [{ type: 'void', providerReference }] : [];

  return [...captures, ...refunds, ...voids];
};

const pendingIn = (
  operations: Operations,
): readonly (readonly [string, number])[] =>
  Object.entries(operations)
    .filter(([, { status }]) => status === 'pending')
    .map(([id, { amount }]) => [id, amount] as const);

// The decider rules these cases out, so each assertion fires only on a corrupt stream or a broken decider.
export const evolve = (
  state: PaymentState,
  event: PaymentEvent,
): PaymentState => {
  if (state === undefined) {
    assert(
      event.type === 'authorisation_requested',
      'A payment event arrived before the authorisation was requested',
    );
    return {
      status: 'authorising',
      currency: event.currency,
      amount: event.amount,
    };
  }
  assert(
    state.status !== 'declined',
    'An event arrived after the payment was declined',
  );
  assert(
    event.type !== 'authorisation_requested',
    'The authorisation was requested twice',
  );
  if (state.status === 'authorising') return resolveAuthorisation(state, event);

  return applyOperation(state, event);
};

const resolveAuthorisation = (
  payment: AuthorisingPayment,
  event: LaterEvent,
): Payment => {
  const { currency, amount } = payment;
  if (event.type === 'authorisation_failed') {
    return { status: 'declined', currency, amount };
  }
  assert(
    event.type === 'authorisation_confirmed',
    'An operation event arrived before the authorisation was confirmed',
  );

  return authorisedWith({
    status: 'authorised',
    currency,
    amount,
    providerReference: event.providerReference,
    captures: {},
    refunds: {},
  });
};

const applyOperation = (
  payment: AuthorisedPayment,
  event: LaterEvent,
): Payment => {
  switch (event.type) {
    case 'authorisation_confirmed':
    case 'authorisation_failed':
      throw new AssertionError('The authorisation was resolved twice');
    case 'capture_requested':
      assert(
        payment.status === 'authorised',
        'A capture was requested after the void was requested',
      );
      return authorisedWith({
        ...payment,
        captures: withOperation(
          payment.captures,
          event.captureId,
          event.amount,
        ),
      });
    case 'capture_confirmed':
      return authorisedWith({
        ...payment,
        captures: resolved(payment.captures, event.captureId, 'confirmed'),
      });
    case 'capture_failed':
      return authorisedWith({
        ...payment,
        captures: resolved(payment.captures, event.captureId, 'failed'),
      });
    case 'refund_requested':
      return authorisedWith({
        ...payment,
        refunds: withOperation(payment.refunds, event.refundId, event.amount),
      });
    case 'refund_confirmed':
      return authorisedWith({
        ...payment,
        refunds: resolved(payment.refunds, event.refundId, 'confirmed'),
      });
    case 'refund_failed':
      return authorisedWith({
        ...payment,
        refunds: resolved(payment.refunds, event.refundId, 'failed'),
      });
    case 'void_requested':
      assert(payment.status === 'authorised', 'A void was requested twice');
      return authorisedWith({ ...payment, status: 'voiding' });
    case 'void_confirmed':
      assert(payment.status === 'voiding', 'A void resolved without a request');
      return authorisedWith({ ...payment, status: 'voided' });
    case 'void_failed':
      assert(payment.status === 'voiding', 'A void resolved without a request');
      return authorisedWith({ ...payment, status: 'authorised' });
    default:
      return unreachable(event, 'Unhandled payment event');
  }
};
