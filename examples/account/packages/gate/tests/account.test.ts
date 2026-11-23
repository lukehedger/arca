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
// if: crud
const createGate = (
  recordStore: RecordStore<Account> = createInMemoryRecordStore({ clock }),
) => createAccountGate({ recordStore });
// end

describe('account gate', () => {
  test('applies a command to the account it opened', async () => {
    const gate = createGate();
    await gate.execute({
      accountId: 'acc-1',
      command: { type: 'open_account' },
      idempotencyKey: undefined,
    });

    const result = await gate.execute({
      accountId: 'acc-1',
      command: { type: 'deposit_funds', amount: 25 },
      idempotencyKey: undefined,
    });

    expect(result).toEqual({
      outcome: 'applied',
      account: { status: 'open', balance: 25 },
    });
  });

  test('returns the core rejection unchanged', async () => {
    const result = await createGate().execute({
      accountId: 'acc-1',
      command: { type: 'withdraw_funds', amount: 1 },
      idempotencyKey: undefined,
    });

    expect(result).toEqual({
      outcome: 'rejected',
      rejection: { invariant: 'account-opens-first' },
    });
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
      outcome: 'applied',
      account: { status: 'open', balance: 10 },
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
