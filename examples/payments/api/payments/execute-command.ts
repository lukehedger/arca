import type { PaymentGate } from '@payments/gate';
import { createApiHandler } from '@payments/http';
import {
  executePaymentCommandEventSchema,
  paymentResponseSchema,
} from '@payments/schema';
import type { ApiHandler } from '@payments/telemetry';

export type ExecuteCommandDeps = {
  readonly payments: Pick<PaymentGate, 'execute'>;
};

// POST /payments/{paymentId}/commands
export const makeHandler = (deps: ExecuteCommandDeps): ApiHandler =>
  createApiHandler({
    request: executePaymentCommandEventSchema,
    call: (input) => deps.payments.execute(input),
    response: paymentResponseSchema,
    respond: (payment, { paymentId }) => ({ paymentId, ...payment }),
  });
