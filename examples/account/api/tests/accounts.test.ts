import {
  ConflictError,
  DecisionRejectedError,
  errorBodySchema,
} from '@<project>/errors';
import { describe, expect, test } from 'bun:test';
import {
  type AccountsHandlerDeps,
  makeHandler,
} from '../accounts/handler.ts';
import { commandEvent, lambdaContext } from './api-event.ts';

type ExecuteCommand = AccountsHandlerDeps['executeCommand'];

const handlerWith = (executeCommand: ExecuteCommand) =>
  makeHandler({ executeCommand });

const succeeding: ExecuteCommand = async (_variant, request) => ({
  accountId: request.accountId,
  status: 'open',
  balance: 25,
});

const failingWith =
  (error: Error): ExecuteCommand =>
  async () => {
    throw error;
  };

const deposit = {
  variant: 'ledger',
  command: { type: 'deposit_funds', amount: 25 },
};

describe('accounts handler', () => {
  test('routes the parsed command and returns the account', async () => {
    const calls: unknown[] = [];
    const executeCommand: ExecuteCommand = async (variant, request) => {
      calls.push({ variant, request });
      return succeeding(variant, request);
    };

    const response = await handlerWith(executeCommand)(
      commandEvent('acc-1', deposit, { 'Idempotency-Key': 'request-1' }),
      lambdaContext,
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      accountId: 'acc-1',
      status: 'open',
      balance: 25,
    });
    expect(calls).toEqual([
      {
        variant: 'ledger',
        request: {
          accountId: 'acc-1',
          command: { type: 'deposit_funds', amount: 25 },
          idempotencyKey: 'request-1',
        },
      },
    ]);
  });

  test.each([
    ['malformed JSON', '{"variant":'],
    [
      'an invalid command',
      { variant: 'ledger', command: { type: 'deposit_funds', amount: -1 } },
    ],
  ])('answers 400 without routing %s', async (_case, body) => {
    const response = await handlerWith(failingWith(new Error('Routed')))(
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
