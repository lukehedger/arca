# Account example

A vertical slice through every layer of the request pipeline, for both persistence modes: a ledger account that opens, takes deposits and withdrawals and closes. `scripts/test-bootstrap.ts` lays it over each bootstrapped profile and runs every check against it. Bootstrapping uses it as the reference shape for the core.

| Layer       | Files                                                                         |
| ----------- | ----------------------------------------------------------------------------- |
| Domain      | `DOMAIN.md`, `core/src/vocabulary.ts`                                         |
| Core        | `core/src/account.ts`, with the examples and one property per invariant       |
| Gate        | `packages/gate/src/account.ts` binds the core to the store                    |
| Schema      | `packages/schema/src/account.ts`                                              |
| Adapter     | `packages/adapters/src/ledger.ts` and `context.ts`                            |
| Router      | `packages/router/src/registry.ts` and `app-router.ts`                         |
| Handler     | `api/src/accounts/handler.ts`                                                 |
| Integration | `api/tests/integration/accounts.test.ts` runs the real chain against DynamoDB |

The files use the same conditional blocks and placeholders as `template/`.
