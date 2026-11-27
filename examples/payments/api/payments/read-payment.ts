import type { PaymentGate } from '@payments/gate';
import { createApiHandler } from '@payments/http';
import {
  paymentResponseSchema,
  readPaymentEventSchema,
} from '@payments/schema';
import type { ApiHandler } from '@payments/telemetry';

export type ReadPaymentDeps = {
  readonly payments: Pick<PaymentGate, 'read'>;
};

// GET /payments/{paymentId}
export const makeHandler = (deps: ReadPaymentDeps): ApiHandler =>
  createApiHandler({
    request: readPaymentEventSchema,
    call: ({ paymentId }) => deps.payments.read(paymentId),
    response: paymentResponseSchema,
    respond: (payment, { paymentId }) => ({ paymentId, ...payment }),
  });
