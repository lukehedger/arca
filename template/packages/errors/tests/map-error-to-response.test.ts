import { describe, expect, test } from 'bun:test';
import {
  classificationOf,
  errorBodySchema,
  mapErrorToResponse,
  NotFoundError,
  ValidationError,
} from '../src/index.ts';

const parseBody = (body: string) => errorBodySchema.parse(JSON.parse(body));

describe('mapErrorToResponse', () => {
  test('returns the classified status with a JSON body that matches the schema', () => {
    const response = mapErrorToResponse(
      new NotFoundError('Order ord-1 not found'),
      'request-1',
    );

    expect(response.statusCode).toBe(404);
    expect(response.headers).toEqual({ 'content-type': 'application/json' });
    expect(parseBody(response.body)).toEqual({
      errorId: 'request-1',
      code: 'NotFound',
      message: 'Order ord-1 not found',
    });
  });

  test('never returns which fields failed validation', () => {
    const response = mapErrorToResponse(
      new ValidationError([{ path: ['quantity'], message: 'Too small' }]),
      'request-2',
    );

    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain('quantity');
    expect(parseBody(response.body).message).toBe('Request failed validation');
  });

  test('never returns the message of an unexpected error', () => {
    const response = mapErrorToResponse(
      new Error('ConditionalCheckFailed on orders-table'),
      'request-3',
    );

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('orders-table');
  });

  test('keeps the classification of each response it built for telemetry', () => {
    const failure = new Error('Balance is negative after the command');
    failure.name = 'AssertionError';
    const response = mapErrorToResponse(failure, 'request-4');

    expect(classificationOf(response)?.outcome).toBe('assertion_failed');
    expect(response.body).not.toContain('assertion');
    expect(classificationOf({ statusCode: 500, body: '{}' })).toBeUndefined();
  });
});
