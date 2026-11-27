import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { LocalDurableTestRunner } from '@aws/durable-execution-sdk-js-testing';
import { DecisionRejectedError } from '@payments/errors';
import type {
  PaymentCommandInput,
  PaymentGate,
  PendingOperation,
} from '@payments/gate';
import {
  makeHandler,
  type Provider,
  type ProviderAnswer,
} from '../payments/resolve-operations.ts';

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

type Execute = PaymentGate['execute'];

const confirmed: ProviderAnswer = { outcome: 'confirmed' };
const failed: ProviderAnswer = { outcome: 'failed' };

const answering = (answer: ProviderAnswer): Provider => ({
  authorise: async () =>
    answer.outcome === 'confirmed'
      ? { outcome: 'confirmed', providerReference: 'provider-1' }
      : answer,
  capture: async () => answer,
  refund: async () => answer,
  voidAuthorisation: async () => answer,
});

const streamEvent = (...paymentIds: readonly string[]) => ({
  Records: paymentIds.map((paymentId) => ({
    eventName: 'INSERT',
    dynamodb: {
      Keys: { PK: { S: `PAYMENT#${paymentId}` }, SK: { S: 'EVENT#1' } },
    },
  })),
});

const resolve = async (options: {
  readonly operations: Readonly<Record<string, readonly PendingOperation[]>>;
  readonly provider: Provider;
  readonly execute?: Execute;
  readonly paymentIds?: readonly string[];
}) => {
  const executed: PaymentCommandInput[] = [];
  const reads: string[] = [];
  const execute: Execute =
    options.execute ??
    (async (input) => {
      executed.push(input);
      return { status: 'authorising', currency: 'GBP', amount: 1000 };
    });
  const runner = new LocalDurableTestRunner({
    handlerFunction: makeHandler({
      payments: {
        execute,
        readPendingOperations: async (paymentId) => {
          reads.push(paymentId);
          return options.operations[paymentId] ?? [];
        },
      },
      provider: options.provider,
    }),
  });

  const execution = await runner.run({
    payload: streamEvent(...(options.paymentIds ?? ['payment-1'])),
  });

  return { status: execution.getStatus(), executed, reads };
};

const capture: PendingOperation = {
  type: 'capture',
  captureId: 'capture-1',
  amount: 400,
  providerReference: 'provider-1',
};

describe('resolve operations', () => {
  test.each<
    [string, PendingOperation, ProviderAnswer, PaymentCommandInput['command']]
  >([
    [
      'a confirmed authorisation',
      { type: 'authorisation', currency: 'GBP', amount: 1000 },
      confirmed,
      { type: 'confirm_authorisation', providerReference: 'provider-1' },
    ],
    [
      'a declined authorisation',
      { type: 'authorisation', currency: 'GBP', amount: 1000 },
      failed,
      { type: 'fail_authorisation' },
    ],
    [
      'a confirmed capture',
      capture,
      confirmed,
      { type: 'confirm_capture', captureId: 'capture-1' },
    ],
    [
      'a failed capture',
      capture,
      failed,
      { type: 'fail_capture', captureId: 'capture-1' },
    ],
    [
      'a confirmed refund',
      {
        type: 'refund',
        refundId: 'refund-1',
        amount: 100,
        providerReference: 'provider-1',
      },
      confirmed,
      { type: 'confirm_refund', refundId: 'refund-1' },
    ],
    [
      'a failed refund',
      {
        type: 'refund',
        refundId: 'refund-1',
        amount: 100,
        providerReference: 'provider-1',
      },
      failed,
      { type: 'fail_refund', refundId: 'refund-1' },
    ],
    [
      'a confirmed void',
      { type: 'void', providerReference: 'provider-1' },
      confirmed,
      { type: 'confirm_void' },
    ],
    [
      'a failed void',
      { type: 'void', providerReference: 'provider-1' },
      failed,
      { type: 'fail_void' },
    ],
  ])('sends %s through the gate', async (_case, operation, answer, command) => {
    const result = await resolve({
      operations: { 'payment-1': [operation] },
      provider: answering(answer),
    });

    expect(result.status).toBe('SUCCEEDED');
    expect(result.executed).toEqual([
      { paymentId: 'payment-1', command, idempotencyKey: undefined },
    ]);
  });

  test('sends the provider what each call needs', async () => {
    const requests: unknown[] = [];
    const provider: Provider = {
      authorise: async (request) => {
        requests.push(request);
        return { outcome: 'confirmed', providerReference: 'provider-1' };
      },
      capture: async (request) => {
        requests.push(request);
        return confirmed;
      },
      refund: async () => confirmed,
      voidAuthorisation: async () => confirmed,
    };

    await resolve({
      operations: {
        'payment-1': [{ type: 'authorisation', currency: 'GBP', amount: 1000 }],
        'payment-2': [capture],
      },
      provider,
      paymentIds: ['payment-1', 'payment-2'],
    });

    expect(requests).toEqual([
      { paymentId: 'payment-1', currency: 'GBP', amount: 1000 },
      { captureId: 'capture-1', amount: 400, providerReference: 'provider-1' },
    ]);
  });

  test('retries a provider call that has no answer yet and answers once', async () => {
    const calls: number[] = [];
    const provider: Provider = {
      ...answering(confirmed),
      capture: async () => {
        calls.push(calls.length + 1);
        if (calls.length === 1) throw new Error('Provider timed out');
        return confirmed;
      },
    };

    const result = await resolve({
      operations: { 'payment-1': [capture] },
      provider,
    });

    expect(result.status).toBe('SUCCEEDED');
    expect(calls).toEqual([1, 2]);
    expect(result.executed).toEqual([
      {
        paymentId: 'payment-1',
        command: { type: 'confirm_capture', captureId: 'capture-1' },
        idempotencyKey: undefined,
      },
    ]);
  });

  test('reads each payment in the batch once', async () => {
    const result = await resolve({
      operations: {},
      provider: answering(confirmed),
      paymentIds: ['payment-1', 'payment-2', 'payment-1'],
    });

    expect(result.reads).toEqual(['payment-1', 'payment-2']);
  });

  test('treats an operation another execution answered as resolved', async () => {
    const result = await resolve({
      operations: { 'payment-1': [capture] },
      provider: answering(confirmed),
      execute: async () => {
        throw new DecisionRejectedError(
          'operations-resolve-once',
          'The command would break the operations-resolve-once rule',
        );
      },
    });

    expect(result.status).toBe('SUCCEEDED');
  });

  test('fails the execution when the gate rejects the answer for another reason', async () => {
    const result = await resolve({
      operations: { 'payment-1': [capture] },
      provider: answering(confirmed),
      execute: async () => {
        throw new DecisionRejectedError(
          'declined-payment-is-final',
          'The command would break the declined-payment-is-final rule',
        );
      },
    });

    expect(result.status).toBe('FAILED');
  });
});
