import { describe, expect, test } from 'bun:test';
import {
  executePaymentCommandEventSchema,
  type PaymentResponse,
  paymentResponseSchema,
  paymentStreamEventSchema,
  readPaymentEventSchema,
} from '../index.ts';

const event = (overrides: Record<string, unknown> = {}) => ({
  pathParameters: { paymentId: 'payment-1' },
  headers: { 'Idempotency-Key': 'request-1' },
  body: JSON.stringify({
    command: { type: 'request_capture', captureId: 'capture-1', amount: 500 },
  }),
  ...overrides,
});

const withCommand = (command: unknown) =>
  event({ body: JSON.stringify({ command }) });

describe('executePaymentCommandEventSchema', () => {
  test('reads the payment, the command and the idempotency key', () => {
    expect(executePaymentCommandEventSchema.parse(event())).toEqual({
      paymentId: 'payment-1',
      command: { type: 'request_capture', captureId: 'capture-1', amount: 500 },
      idempotencyKey: 'request-1',
    });
  });

  test.each([
    { type: 'request_authorisation', currency: 'GBP', amount: 1000 },
    { type: 'request_refund', refundId: 'refund-1', amount: 100 },
    { type: 'request_void' },
  ])('accepts the request command %p', (command) => {
    const parsed = executePaymentCommandEventSchema.parse(withCommand(command));

    expect(parsed.command).toEqual(command);
  });

  test('reads the idempotency key whatever the header case', () => {
    const parsed = executePaymentCommandEventSchema.parse(
      event({ headers: { 'idempotency-key': 'request-2' } }),
    );

    expect(parsed.idempotencyKey).toBe('request-2');
  });

  test('leaves the idempotency key out when the header is absent', () => {
    const parsed = executePaymentCommandEventSchema.parse(
      event({ headers: null }),
    );

    expect(parsed.idempotencyKey).toBeUndefined();
  });

  test.each([
    ['a confirm from the caller', { type: 'confirm_capture', captureId: 'c' }],
    ['a fail from the caller', { type: 'fail_void' }],
    [
      'a confirmed authorisation from the caller',
      { type: 'confirm_authorisation', providerReference: 'provider-1' },
    ],
    [
      'a fractional amount',
      { type: 'request_capture', captureId: 'c', amount: 1.5 },
    ],
    ['a zero amount', { type: 'request_refund', refundId: 'r', amount: 0 }],
    [
      'a lower-case currency',
      { type: 'request_authorisation', currency: 'gbp', amount: 1 },
    ],
    [
      'a capture id outside the allowed characters',
      { type: 'request_capture', captureId: 'capture/1', amount: 1 },
    ],
    ['an extra field', { type: 'request_void', reason: 'cancelled' }],
  ])('rejects %s', (_case, command) => {
    const parsed = executePaymentCommandEventSchema.safeParse(
      withCommand(command),
    );

    expect(parsed.success).toBe(false);
  });

  test('rejects an idempotency key over 128 characters', () => {
    const parsed = executePaymentCommandEventSchema.safeParse(
      event({ headers: { 'Idempotency-Key': 'k'.repeat(129) } }),
    );

    expect(parsed.success).toBe(false);
  });

  test('rejects a payment id outside the allowed characters', () => {
    const parsed = executePaymentCommandEventSchema.safeParse(
      event({ pathParameters: { paymentId: 'payment/1' } }),
    );

    expect(parsed.success).toBe(false);
  });
});

describe('readPaymentEventSchema', () => {
  test('reads the payment id from the path', () => {
    expect(
      readPaymentEventSchema.parse({
        pathParameters: { paymentId: 'payment-1' },
      }),
    ).toEqual({ paymentId: 'payment-1' });
  });
});

describe('paymentResponseSchema', () => {
  test('accepts an authorised payment with its operations', () => {
    const body: PaymentResponse = {
      paymentId: 'payment-1',
      status: 'authorised',
      currency: 'GBP',
      amount: 1000,
      providerReference: 'provider-1',
      captures: { 'capture-1': { amount: 500, status: 'pending' } },
      refunds: {},
    };

    expect(paymentResponseSchema.parse(body)).toEqual(body);
  });

  test('rejects operations on a payment that is still authorising', () => {
    const parsed = paymentResponseSchema.safeParse({
      paymentId: 'payment-1',
      status: 'authorising',
      currency: 'GBP',
      amount: 1000,
      captures: {},
    });

    expect(parsed.success).toBe(false);
  });
});

const streamRecord = (eventName: string, partitionKey: string) => ({
  eventName,
  dynamodb: {
    Keys: { PK: { S: partitionKey }, SK: { S: 'EVENT#000000000001' } },
  },
});

describe('paymentStreamEventSchema', () => {
  test('names each payment that gained an event once', () => {
    const parsed = paymentStreamEventSchema.parse({
      Records: [
        streamRecord('INSERT', 'PAYMENT#payment-1'),
        streamRecord('INSERT', 'PAYMENT#payment-2'),
        streamRecord('INSERT', 'PAYMENT#payment-1'),
      ],
    });

    expect(parsed).toEqual({ paymentIds: ['payment-1', 'payment-2'] });
  });

  test('ignores a record that is not an insert', () => {
    const parsed = paymentStreamEventSchema.parse({
      Records: [streamRecord('REMOVE', 'PAYMENT#payment-1')],
    });

    expect(parsed).toEqual({ paymentIds: [] });
  });

  test('rejects a key that does not name a payment', () => {
    const parsed = paymentStreamEventSchema.safeParse({
      Records: [streamRecord('INSERT', 'ACCOUNT#account-1')],
    });

    expect(parsed.success).toBe(false);
  });
});
