import { mapErrorToResponse, ValidationError } from '@<project>/errors';
import type { AppRouter } from '@<project>/router';
import {
  type AccountCommandRequest,
  type AccountResponse,
  executeAccountCommandEventSchema,
  type Variant,
} from '@<project>/schema';
import type { ApiHandler } from '@<project>/telemetry';

export type AccountsHandlerDeps = {
  readonly executeCommand: (
    variant: Variant,
    request: AccountCommandRequest,
  ) => Promise<AccountResponse>;
};

const JSON_HEADERS = { 'content-type': 'application/json' } as const;

export const routeAccountCommands = (
  router: AppRouter,
): AccountsHandlerDeps => ({
  executeCommand: (variant, request) =>
    router.invoke(variant, 'executeCommand', request),
});

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

    const { variant, request } = parsed.data;
    return deps
      .executeCommand(variant, request)
      .then((account) => ({
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(account),
      }))
      .catch((error: unknown) =>
        mapErrorToResponse(error, context.awsRequestId),
      );
  };
