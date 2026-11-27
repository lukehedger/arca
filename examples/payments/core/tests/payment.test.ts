import { describe, expect, test } from 'bun:test';
import {
  AssertionError,
  decide,
  evolve,
  type InvariantName,
  type Operation,
  type Operations,
  type Payment,
  type PaymentCommand,
  type PaymentEvent,
  type PaymentState,
} from '../index.ts';

type AuthorisedPayment = Extract<
  Payment,
  { readonly providerReference: string }
>;

const authorising: Payment = {
  status: 'authorising',
  currency: 'GBP',
  amount: 1000,
};
const declined: Payment = { status: 'declined', currency: 'GBP', amount: 1000 };

const authorised = (
  fields: Partial<
    Pick<AuthorisedPayment, 'status' | 'captures' | 'refunds'>
  > = {},
): AuthorisedPayment => ({
  status: 'authorised',
  currency: 'GBP',
  amount: 1000,
  providerReference: 'provider-1',
  captures: {},
  refunds: {},
  ...fields,
});

const pending = (amount: number): Operation => ({ amount, status: 'pending' });
const confirmed = (amount: number): Operation => ({
  amount,
  status: 'confirmed',
});
const failed = (amount: number): Operation => ({ amount, status: 'failed' });

const captured = (captures: Operations): AuthorisedPayment =>
  authorised({ captures });

