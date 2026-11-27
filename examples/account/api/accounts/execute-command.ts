import type { AccountGate } from '@<project>/gate';
import { createApiHandler } from '@<project>/http';
import {
  accountResponseSchema,
  executeAccountCommandEventSchema,
} from '@<project>/schema';
import type { ApiHandler } from '@<project>/telemetry';

export type ExecuteCommandDeps = {
  readonly accounts: Pick<AccountGate, 'execute'>;
};

// POST /accounts/{accountId}/commands
export const makeHandler = (deps: ExecuteCommandDeps): ApiHandler =>
  createApiHandler({
    request: executeAccountCommandEventSchema,
    call: (input) => deps.accounts.execute(input),
    response: accountResponseSchema,
    respond: (account, { accountId }) => ({ accountId, ...account }),
  });
