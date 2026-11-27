import type { PaymentRequestCommand } from '@payments/core';
import { z } from 'zod';
import { jsonBody } from './json-body.ts';
import type { Assert, Same } from './same.ts';

const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
const PAYMENT_PARTITION_KEY_PREFIX = 'PAYMENT#';

export const paymentIdSchema = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);

// The provider receives each capture id and refund id as its idempotency key, so both keep to the same safe characters.
const operationIdSchema = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);

// Whole minor units, such as pence, so no rounding can move money.
const amountSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const currencySchema = z.string().regex(/^[A-Z]{3}$/);

export const paymentRequestCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('request_authorisation'),
    currency: currencySchema,
    amount: amountSchema,
  }),
  z.strictObject({
    type: z.literal('request_capture'),
    captureId: operationIdSchema,
    amount: amountSchema,
  }),
  z.strictObject({
    type: z.literal('request_refund'),
    refundId: operationIdSchema,
    amount: amountSchema,
  }),
  z.strictObject({ type: z.literal('request_void') }),
]);

// The handler passes the parsed command straight to the gate, so a request command on one side only fails to compile.
export type PaymentRequestCommandMatchesCore = Assert<
  Same<z.infer<typeof paymentRequestCommandSchema>, PaymentRequestCommand>
>;

export const paymentCommandRequestSchema = z.strictObject({
  paymentId: paymentIdSchema,
  command: paymentRequestCommandSchema,
  idempotencyKey: z.string().min(1).max(128).optional(),
});

export type PaymentCommandRequest = z.infer<typeof paymentCommandRequestSchema>;

const operationsSchema = z.record(
  operationIdSchema,
  z.strictObject({
    amount: amountSchema,
    status: z.enum(['pending', 'confirmed', 'failed']),
  }),
);

export const paymentResponseSchema = z.union([
  z.strictObject({
    paymentId: paymentIdSchema,
    status: z.enum(['authorising', 'declined']),
    currency: currencySchema,
    amount: amountSchema,
  }),
  z.strictObject({
    paymentId: paymentIdSchema,
    status: z.enum(['authorised', 'voiding', 'voided']),
    currency: currencySchema,
    amount: amountSchema,
    providerReference: z.string().min(1),
    captures: operationsSchema,
    refunds: operationsSchema,
  }),
]);

export type PaymentResponse = z.infer<typeof paymentResponseSchema>;

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
  .pipe(paymentCommandRequestSchema.shape.idempotencyKey);

// Parses the API Gateway event for POST /payments/{paymentId}/commands.
export const executePaymentCommandEventSchema = z
  .object({
    pathParameters: z.object({ paymentId: paymentIdSchema }),
    headers: idempotencyKeySchema,
    body: jsonBody(z.strictObject({ command: paymentRequestCommandSchema })),
  })
  .transform(({ pathParameters, headers, body }) => ({
    paymentId: pathParameters.paymentId,
    command: body.command,
    idempotencyKey: headers,
  }));

// Parses the API Gateway event for GET /payments/{paymentId}.
export const readPaymentEventSchema = z
  .object({ pathParameters: z.object({ paymentId: paymentIdSchema }) })
  .transform(({ pathParameters }) => ({ paymentId: pathParameters.paymentId }));

// The partition key follows the persistence format in DOMAIN.md, so the stream names the payment without its event.
const streamPaymentIdSchema = z
  .string()
  .startsWith(PAYMENT_PARTITION_KEY_PREFIX)
  .transform((partitionKey) =>
    partitionKey.slice(PAYMENT_PARTITION_KEY_PREFIX.length),
  )
  .pipe(paymentIdSchema);

const streamRecordSchema = z.object({
  eventName: z.enum(['INSERT', 'MODIFY', 'REMOVE']),
  dynamodb: z.object({
    Keys: z.object({ PK: z.object({ S: streamPaymentIdSchema }) }),
  }),
});

// Parses a DynamoDB stream batch into each payment that gained an event. The stream is append-only, so only an insert matters.
export const paymentStreamEventSchema = z
  .object({ Records: z.array(streamRecordSchema) })
  .transform(({ Records }) => ({
    paymentIds: [
      ...new Set(
        Records.filter(({ eventName }) => eventName === 'INSERT').map(
          ({ dynamodb }) => dynamodb.Keys.PK.S,
        ),
      ),
    ],
  }));
