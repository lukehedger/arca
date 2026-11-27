import { describe, expect, test } from 'bun:test';
import { AssertionError, type PaymentEvent } from '@payments/core';
import {
  ConflictError,
  DecisionRejectedError,
  NotFoundError,
} from '@payments/errors';
import { createInMemoryEventLog, type EventLog } from '@payments/store';
import { createPaymentGate, type PaymentCommandInput } from '../index.ts';

const clock = (): Date => new Date('2026-01-01T00:00:00.000Z');

const createGate = (
  eventLog: EventLog<PaymentEvent> = createInMemoryEventLog({ clock }),
) => createPaymentGate({ eventLog });

// Reads the real stream but loses every race, as if another writer always appended first.
const losingEveryRace = (): EventLog<PaymentEvent> => {
  const eventLog = createInMemoryEventLog<PaymentEvent>({ clock });
  return { read: eventLog.read, append: async () => ({ outcome: 'conflict' }) };
};

const command = (
  paymentCommand: PaymentCommandInput['command'],
  idempotencyKey?: string,
): PaymentCommandInput => ({
  paymentId: 'payment-1',
  command: paymentCommand,
  idempotencyKey,
});

const authorise = {
  type: 'request_authorisation',
  currency: 'GBP',
  amount: 1000,
} as const;
const confirmAuthorisation = {
  type: 'confirm_authorisation',
  providerReference: 'provider-1',
} as const;

describe('payment gate', () => {
  test('applies a command to the payment it created', async () => {
    const gate = createGate();
    await gate.execute(command(authorise));

    const payment = await gate.execute(command(confirmAuthorisation));

    expect(payment).toEqual({
      status: 'authorised',
      currency: 'GBP',
      amount: 1000,
      providerReference: 'provider-1',
      captures: {},
      refunds: {},
    });
  });

  test('raises a rejection named after the invariant it protects', async () => {
    const result = createGate().execute(command({ type: 'request_void' }));

    await expect(result).rejects.toBeInstanceOf(DecisionRejectedError);
    await expect(result).rejects.toMatchObject({
      code: 'payment-authorises-first',
    });
  });

  test('reads the state the last command left', async () => {
    const gate = createGate();
    await gate.execute(command(authorise));

    expect(await gate.read('payment-1')).toEqual({
      status: 'authorising',
      currency: 'GBP',
      amount: 1000,
    });
  });

  test('reads the operations that wait on the provider', async () => {
    const gate = createGate();
    await gate.execute(command(authorise));
    await gate.execute(command(confirmAuthorisation));
    await gate.execute(
      command({ type: 'request_capture', captureId: 'capture-1', amount: 400 }),
    );

    expect(await gate.readPendingOperations('payment-1')).toEqual([
      {
        type: 'capture',
        captureId: 'capture-1',
        amount: 400,
        providerReference: 'provider-1',
      },
    ]);
  });

  test.each([
    [
      'the payment',
      (gate: ReturnType<typeof createGate>) => gate.read('payment-1'),
    ],
    [
      'the pending operations',
      (gate: ReturnType<typeof createGate>) =>
        gate.readPendingOperations('payment-1'),
    ],
  ])(
    'raises not found when reading %s of a payment that never started',
    async (_case, read) => {
      await expect(read(createGate())).rejects.toBeInstanceOf(NotFoundError);
    },
  );

  test('raises a conflict when another write won the race', async () => {
    const result = createGate(losingEveryRace()).execute(command(authorise));

    await expect(result).rejects.toBeInstanceOf(ConflictError);
  });

  test('replays a repeated idempotency key without applying it twice', async () => {
    const gate = createGate();
    await gate.execute(command(authorise, 'request-1'));

    expect(await gate.execute(command(authorise, 'request-1'))).toEqual({
      status: 'authorising',
      currency: 'GBP',
      amount: 1000,
    });
  });

  test('appends nothing when the command breaks a core assertion', async () => {
    const eventLog = createInMemoryEventLog<PaymentEvent>({ clock });
    const gate = createGate(eventLog);

    const result = gate.execute(
      command({ type: 'request_authorisation', currency: 'GBP', amount: 0 }),
    );

    await expect(result).rejects.toThrow(AssertionError);
    expect((await eventLog.read('payment-1')).version).toBe(0);
  });
});
