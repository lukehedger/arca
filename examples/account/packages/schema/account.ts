import type { AccountCommand } from '@<project>/core';
import { z } from 'zod';
import { jsonBody } from './json-body.ts';
import type { Assert, Same } from './same.ts';

const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

export const accountIdSchema = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);

// Whole minor units, such as pence, so no rounding can move money.
const amountSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const accountCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('open_account') }),
  z.strictObject({ type: z.literal('deposit_funds'), amount: amountSchema }),
  z.strictObject({ type: z.literal('withdraw_funds'), amount: amountSchema }),
  z.strictObject({ type: z.literal('close_account') }),
]);

// The handler passes the parsed command straight to the gate, so a command on one side only fails to compile.
export type AccountCommandMatchesCore = Assert<
  Same<z.infer<typeof accountCommandSchema>, AccountCommand>
>;

export const accountCommandRequestSchema = z.strictObject({
  accountId: accountIdSchema,
  command: accountCommandSchema,
  idempotencyKey: z.string().min(1).max(128).optional(),
});

export type AccountCommandRequest = z.infer<typeof accountCommandRequestSchema>;

export const accountResponseSchema = z.strictObject({
  accountId: accountIdSchema,
  status: z.enum(['open', 'closed']),
  balance: z.number().int().nonnegative(),
});

export type AccountResponse = z.infer<typeof accountResponseSchema>;

// HTTP header names are case-insensitive and API Gateway passes them as the client sent them.
const idempotencyKeySchema = z
  .record(z.string(), z.string().optional())
  .nullable()
  .transform(
    (headers) =>
      Object.entries(headers ?? {}).find(
        ([name]) => name.toLowerCase() === IDEMPOTENCY_KEY_HEADER,
      )?.[1],
  )
  .pipe(accountCommandRequestSchema.shape.idempotencyKey);

// Parses the API Gateway event for POST /accounts/{accountId}/commands.
export const executeAccountCommandEventSchema = z
  .object({
    pathParameters: z.object({ accountId: accountIdSchema }),
    headers: idempotencyKeySchema,
    body: jsonBody(z.strictObject({ command: accountCommandSchema })),
  })
  .transform(({ pathParameters, headers, body }) => ({
    accountId: pathParameters.accountId,
    command: body.command,
    idempotencyKey: headers,
  }));
