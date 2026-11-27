import { describe, expect, test } from 'bun:test';
import {
  ConflictError,
  DecisionRejectedError,
  errorBodySchema,
} from '@<project>/errors';
import type { AccountGate } from '@<project>/gate';
import { makeHandler } from '../accounts/execute-command.ts';
import { apiEvent, lambdaContext } from './api-event.ts';

type Execute = AccountGate['execute'];

const handlerWith = (execute: Execute) =>
  makeHandler({ accounts: { execute } });

const failingWith =
  (error: Error): Execute =>
  async () => {
    throw error;
  };

const commandEvent = (
  accountId: string,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
) =>
  apiEvent({
    httpMethod: 'POST',
    resource: '/accounts/{accountId}/commands',
    pathParameters: { accountId },
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const deposit = { command: { type: 'deposit_funds', amount: 25 } };

describe('execute command handler', () => {
  test('passes the parsed command to the gate and returns the account', async () => {
    const received: unknown[] = [];
    const execute: Execute = async (input) => {
      received.push(input);
      return { status: 'open', balance: 25 };
    };

    const response = await handlerWith(execute)(
      commandEvent('acc-1', deposit, { 'Idempotency-Key': 'request-1' }),
      lambdaContext,
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      accountId: 'acc-1',
      status: 'open',
      balance: 25,
    });
    expect(received).toEqual([
      {
        accountId: 'acc-1',
        command: { type: 'deposit_funds', amount: 25 },
        idempotencyKey: 'request-1',
      },
    ]);
  });

  test.each([
    ['malformed JSON', '{"command":'],
    ['an invalid command', { command: { type: 'deposit_funds', amount: -1 } }],
  ])('answers 400 without calling the gate for %s', async (_case, body) => {
    const response = await handlerWith(failingWith(new Error('Called')))(
      commandEvent('acc-1', body),
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
      new DecisionRejectedError('balance-never-negative', 'Overdraft'),
      422,
      'balance-never-negative',
    ],
    [
      'a lost race',
      new ConflictError('Account acc-1 changed during the request'),
      409,
      'Conflict',
    ],
    ['a store failure', new Error('DynamoDB is down'), 500, 'InternalError'],
  ] as const)('maps %s to %d', async (_case, error, statusCode, code) => {
    const response = await handlerWith(failingWith(error))(
      commandEvent('acc-1', deposit),
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
