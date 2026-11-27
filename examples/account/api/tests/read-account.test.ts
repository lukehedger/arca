import { describe, expect, test } from 'bun:test';
import { errorBodySchema, NotFoundError } from '@<project>/errors';
import type { AccountGate } from '@<project>/gate';
import { makeHandler } from '../accounts/read-account.ts';
import { apiEvent, lambdaContext } from './api-event.ts';

type Read = AccountGate['read'];

const handlerWith = (read: Read) => makeHandler({ accounts: { read } });

const readEvent = (accountId: string) =>
  apiEvent({
    httpMethod: 'GET',
    resource: '/accounts/{accountId}',
    pathParameters: { accountId },
  });

describe('read account handler', () => {
  test('returns the account the gate reads', async () => {
    const received: string[] = [];
    const read: Read = async (accountId) => {
      received.push(accountId);
      return { status: 'closed', balance: 0 };
    };

    const response = await handlerWith(read)(readEvent('acc-1'), lambdaContext);

    expect(received).toEqual(['acc-1']);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      accountId: 'acc-1',
      status: 'closed',
      balance: 0,
    });
  });

  test('answers 404 for an account that does not exist', async () => {
    const read: Read = async (accountId) => {
      throw new NotFoundError(`Account ${accountId} does not exist`);
    };

    const response = await handlerWith(read)(readEvent('acc-1'), lambdaContext);

    expect(response.statusCode).toBe(404);
    expect(errorBodySchema.parse(JSON.parse(response.body)).code).toBe(
      'NotFound',
    );
  });
});
