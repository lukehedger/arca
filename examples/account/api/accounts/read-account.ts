import type { AccountGate } from '@<project>/gate';
import { createApiHandler } from '@<project>/http';
import {
  accountResponseSchema,
  readAccountEventSchema,
} from '@<project>/schema';
import type { ApiHandler } from '@<project>/telemetry';

export type ReadAccountDeps = {
  readonly accounts: Pick<AccountGate, 'read'>;
};

// GET /accounts/{accountId}
export const makeHandler = (deps: ReadAccountDeps): ApiHandler =>
  createApiHandler({
    request: readAccountEventSchema,
    call: ({ accountId }) => deps.accounts.read(accountId),
    response: accountResponseSchema,
    respond: (account, { accountId }) => ({ accountId, ...account }),
  });
