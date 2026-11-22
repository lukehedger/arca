import { ConflictError, DecisionRejectedError } from '@<project>/errors';
import type { AccountGate, AccountResult } from '@<project>/gate';
import { describe, expect, test } from 'bun:test';
import { ledger } from '../index.ts';

const gateReturning = (result: AccountResult): AccountGate => ({
  execute: async () => result,
});

const executeWith = async (accounts: AccountGate) => {
  const context = await ledger.buildContext({ accounts });
  const executeCommand = ledger.capabilities.executeCommand;
  if (executeCommand === undefined)
    throw new Error('ledger lacks executeCommand');

  return executeCommand(context, {
    accountId: 'acc-1',
    command: { type: 'withdraw_funds', amount: 5 },
    idempotencyKey: 'request-1',
  });
};

describe('ledger adapter', () => {
  test('passes the request to the gate and maps the account', async () => {
    const received: unknown[] = [];
    const accounts: AccountGate = {
      execute: async (input) => {
        received.push(input);
        return { outcome: 'applied', account: { status: 'open', balance: 20 } };
      },
    };

    expect(await executeWith(accounts)).toEqual({
      accountId: 'acc-1',
      status: 'open',
      balance: 20,
    });
    expect(received).toEqual([
      {
        accountId: 'acc-1',
        command: { type: 'withdraw_funds', amount: 5 },
        idempotencyKey: 'request-1',
      },
    ]);
  });

  test('raises a rejection named after the invariant it protects', async () => {
    const result = executeWith(
      gateReturning({
        outcome: 'rejected',
        rejection: { invariant: 'balance-never-negative' },
      }),
    );

    await expect(result).rejects.toBeInstanceOf(DecisionRejectedError);
    await expect(result).rejects.toMatchObject({
      code: 'balance-never-negative',
    });
  });

  test('raises a conflict when another write won the race', async () => {
    const result = executeWith(gateReturning({ outcome: 'conflict' }));

    await expect(result).rejects.toBeInstanceOf(ConflictError);
  });
});
