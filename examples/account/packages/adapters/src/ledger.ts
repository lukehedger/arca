import { ConflictError, DecisionRejectedError } from '@<project>/errors';
import type { AccountGate } from '@<project>/gate';
import type { Adapter } from './index.ts';

type LedgerContext = { readonly accounts: AccountGate };

// Accounts held on the internal ledger. The command reaches the core unchanged.
export const ledger: Adapter<LedgerContext> = {
  buildContext: async (deps) => ({ accounts: deps.accounts }),
  capabilities: {
    executeCommand: async (context, request) => {
      const result = await context.accounts.execute({
        accountId: request.accountId,
        command: request.command,
        idempotencyKey: request.idempotencyKey,
      });

      switch (result.outcome) {
        case 'applied':
          return {
            accountId: request.accountId,
            status: result.account.status,
            balance: result.account.balance,
          };
        case 'rejected':
          throw new DecisionRejectedError(
            result.rejection.invariant,
            `The command would break the ${result.rejection.invariant} rule`,
          );
        case 'conflict':
          throw new ConflictError(
            `Account ${request.accountId} changed during the request. Retry it.`,
          );
        default: {
          const unhandled: never = result;
          throw new Error(`Unhandled account result ${String(unhandled)}`);
        }
      }
    },
  },
};
