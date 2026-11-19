import { randomUUID } from 'node:crypto';
import { createAppRouter } from '@<project>/router';
import { describe, expect, test } from 'bun:test';
import {
  makeHandler,
  routeAccountCommands,
} from '../../accounts/handler.ts';
import { commandEvent, lambdaContext } from '../api-event.ts';

const tableName = process.env.STATE_TABLE_NAME;
if (tableName === undefined || tableName === '') {
  throw new Error(
    'STATE_TABLE_NAME is not set. Run integration tests with `bun env:test`, which reads it from the disposable environment.',
  );
}

// The real router, adapter, gate, core and store, against the table of the disposable environment.
const handler = makeHandler(
  routeAccountCommands(createAppRouter({ tableName })),
);

const send = async (accountId: string, command: unknown) => {
  const response = await handler(
    commandEvent(accountId, { variant: 'ledger', command }),
    lambdaContext,
  );
  return { statusCode: response.statusCode, body: JSON.parse(response.body) };
};

describe('accounts against DynamoDB', () => {
  test('opens an account, moves funds and rejects an overdraft', async () => {
    const accountId = randomUUID();

    await send(accountId, { type: 'open_account' });
    await send(accountId, { type: 'deposit_funds', amount: 40 });
    const overdraft = await send(accountId, {
      type: 'withdraw_funds',
      amount: 41,
    });
    const withdrawal = await send(accountId, {
      type: 'withdraw_funds',
      amount: 15,
    });

    expect(overdraft).toMatchObject({
      statusCode: 422,
      body: { code: 'balance-never-negative' },
    });
    expect(withdrawal).toEqual({
      statusCode: 200,
      body: { accountId, status: 'open', balance: 25 },
    });
  });

  test('lets one of two concurrent withdrawals of the whole balance win', async () => {
    const accountId = randomUUID();
    await send(accountId, { type: 'open_account' });
    await send(accountId, { type: 'deposit_funds', amount: 10 });

    const results = await Promise.all([
      send(accountId, { type: 'withdraw_funds', amount: 10 }),
      send(accountId, { type: 'withdraw_funds', amount: 10 }),
    ]);

    const statuses = results.map(({ statusCode }) => statusCode).sort();
    expect([
      [200, 409],
      [200, 422],
    ]).toContainEqual(statuses);
    const balance = await send(accountId, { type: 'deposit_funds', amount: 1 });
    expect(balance.body).toMatchObject({ balance: 1 });
  });
});
