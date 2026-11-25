// if: event-sourcing
import {
  type Account,
  type AccountCommand,
  type AccountEvent,
  type AccountRejection,
  assert,
  decide,
  evolve,
  initialState,
} from '@<project>/core';
import { ConflictError, DecisionRejectedError } from '@<project>/errors';
import {
  createDocumentClient,
  createDynamoDbEventLog,
  type EventLog,
} from '@<project>/store';
import { z } from 'zod';
import { createEventSourcedGate } from './event-sourcing.ts';
// if: crud
import {
  type Account,
  type AccountCommand,
  type AccountRejection,
  decide,
} from '@<project>/core';
import { ConflictError, DecisionRejectedError } from '@<project>/errors';
import {
  createDocumentClient,
  createDynamoDbRecordStore,
  type RecordStore,
} from '@<project>/store';
import { z } from 'zod';
import { createRecordGate } from './crud.ts';
// end

const ACCOUNT_ENTITY = 'ACCOUNT';

export type AccountCommandInput = {
  readonly accountId: string;
  readonly command: AccountCommand;
  readonly idempotencyKey: string | undefined;
};

// Handlers see one shape whatever the persistence mode, so only this file and the core know the mode.
export type AccountGate = {
  readonly execute: (input: AccountCommandInput) => Promise<Account>;
};

const rejectionError = (rejection: AccountRejection): DecisionRejectedError =>
  new DecisionRejectedError(
    rejection.invariant,
    `The command would break the ${rejection.invariant} rule`,
  );

const conflictError = (accountId: string): ConflictError =>
  new ConflictError(
    `Account ${accountId} changed during the request. Retry it.`,
  );

// if: event-sourcing
// Persisted events are external data, so they are parsed back into the core's event type.
const accountEventSchema: z.ZodType<AccountEvent> = z.discriminatedUnion(
  'type',
  [
    z.object({ type: z.literal('account_opened') }),
    z.object({
      type: z.literal('funds_deposited'),
      amount: z.number().int().positive(),
    }),
    z.object({
      type: z.literal('funds_withdrawn'),
      amount: z.number().int().positive(),
    }),
    z.object({ type: z.literal('account_closed') }),
  ],
);

export type AccountGateDeps = { readonly eventLog: EventLog<AccountEvent> };

export const createAccountGate = (deps: AccountGateDeps): AccountGate => {
  const gate = createEventSourcedGate({
    eventLog: deps.eventLog,
    initialState,
    decide,
    evolve,
  });

  return {
    execute: async ({ accountId, command, idempotencyKey }) => {
      const result = await gate.apply({
        streamId: accountId,
        command,
        idempotencyKey,
      });
      if (result.outcome === 'rejected') throw rejectionError(result.rejection);
      if (result.outcome === 'conflict') throw conflictError(accountId);

      // Every approved command and every replay follows open_account, so the account exists.
      assert(result.state !== undefined, 'An applied command left no account');
      return result.state;
    },
  };
};

export const createDynamoDbAccountGate = (deps: {
  readonly tableName: string;
}): AccountGate =>
  createAccountGate({
    eventLog: createDynamoDbEventLog({
      client: createDocumentClient(),
      tableName: deps.tableName,
      entity: ACCOUNT_ENTITY,
      clock: () => new Date(),
      parseEvent: (value) => accountEventSchema.parse(value),
    }),
  });
// if: crud
// A persisted record is external data, so it is parsed back into the core's account type.
const accountSchema: z.ZodType<Account> = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('open'),
    balance: z.number().int().nonnegative(),
  }),
  z.object({ status: z.literal('closed'), balance: z.literal(0) }),
]);

export type AccountGateDeps = { readonly recordStore: RecordStore<Account> };

// CRUD mode keeps no record of handled requests, so it ignores the idempotency key.
export const createAccountGate = (deps: AccountGateDeps): AccountGate => {
  const gate = createRecordGate({ recordStore: deps.recordStore, decide });

  return {
    execute: async ({ accountId, command }) => {
      const result = await gate.apply({ id: accountId, command });
      if (result.outcome === 'rejected') throw rejectionError(result.rejection);
      if (result.outcome === 'conflict') throw conflictError(accountId);

      return result.state;
    },
  };
};

export const createDynamoDbAccountGate = (deps: {
  readonly tableName: string;
}): AccountGate =>
  createAccountGate({
    recordStore: createDynamoDbRecordStore({
      client: createDocumentClient(),
      tableName: deps.tableName,
      entity: ACCOUNT_ENTITY,
      clock: () => new Date(),
      parseValue: (value) => accountSchema.parse(value),
    }),
  });
// end