describe('decide', () => {
  test.each<PaymentCommand>([
    { type: 'request_capture', captureId: 'a', amount: 0 },
    { type: 'request_capture', captureId: 'a', amount: -5 },
    { type: 'request_refund', refundId: 'a', amount: 1.5 },
    {
      type: 'request_authorisation',
      currency: 'GBP',
      amount: Number.MAX_SAFE_INTEGER + 1,
    },
  ])('asserts that the amount in %p is a positive whole number', (command) => {
    const broken = () => decide(authorised(), command);

    expect(broken).toThrow(AssertionError);
    expect(broken).toThrow(
      'Amount is not a positive whole number of minor units',
    );
  });

  test.each(['gbp', 'GB', 'GBPP', 'xGBP', 'GBPx', 'G1P'])(
    'asserts that the currency %p is an ISO 4217 code',
    (currency) => {
      const broken = () =>
        decide(undefined, {
          type: 'request_authorisation',
          currency,
          amount: 100,
        });

      expect(broken).toThrow(AssertionError);
      expect(broken).toThrow('Currency is not an ISO 4217 code');
    },
  );

  test.each<[PaymentCommand, string]>([
    [
      { type: 'request_capture', captureId: '', amount: 1 },
      'Capture id is empty',
    ],
    [{ type: 'confirm_capture', captureId: '' }, 'Capture id is empty'],
    [{ type: 'request_refund', refundId: '', amount: 1 }, 'Refund id is empty'],
    [{ type: 'fail_refund', refundId: '' }, 'Refund id is empty'],
    [
      { type: 'confirm_authorisation', providerReference: '' },
      'Provider reference is empty',
    ],
  ])('asserts against %p', (command, message) => {
    const broken = () => decide(authorised(), command);

    expect(broken).toThrow(AssertionError);
    expect(broken).toThrow(message);
  });

  test.each<[PaymentState, PaymentCommand, InvariantName]>([
    [
      undefined,
      { type: 'request_capture', captureId: 'a', amount: 1 },
      'payment-authorises-first',
    ],
    [
      authorising,
      { type: 'request_authorisation', currency: 'GBP', amount: 1 },
      'payment-authorises-first',
    ],
    [
      authorised(),
      { type: 'request_authorisation', currency: 'GBP', amount: 1 },
      'payment-authorises-first',
    ],
    [
      declined,
      { type: 'request_authorisation', currency: 'GBP', amount: 1 },
      'declined-payment-is-final',
    ],
    [
      declined,
      { type: 'confirm_authorisation', providerReference: 'provider-1' },
      'declined-payment-is-final',
    ],
    [
      authorising,
      { type: 'request_capture', captureId: 'a', amount: 1 },
      'captures-only-while-authorised',
    ],
    [
      authorised({ status: 'voiding' }),
      { type: 'request_capture', captureId: 'a', amount: 1 },
      'captures-only-while-authorised',
    ],
    [
      authorised({ status: 'voided' }),
      { type: 'request_capture', captureId: 'a', amount: 1 },
      'captures-only-while-authorised',
    ],
    [
      captured({ a: pending(100) }),
      { type: 'request_capture', captureId: 'a', amount: 1 },
      'operation-ids-are-unique',
    ],
    [
      captured({ a: failed(100) }),
      { type: 'request_capture', captureId: 'a', amount: 1 },
      'operation-ids-are-unique',
    ],
    [
      captured({ a: pending(600) }),
      { type: 'request_capture', captureId: 'b', amount: 401 },
      'captures-within-authorisation',
    ],
    [
      captured({ a: confirmed(600) }),
      { type: 'request_capture', captureId: 'b', amount: 401 },
      'captures-within-authorisation',
    ],
    [
      authorising,
      { type: 'request_refund', refundId: 'r', amount: 1 },
      'refunds-within-captures',
    ],
    [
      captured({ a: pending(500) }),
      { type: 'request_refund', refundId: 'r', amount: 1 },
      'refunds-within-captures',
    ],
    [
      authorised({
        captures: { a: confirmed(500) },
        refunds: { r: pending(300) },
      }),
      { type: 'request_refund', refundId: 's', amount: 201 },
      'refunds-within-captures',
    ],
    [
      authorised({
        captures: { a: confirmed(500) },
        refunds: { r: confirmed(300) },
      }),
      { type: 'request_refund', refundId: 's', amount: 201 },
      'refunds-within-captures',
    ],
    [
      authorised({
        captures: { a: confirmed(500) },
        refunds: { r: failed(100) },
      }),
      { type: 'request_refund', refundId: 'r', amount: 1 },
      'operation-ids-are-unique',
    ],
    [authorising, { type: 'request_void' }, 'void-waits-for-captures'],
    [
      captured({ a: confirmed(100), b: pending(100) }),
      { type: 'request_void' },
      'void-waits-for-captures',
    ],
    [
      authorised({ status: 'voiding' }),
      { type: 'request_void' },
      'void-waits-for-captures',
    ],
    [
      authorised({ status: 'voided' }),
      { type: 'request_void' },
      'void-waits-for-captures',
    ],
    [
      authorising,
      { type: 'confirm_capture', captureId: 'a' },
      'operations-resolve-once',
    ],
    [
      authorising,
      { type: 'fail_capture', captureId: 'a' },
      'operations-resolve-once',
    ],
    [
      authorising,
      { type: 'confirm_refund', refundId: 'r' },
      'operations-resolve-once',
    ],
    [
      authorising,
      { type: 'fail_refund', refundId: 'r' },
      'operations-resolve-once',
    ],
    [authorising, { type: 'confirm_void' }, 'operations-resolve-once'],
    [authorising, { type: 'fail_void' }, 'operations-resolve-once'],
    [
      authorised(),
      { type: 'confirm_authorisation', providerReference: 'provider-2' },
      'operations-resolve-once',
    ],
    [authorised(), { type: 'fail_authorisation' }, 'operations-resolve-once'],
    [
      authorised(),
      { type: 'confirm_capture', captureId: 'a' },
      'operations-resolve-once',
    ],
    [
      authorised(),
      { type: 'confirm_capture', captureId: 'constructor' },
      'operations-resolve-once',
    ],
    [
      captured({ a: confirmed(100) }),
      { type: 'confirm_capture', captureId: 'a' },
      'operations-resolve-once',
    ],
    [
      captured({ a: failed(100) }),
      { type: 'fail_capture', captureId: 'a' },
      'operations-resolve-once',
    ],
    [
      authorised({ refunds: { r: confirmed(100) } }),
      { type: 'confirm_refund', refundId: 'r' },
      'operations-resolve-once',
    ],
    [
      authorised({ refunds: { r: failed(100) } }),
      { type: 'fail_refund', refundId: 'r' },
      'operations-resolve-once',
    ],
    [authorised(), { type: 'confirm_void' }, 'operations-resolve-once'],
    [
      authorised({ status: 'voided' }),
      { type: 'fail_void' },
      'operations-resolve-once',
    ],
  ])('rejects %p %p to protect %s', (state, command, invariant) => {
    expect(decide(state, command)).toEqual({
      outcome: 'rejected',
      rejection: { invariant },
    });
  });

  test.each<[PaymentState, PaymentCommand, PaymentEvent]>([
    [
      undefined,
      { type: 'request_authorisation', currency: 'GBP', amount: 1000 },
      { type: 'authorisation_requested', currency: 'GBP', amount: 1000 },
    ],
    [
      authorising,
      { type: 'confirm_authorisation', providerReference: 'provider-1' },
      { type: 'authorisation_confirmed', providerReference: 'provider-1' },
    ],
    [
      authorising,
      { type: 'fail_authorisation' },
      { type: 'authorisation_failed' },
    ],
    [
      captured({ a: confirmed(600) }),
      { type: 'request_capture', captureId: 'b', amount: 400 },
      { type: 'capture_requested', captureId: 'b', amount: 400 },
    ],
    [
      captured({ a: failed(600) }),
      { type: 'request_capture', captureId: 'b', amount: 1000 },
      { type: 'capture_requested', captureId: 'b', amount: 1000 },
    ],
    [
      authorised(),
      { type: 'request_capture', captureId: 'constructor', amount: 1 },
      { type: 'capture_requested', captureId: 'constructor', amount: 1 },
    ],
    [
      captured({ a: pending(100) }),
      { type: 'confirm_capture', captureId: 'a' },
      { type: 'capture_confirmed', captureId: 'a' },
    ],
    [
      captured({ a: pending(100) }),
      { type: 'fail_capture', captureId: 'a' },
      { type: 'capture_failed', captureId: 'a' },
    ],
    [
      authorised({
        captures: { a: confirmed(500) },
        refunds: { r: pending(300) },
      }),
      { type: 'request_refund', refundId: 's', amount: 200 },
      { type: 'refund_requested', refundId: 's', amount: 200 },
    ],
    [
      authorised({
        captures: { a: confirmed(500) },
        refunds: { r: failed(500) },
      }),
      { type: 'request_refund', refundId: 's', amount: 500 },
      { type: 'refund_requested', refundId: 's', amount: 500 },
    ],
    [
      authorised({
        status: 'voided',
        captures: { a: confirmed(500) },
      }),
      { type: 'request_refund', refundId: 's', amount: 500 },
      { type: 'refund_requested', refundId: 's', amount: 500 },
    ],
    [
      authorised({ refunds: { r: pending(100) } }),
      { type: 'confirm_refund', refundId: 'r' },
      { type: 'refund_confirmed', refundId: 'r' },
    ],
    [
      authorised({ refunds: { r: pending(100) } }),
      { type: 'fail_refund', refundId: 'r' },
      { type: 'refund_failed', refundId: 'r' },
    ],
    [
      captured({ a: confirmed(100), b: failed(100) }),
      { type: 'request_void' },
      { type: 'void_requested' },
    ],
    [
      authorised({ status: 'voiding' }),
      { type: 'confirm_void' },
      { type: 'void_confirmed' },
    ],
    [
      authorised({ status: 'voiding' }),
      { type: 'fail_void' },
      { type: 'void_failed' },
    ],
  ])('approves %p %p with %p', (state, command, event) => {
    expect(decide(state, command)).toEqual({
      outcome: 'approved',
      events: [event],
    });
  });
});

