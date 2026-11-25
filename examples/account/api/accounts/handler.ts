import { mapErrorToResponse, ValidationError } from '@<project>/errors';
import type { AccountGate } from '@<project>/gate';
import {
  type AccountResponse,
  executeAccountCommandEventSchema,
} from '@<project>/schema';
import type { ApiHandler } from '@<project>/telemetry';

export type AccountsHandlerDeps = { readonly accounts: AccountGate };

const JSON_HEADERS = { 'content-type': 'application/json' } as const;

// POST /accounts/{accountId}/commands
export const makeHandler =
  (deps: AccountsHandlerDeps): ApiHandler =>
  async (event, context) => {
    const parsed = executeAccountCommandEventSchema.safeParse(event);
    if (!parsed.success) {
      return mapErrorToResponse(
        new ValidationError(parsed.error.issues),
        context.awsRequestId,
      );
    }

    const { accountId } = parsed.data;
    return deps.accounts
      .execute(parsed.data)
      .then((account) => {
        const body: AccountResponse = { accountId, ...account };
        return {
          statusCode: 200,
          headers: JSON_HEADERS,
          body: JSON.stringify(body),
        };
      })
      .catch((error: unknown) =>
        mapErrorToResponse(error, context.awsRequestId),
      );
  };
