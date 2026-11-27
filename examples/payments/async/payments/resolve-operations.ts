import {
  type DurableContext,
  type DurableLambdaHandler,
  withDurableExecution,
} from '@aws/durable-execution-sdk-js';
import { DecisionRejectedError } from '@payments/errors';
import type {
  InvariantName,
  PaymentCommandInput,
  PaymentGate,
  PendingOperation,
} from '@payments/gate';
import { paymentStreamEventSchema } from '@payments/schema';

type PaymentCommand = PaymentCommandInput['command'];
type OperationOf<Type extends PendingOperation['type']> = Omit<
  Extract<PendingOperation, { readonly type: Type }>,
  'type'
>;

// A definite answer from the provider. A call that throws has no answer yet, so its step retries.
export type ProviderAnswer =
  | { readonly outcome: 'confirmed' }
  | { readonly outcome: 'failed' };

export type AuthorisationAnswer =
  | { readonly outcome: 'confirmed'; readonly providerReference: string }
  | { readonly outcome: 'failed' };

// Each call carries an idempotency key, so a step that runs again moves money once.
export type Provider = {
  readonly authorise: (
    request: OperationOf<'authorisation'> & { readonly paymentId: string },
  ) => Promise<AuthorisationAnswer>;
  readonly capture: (
    request: OperationOf<'capture'>,
  ) => Promise<ProviderAnswer>;
  readonly refund: (request: OperationOf<'refund'>) => Promise<ProviderAnswer>;
  readonly voidAuthorisation: (
    request: OperationOf<'void'>,
  ) => Promise<ProviderAnswer>;
};

export type ResolveOperationsDeps = {
  readonly payments: Pick<PaymentGate, 'execute' | 'readPendingOperations'>;
  readonly provider: Provider;
};

// Another execution answered the operation first, so its answer is already on the stream.
const ALREADY_RESOLVED = 'operations-resolve-once' satisfies InvariantName;

// Triggered by the state table's stream. It resolves every pending operation of each changed payment, so a retried batch converges.
export const makeHandler = (
  deps: ResolveOperationsDeps,
): DurableLambdaHandler =>
  withDurableExecution(
    async (event: unknown, context: DurableContext): Promise<void> => {
      const { paymentIds } = paymentStreamEventSchema.parse(event);

      for (const paymentId of paymentIds) {
        const operations = await context.step(`read ${paymentId}`, () =>
          deps.payments.readPendingOperations(paymentId),
        );

        for (const operation of operations) {
          const name = `${paymentId} ${operationName(operation)}`;
          const command = await context.step(`ask provider ${name}`, () =>
            askProvider(deps.provider, paymentId, operation),
          );
          await context.step(`answer ${name}`, () =>
            answer(deps.payments, paymentId, command),
          );
        }
      }
    },
  );

const operationName = (operation: PendingOperation): string => {
  switch (operation.type) {
    case 'authorisation':
      return 'authorisation';
    case 'capture':
      return `capture ${operation.captureId}`;
    case 'refund':
      return `refund ${operation.refundId}`;
    case 'void':
      return 'void';
    default: {
      const unhandled: never = operation;
      throw new Error(`Unhandled pending operation: ${String(unhandled)}`);
    }
  }
};

const askProvider = async (
  provider: Provider,
  paymentId: string,
  operation: PendingOperation,
): Promise<PaymentCommand> => {
  switch (operation.type) {
    case 'authorisation': {
      const { currency, amount } = operation;
      const result = await provider.authorise({ paymentId, currency, amount });
      return result.outcome === 'confirmed'
        ? {
            type: 'confirm_authorisation',
            providerReference: result.providerReference,
          }
        : { type: 'fail_authorisation' };
    }
    case 'capture': {
      const { captureId, amount, providerReference } = operation;
      const result = await provider.capture({
        captureId,
        amount,
        providerReference,
      });
      return result.outcome === 'confirmed'
        ? { type: 'confirm_capture', captureId }
        : { type: 'fail_capture', captureId };
    }
    case 'refund': {
      const { refundId, amount, providerReference } = operation;
      const result = await provider.refund({
        refundId,
        amount,
        providerReference,
      });
      return result.outcome === 'confirmed'
        ? { type: 'confirm_refund', refundId }
        : { type: 'fail_refund', refundId };
    }
    case 'void': {
      const { providerReference } = operation;
      const result = await provider.voidAuthorisation({ providerReference });
      return result.outcome === 'confirmed'
        ? { type: 'confirm_void' }
        : { type: 'fail_void' };
    }
    default: {
      const unhandled: never = operation;
      throw new Error(`Unhandled pending operation: ${String(unhandled)}`);
    }
  }
};

const answer = (
  payments: Pick<PaymentGate, 'execute'>,
  paymentId: string,
  command: PaymentCommand,
): Promise<void> =>
  payments
    .execute({ paymentId, command, idempotencyKey: undefined })
    .then(() => undefined)
    .catch((error: unknown) => {
      if (
        error instanceof DecisionRejectedError &&
        error.code === ALREADY_RESOLVED
      ) {
        return undefined;
      }
      throw error;
    });
