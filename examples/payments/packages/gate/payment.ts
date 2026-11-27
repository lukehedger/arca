import {
  assert,
  decide,
  evolve,
  initialState,
  type Payment,
  type PaymentCommand,
  type PaymentEvent,
  type PaymentRejection,
  type PendingOperation,
  pendingOperations,
} from '@payments/core';
import {
  ConflictError,
  DecisionRejectedError,
  NotFoundError,
} from '@payments/errors';
import {
  createDocumentClient,
  createDynamoDbEventLog,
  type EventLog,
} from '@payments/store';
import { z } from 'zod';
import { createEventSourcedGate } from './event-sourcing.ts';

const PAYMENT_ENTITY = 'PAYMENT';

export type PaymentCommandInput = {
  readonly paymentId: string;
  readonly command: PaymentCommand;
  readonly idempotencyKey: string | undefined;
};

// A read loads the same state the decider is given, so a response never shows a state a command would not see.
export type PaymentGate = {
  readonly execute: (input: PaymentCommandInput) => Promise<Payment>;
  readonly read: (paymentId: string) => Promise<Payment>;
  readonly readPendingOperations: (
    paymentId: string,
  ) => Promise<readonly PendingOperation[]>;
};

const rejectionError = (rejection: PaymentRejection): DecisionRejectedError =>
  new DecisionRejectedError(
    rejection.invariant,
    `The command would break the ${rejection.invariant} rule`,
  );

const conflictError = (paymentId: string): ConflictError =>
  new ConflictError(
    `Payment ${paymentId} changed during the request. Retry it.`,
  );

const notFoundError = (paymentId: string): NotFoundError =>
  new NotFoundError(`Payment ${paymentId} does not exist`);

const amountSchema = z.number().int().positive();
const captureId = z.string().min(1);
const refundId = z.string().min(1);

// Persisted events are external data, so they are parsed back into the core's event type.
const paymentEventSchema: z.ZodType<PaymentEvent> = z.discriminatedUnion(
  'type',
  [
    z.object({
      type: z.literal('authorisation_requested'),
      currency: z.string(),
      amount: amountSchema,
    }),
    z.object({
      type: z.literal('authorisation_confirmed'),
      providerReference: z.string().min(1),
    }),
    z.object({ type: z.literal('authorisation_failed') }),
    z.object({
      type: z.literal('capture_requested'),
      captureId,
      amount: amountSchema,
    }),
    z.object({ type: z.literal('capture_confirmed'), captureId }),
    z.object({ type: z.literal('capture_failed'), captureId }),
    z.object({
      type: z.literal('refund_requested'),
      refundId,
      amount: amountSchema,
    }),
    z.object({ type: z.literal('refund_confirmed'), refundId }),
    z.object({ type: z.literal('refund_failed'), refundId }),
    z.object({ type: z.literal('void_requested') }),
    z.object({ type: z.literal('void_confirmed') }),
    z.object({ type: z.literal('void_failed') }),
  ],
);

export type PaymentGateDeps = { readonly eventLog: EventLog<PaymentEvent> };

export const createPaymentGate = (deps: PaymentGateDeps): PaymentGate => {
  const gate = createEventSourcedGate({
    eventLog: deps.eventLog,
    initialState,
    decide,
    evolve,
  });

  const read = async (paymentId: string): Promise<Payment> => {
    const payment = await gate.load(paymentId);
    if (payment === undefined) throw notFoundError(paymentId);

    return payment;
  };

  return {
    execute: async ({ paymentId, command, idempotencyKey }) => {
      const result = await gate.apply({
        streamId: paymentId,
        command,
        idempotencyKey,
      });
      if (result.outcome === 'rejected') throw rejectionError(result.rejection);
      if (result.outcome === 'conflict') throw conflictError(paymentId);

      // Every approved command and every replay follows request_authorisation, so the payment exists.
      assert(result.state !== undefined, 'An applied command left no payment');
      return result.state;
    },
    read,
    readPendingOperations: async (paymentId) =>
      pendingOperations(await read(paymentId)),
  };
};

export const createDynamoDbPaymentGate = (deps: {
  readonly tableName: string;
}): PaymentGate =>
  createPaymentGate({
    eventLog: createDynamoDbEventLog({
      client: createDocumentClient(),
      tableName: deps.tableName,
      entity: PAYMENT_ENTITY,
      clock: () => new Date(),
      parseEvent: (value) => paymentEventSchema.parse(value),
    }),
  });