describe('evolve', () => {
  test.each<[PaymentState, PaymentEvent, Payment]>([
    [
      undefined,
      { type: 'authorisation_requested', currency: 'GBP', amount: 1000 },
      authorising,
    ],
    [
      authorising,
      { type: 'authorisation_confirmed', providerReference: 'provider-1' },
      authorised(),
    ],
    [authorising, { type: 'authorisation_failed' }, declined],
    [
      captured({ a: confirmed(600) }),
      { type: 'capture_requested', captureId: 'b', amount: 400 },
      captured({ a: confirmed(600), b: pending(400) }),
    ],
    [
      captured({ a: pending(100) }),
      { type: 'capture_confirmed', captureId: 'a' },
      captured({ a: confirmed(100) }),
    ],
    [
      captured({ a: pending(100) }),
      { type: 'capture_failed', captureId: 'a' },
      captured({ a: failed(100) }),
    ],
    [
      captured({ a: confirmed(500) }),
      { type: 'refund_requested', refundId: 'r', amount: 500 },
      authorised({
        captures: { a: confirmed(500) },
        refunds: { r: pending(500) },
      }),
    ],
    [
      authorised({
        captures: { a: confirmed(500) },
        refunds: { r: pending(500) },
      }),
      { type: 'refund_confirmed', refundId: 'r' },
      authorised({
        captures: { a: confirmed(500) },
        refunds: { r: confirmed(500) },
      }),
    ],
    [
      authorised({
        captures: { a: confirmed(500) },
        refunds: { r: pending(500) },
      }),
      { type: 'refund_failed', refundId: 'r' },
      authorised({
        captures: { a: confirmed(500) },
        refunds: { r: failed(500) },
      }),
    ],
    [
      authorised(),
      { type: 'void_requested' },
      authorised({ status: 'voiding' }),
    ],
    [
      authorised({ status: 'voiding' }),
      { type: 'void_confirmed' },
      authorised({ status: 'voided' }),
    ],
    [authorised({ status: 'voiding' }), { type: 'void_failed' }, authorised()],
  ])('applies %p %p as %p', (state, event, next) => {
    expect(evolve(state, event)).toEqual(next);
  });

  test.each<[PaymentState, PaymentEvent, string]>([
    [
      undefined,
      { type: 'capture_requested', captureId: 'a', amount: 1 },
      'A payment event arrived before the authorisation was requested',
    ],
    [
      declined,
      { type: 'authorisation_confirmed', providerReference: 'provider-1' },
      'An event arrived after the payment was declined',
    ],
    [
      authorising,
      { type: 'authorisation_requested', currency: 'GBP', amount: 1 },
      'The authorisation was requested twice',
    ],
    [
      authorising,
      { type: 'capture_requested', captureId: 'a', amount: 1 },
      'An operation event arrived before the authorisation was confirmed',
    ],
    [
      authorised(),
      { type: 'authorisation_confirmed', providerReference: 'provider-1' },
      'The authorisation was resolved twice',
    ],
    [
      authorised(),
      { type: 'authorisation_failed' },
      'The authorisation was resolved twice',
    ],
    [
      authorised({ status: 'voiding' }),
      { type: 'capture_requested', captureId: 'a', amount: 1 },
      'A capture was requested after the void was requested',
    ],
    [
      captured({ a: failed(1) }),
      { type: 'capture_requested', captureId: 'a', amount: 1 },
      'An operation id was used twice',
    ],
    [
      authorised({
        captures: { a: confirmed(500) },
        refunds: { r: failed(1) },
      }),
      { type: 'refund_requested', refundId: 'r', amount: 1 },
      'An operation id was used twice',
    ],
    [
      captured({ a: pending(600) }),
      { type: 'capture_requested', captureId: 'b', amount: 401 },
      'Captures exceed the authorised amount',
    ],
    [
      captured({ a: confirmed(500) }),
      { type: 'refund_requested', refundId: 'r', amount: 501 },
      'Refunds exceed the captured amount',
    ],
    [
      captured({ a: pending(100) }),
      { type: 'void_requested' },
      'A capture is pending after the void was requested',
    ],
    [
      authorised(),
      { type: 'capture_confirmed', captureId: 'a' },
      'An operation resolved that was not pending',
    ],
    [
      captured({ a: confirmed(100) }),
      { type: 'capture_failed', captureId: 'a' },
      'An operation resolved that was not pending',
    ],
    [
      authorised({ refunds: { r: failed(100) } }),
      { type: 'refund_confirmed', refundId: 'r' },
      'An operation resolved that was not pending',
    ],
    [
      authorised({ status: 'voiding' }),
      { type: 'void_requested' },
      'A void was requested twice',
    ],
    [
      authorised(),
      { type: 'void_confirmed' },
      'A void resolved without a request',
    ],
    [
      authorised({ status: 'voided' }),
      { type: 'void_failed' },
      'A void resolved without a request',
    ],
  ])('asserts against %p %p', (state, event, message) => {
    const broken = () => evolve(state, event);

    expect(broken).toThrow(AssertionError);
    expect(broken).toThrow(message);
  });
});
