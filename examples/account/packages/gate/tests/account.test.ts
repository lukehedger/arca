import {
  ConflictError,
  DecisionRejectedError,
  NotFoundError,
} from '@<project>/errors';
import { describe, expect, test } from 'bun:test';
// if: event-sourcing
import { type AccountEvent, AssertionError } from '@<project>/core';
import { createInMemoryEventLog, type EventLog } from '@<project>/store';
import { createAccountGate } from '../index.ts';
// if: crud
import type { Account } from '@<project>/core';
import { createInMemoryRecordStore, type RecordStore } from '@<project>/store';
import { createAccountGate } from '../index.ts';
// end

const clock = (): Date => new Date('2026-01-01T00:00:00.000Z');

// if: event-sourcing
const createGate = (
  eventLog: EventLog<AccountEvent> = createInMemoryEventLog({ clock }),
) => createAccountGate({ eventLog });

// Reads the real stream but loses every race, as if another writer always appended first.
const losingEveryRace = (): EventLog<AccountEvent> => {
  const eventLog = createInMemoryEventLog<AccountEvent>({ clock });
  return { read: eventLog.read, append: async () => ({ outcome: 'conflict' }) };
};
// if: crud
const createGate = (
  recordStore: RecordStore<Account> = createInMemoryRecordStore({ clock }),
) => createAccountGate({ recordStore });

// Reads the real record but loses every race, as if another writer always wrote first.
const losingEveryRace = (): RecordStore<Account> => {
  const recordStore = createInMemoryRecordStore<Account>({ clock });
  return {
    read: recordStore.read,
    write: async () => ({ outcome: 'conflict' }),
  };
};
// end

describe('account gate', () => {
  test('applies a command to the account it opened', async () => {
    const gate = createGate();
    await gate.execute({
      accountId: 'acc-1',
      command: { type: 'open_account' },
      idempotencyKey: undefined,
    });

    const account = await gate.execute({
      accountId: 'acc-1',
      command: { type: 'deposit_funds', amount: 25 },
      idempotencyKey: undefined,
    });

    expect(account).toEqual({ status: 'open', balance: 25 });
  });

  test('raises a rejection named after the invariant it protects', async () => {
    const result = createGate().execute({
      accountId: 'acc-1',
      command: { type: 'withdraw_funds', amount: 1 },
      idempotencyKey: undefined,
    });

    await expect(result).rejects.toBeInstanceOf(DecisionRejectedError);
    await expect(result).rejects.toMatchObject({
      code: 'account-opens-first',
    });
  });

  test('reads the state the last command left', async () => {
    const gate = createGate();
    await gate.execute({
      accountId: 'acc-1',
      command: { type: 'open_account' },
      idempotencyKey: undefined,
    });
    await gate.execute({
      accountId: 'acc-1',
      command: { type: 'deposit_funds', amount: 25 },
      idempotencyKey: undefined,
    });

    expect(await gate.read('acc-1')).toEqual({ status: 'open', balance: 25 });
  });

  test('raises not found when reading an account that never opened', async () => {
    const result = createGate().read('acc-1');

    await expect(result).rejects.toBeInstanceOf(NotFoundError);
  });

  test('raises a conflict when another write won the race', async () => {
    const result = createGate(losingEveryRace()).execute({
      accountId: 'acc-1',
      command: { type: 'open_account' },
      idempotencyKey: undefined,
    });

    await expect(result).rejects.toBeInstanceOf(ConflictError);
  });
  // if: event-sourcing

  test('replays a repeated idempotency key without applying it twice', async () => {
    const gate = createGate();
    await gate.execute({
      accountId: 'acc-1',
      command: { type: 'open_account' },
      idempotencyKey: undefined,
    });
    const deposit = {
      accountId: 'acc-1',
      command: { type: 'deposit_funds', amount: 10 },
      idempotencyKey: 'request-1',
    } as const;
    await gate.execute(deposit);

    expect(await gate.execute(deposit)).toEqual({
      status: 'open',
      balance: 10,
    });
  });

  test('appends nothing when the command breaks a core assertion', async () => {
    const eventLog = createInMemoryEventLog<AccountEvent>({ clock });
    const gate = createGate(eventLog);
    await gate.execute({
      accountId: 'acc-1',
      command: { type: 'open_account' },
      idempotencyKey: undefined,
    });

    const result = gate.execute({
      accountId: 'acc-1',
      command: { type: 'deposit_funds', amount: 0 },
      idempotencyKey: undefined,
    });

    await expect(result).rejects.toThrow(AssertionError);
    expect((await eventLog.read('acc-1')).version).toBe(1);
  });
  // end
});
