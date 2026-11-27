import { describe, expect, test } from 'bun:test';
import { errorBodySchema, NotFoundError } from '@payments/errors';
import type { PaymentGate } from '@payments/gate';
import { makeHandler } from '../payments/read-payment.ts';
import { apiEvent, lambdaContext } from './api-event.ts';

type Read = PaymentGate['read'];

const handlerWith = (read: Read) => makeHandler({ payments: { read } });

const readEvent = (paymentId: string) =>
  apiEvent({
    httpMethod: 'GET',
    resource: '/payments/{paymentId}',
    pathParameters: { paymentId },
  });

describe('read payment handler', () => {
  test('returns the payment the gate reads', async () => {
    const received: string[] = [];
    const read: Read = async (paymentId) => {
      received.push(paymentId);
      return { status: 'authorising', currency: 'GBP', amount: 1000 };
    };

    const response = await handlerWith(read)(
      readEvent('payment-1'),
      lambdaContext,
    );

    expect(received).toEqual(['payment-1']);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      paymentId: 'payment-1',
      status: 'authorising',
      currency: 'GBP',
      amount: 1000,
    });
  });

  test('answers 404 for a payment that does not exist', async () => {
    const read: Read = async (paymentId) => {
      throw new NotFoundError(`Payment ${paymentId} does not exist`);
    };

    const response = await handlerWith(read)(
      readEvent('payment-1'),
      lambdaContext,
    );

    expect(response.statusCode).toBe(404);
    expect(errorBodySchema.parse(JSON.parse(response.body)).code).toBe(
      'NotFound',
    );
  });
});
