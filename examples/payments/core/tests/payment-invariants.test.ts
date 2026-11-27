import type { Operations, Payment, PaymentState } from '../index.ts';
import { history } from './history.ts';
import { invariant } from './invariant.ts';

type AuthorisedPayment = Extract<
  Payment,
  { readonly providerReference: string }
>;

const authorised = (state: PaymentState): AuthorisedPayment | undefined =>
  state !== undefined && 'providerReference' in state ? state : undefined;

const sum = (operations: Operations, statuses: readonly string[]): number =>
  Object.values(operations)
    .filter(({ status }) => statuses.includes(status))
    .reduce((total, { amount }) => total + amount, 0);

const statusOf = (operations: Operations | undefined, id: string) =>
  operations !== undefined && Object.hasOwn(operations, id)
    ? operations[id]?.status
    : undefined;

invariant('payment-authorises-first', history, (steps) =>
  steps.every(({ before, command, approved, after }) => {
    const isFirst = command.type === 'request_authorisation';
    if (before !== undefined) return !(isFirst && approved);
    if (!isFirst) return !approved && after === undefined;
    return approved && after?.status === 'authorising';
  }),
);

invariant('declined-payment-is-final', history, (steps) =>
  steps.every(
    ({ before, approved, after }) =>
      before?.status !== 'declined' || (!approved && after === before),
  ),
);

invariant('captures-only-while-authorised', history, (steps) =>
  steps.every(
    ({ before, command, approved }) =>
      command.type !== 'request_capture' ||
      !approved ||
      before?.status === 'authorised',
  ),
);

invariant('captures-within-authorisation', history, (steps) =>
  steps.every(({ after }) => {
    const payment = authorised(after);
    return (
      payment === undefined ||
      sum(payment.captures, ['pending', 'confirmed']) <= payment.amount
    );
  }),
);

invariant('refunds-within-captures', history, (steps) =>
  steps.every(({ after }) => {
    const payment = authorised(after);
    return (
      payment === undefined ||
      sum(payment.refunds, ['pending', 'confirmed']) <=
        sum(payment.captures, ['confirmed'])
    );
  }),
);

invariant('void-waits-for-captures', history, (steps) =>
  steps.every(({ before, command, approved }) => {
    if (command.type !== 'request_void' || !approved) return true;
    const payment = authorised(before);
    return (
      payment?.status === 'authorised' &&
      Object.values(payment.captures).every(
        ({ status }) => status !== 'pending',
      )
    );
  }),
);

invariant('operation-ids-are-unique', history, (steps) =>
  steps.every(({ before, command, approved }) => {
    if (!approved) return true;
    const payment = authorised(before);
    if (command.type === 'request_capture') {
      return statusOf(payment?.captures, command.captureId) === undefined;
    }
    if (command.type === 'request_refund') {
      return statusOf(payment?.refunds, command.refundId) === undefined;
    }
    return true;
  }),
);

invariant('operations-resolve-once', history, (steps) =>
  steps.every(({ before, command, approved, after }) => {
    if (!approved) return true;
    switch (command.type) {
      case 'confirm_authorisation':
      case 'fail_authorisation':
        return before?.status === 'authorising';
      case 'confirm_capture':
      case 'fail_capture':
        return (
          statusOf(authorised(before)?.captures, command.captureId) ===
            'pending' &&
          statusOf(authorised(after)?.captures, command.captureId) !== 'pending'
        );
      case 'confirm_refund':
      case 'fail_refund':
        return (
          statusOf(authorised(before)?.refunds, command.refundId) ===
            'pending' &&
          statusOf(authorised(after)?.refunds, command.refundId) !== 'pending'
        );
      case 'confirm_void':
      case 'fail_void':
        return before?.status === 'voiding';
      default:
        return true;
    }
  }),
);
