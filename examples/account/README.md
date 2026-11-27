# Account example

A vertical slice through every layer of the request pipeline, for both persistence modes: a ledger account that opens, takes deposits and withdrawals and closes. `scripts/test-bootstrap.ts` lays it over each bootstrapped profile and runs every check against it. Bootstrapping uses it as the reference shape for the core.

| Layer   | Files                                                                         |
| ------- | ----------------------------------------------------------------------------- |
| Domain  | `DOMAIN.md`, `core/vocabulary.ts`                                             |
| Core    | `core/account.ts`, with the examples and one property per invariant           |
| Gate    | `packages/gate/account.ts` binds the core to the store for commands and reads |
| Schema  | `packages/schema/account.ts` parses a request into `AccountCommand` or a read |
| Handler | `api/accounts/execute-command.ts` and `api/accounts/read-account.ts`          |

The files use the same conditional blocks and placeholders as `template/`.
