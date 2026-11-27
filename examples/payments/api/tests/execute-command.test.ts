import { describe, expect, test } from 'bun:test';
import {
  ConflictError,
  DecisionRejectedError,
  errorBodySchema,
} from '@payments/errors';
import type { PaymentGate } from '@payments/gate';
import { makeHandler } from '../payments/execute-command.ts';
import { apiEvent, lambdaContext } from './api-event.ts';

type Execute = PaymentGate['execute'];

const handlerWith = (execute: Execute) =>
  makeHandler({ payments: { execute } });

const failingWith =
  (error: Error): Execute =>
  async () => {
    throw error;
  };

const commandEvent = (
  paymentId: string,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
) =>
  apiEvent({
    httpMethod: 'POST',
    resource: '/payments/{paymentId}/commands',
    pathParameters: { paymentId },
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const capture = {
  command: { type: 'request_capture', captureId: 'capture-1', amount: 500 },
};

describe('execute command handler', () => {
  test('passes the parsed command to the gate and returns the payment', async () => {
    const received: unknown[] = [];
    const execute: Execute = async (input) => {
      received.push(input);
      return {
        status: 'authorised',
        currency: 'GBP',
        amount: 1000,
        providerReference: 'provider-1',
        captures: { 'capture-1': { amount: 500, status: 'pending' } },
        refunds: {},
      };
    };

    const response = await handlerWith(execute)(
      commandEvent('payment-1', capture, { 'Idempotency-Key': 'request-1' }),
      lambdaContext,
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      paymentId: 'payment-1',
      status: 'authorised',
      currency: 'GBP',
      amount: 1000,
      providerReference: 'provider-1',
      captures: { 'capture-1': { amount: 500, status: 'pending' } },
      refunds: {},
    });
    expect(received).toEqual([
      {
        paymentId: 'payment-1',
        command: {
          type: 'request_capture',
          captureId: 'capture-1',
          amount: 500,
        },
        idempotencyKey: 'request-1',
      },
    ]);
  });

  test.each([
    ['malformed JSON', '{"command":'],
    [
      'a confirm, which only the provider answer sends',
      { command: { type: 'confirm_capture', captureId: 'capture-1' } },
    ],
  ])('answers 400 without calling the gate for %s', async (_case, body) => {
    const response = await handlerWith(failingWith(new Error('Called')))(
      commandEvent('payment-1', body),
      lambdaContext,
    );

    expect(response.statusCode).toBe(400);
    expect(errorBodySchema.parse(JSON.parse(response.body)).code).toBe(
      'ValidationError',
    );
  });

  test.each([
    [
      'a rejection',
      new DecisionRejectedError(
        'captures-within-authorisation',
        'Capture exceeds the authorisation',
      ),
      422,
      'captures-within-authorisation',
    ],
    [
      'a lost race',
      new ConflictError('Payment payment-1 changed during the request'),
      409,
      'Conflict',
    ],
    ['a store failure', new Error('DynamoDB is down'), 500, 'InternalError'],
  ] as const)('maps %s to %d', async (_case, error, statusCode, code) => {
    const response = await handlerWith(failingWith(error))(
      commandEvent('payment-1', capture),
      lambdaContext,
    );

    expect(response.statusCode).toBe(statusCode);
    expect(errorBodySchema.parse(JSON.parse(response.body))).toEqual({
      errorId: 'lambda-request-1',
      code,
      message: expect.any(String),
    });
  });
});
