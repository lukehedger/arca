# Ledger Domain

The system holds money in accounts on an internal ledger. Each account moves through a short lifecycle and its balance can never go below zero. The model keeps the balance as the one quantity that matters and lets only the core change it.

The code is the source of truth. Where this document and the code disagree, this document is stale and must be fixed. The authoritative definitions live in `core/account.ts`.

If a feature cannot be expressed within the model, change the model deliberately and update this document in the same change.

Every name in backticks in the command, event, transition, status and invariant tables must match `core/vocabulary.ts` exactly. The domain drift fitness function fails when a name exists on one side only.

---

## 1. What the domain is

The domain owns accounts and their balances. It does not own customers, payments or currencies. Every movement of money is a command on one account.

### Ubiquitous language

Use these terms exactly. Do not introduce synonyms.

- **Account** - a balance held on the ledger, identified by its account id.
- **Balance** - the whole number of minor units, such as pence, the account holds.
- **Deposit** - a command that adds an amount to the balance.
- **Withdrawal** - a command that takes an amount from the balance.

---

## 2. The data model

### 2.1 The account

<!-- if: event-sourcing -->
An account is an append-only stream of events. Its state is the projection of every event through `evolve`, starting from no account.
<!-- if: crud -->
An account is one record with a status field. Every write is a transition the guard approved, applied with a conditional write on the status and version that were read.
<!-- end -->

### 2.2 State

```ts
type Account =
  | { readonly status: 'open'; readonly balance: number }
  | { readonly status: 'closed'; readonly balance: 0 };
```

The balance is the truth. Only deposits, withdrawals and the close change it.

### 2.3 Integration-specific state

None. The ledger is the only variant.

### 2.4 Immutable context

The account id, fixed when the account opens.

### 2.5 Idempotency

<!-- if: event-sourcing -->
The `Idempotency-Key` header identifies a repeated request. A key the stream already holds returns the current account and appends nothing.
<!-- if: crud -->
CRUD mode keeps no record of handled requests. A repeated request is decided again on the current record.
<!-- end -->

### 2.6 Persistence

<!-- if: event-sourcing -->
| Key | Format             |
| --- | ------------------ |
| PK  | `ACCOUNT#{id}`     |
| SK  | `EVENT#{sequence}` |
<!-- if: crud -->
| Key | Format         |
| --- | -------------- |
| PK  | `ACCOUNT#{id}` |
| SK  | `RECORD`       |
<!-- end -->

The account id is the only access pattern.

### 2.7 Data that is not domain state

None.

---

## 3. The engine

<!-- if: event-sourcing -->
```
Command ──▶ Decider ──▶ Event(s) ──▶ Evolve ──▶ State
```

### 3.1 Commands and events

Commands are imperative and events are past tense. Each approved command produces exactly one event. A rejected command produces none.

| Command          | Event             |
| ---------------- | ----------------- |
| `open_account`   | `account_opened`  |
| `deposit_funds`  | `funds_deposited` |
| `withdraw_funds` | `funds_withdrawn` |
| `close_account`  | `account_closed`  |

### 3.2 Creation

`open_account` is the only command an account that does not exist accepts. It opens the account with a balance of zero.

### 3.3 Decider

`decide(state, command)` returns the events to append or a rejection that names the invariant the command would break. It asserts that every amount is a positive whole number.

### 3.4 Evolve

`evolve(state, event)` applies one event. It asserts the invariants on the state it returns, so the gate appends nothing that breaks one.
<!-- if: crud -->
```
Request ──▶ Guard ──▶ Transition ──▶ Conditional write
```

### 3.1 Transitions

| From   | Action           | To       |
| ------ | ---------------- | -------- |
| (none) | `open_account`   | `open`   |
| `open` | `deposit_funds`  | `open`   |
| `open` | `withdraw_funds` | `open`   |
| `open` | `close_account`  | `closed` |

### 3.2 Guard

`decide(current, command)` returns the next account or a rejection that names the invariant the command would break. It asserts that every amount is a positive whole number and that the next balance is not negative.

### 3.3 Write

The gate writes the next account only when the record still has the status and version it read. A lost race returns a conflict, which the API answers with a 409.
<!-- end -->

---

## 4. Lifecycle statuses

```
open ──▶ closed
```

| Status   | Meaning                                      |
| -------- | -------------------------------------------- |
| `open`   | The account accepts deposits and withdrawals |
| `closed` | The account is empty and accepts nothing     |

`closed` is terminal.

---

## 5. Invariants

| Invariant                 | Meaning                                                 |
| ------------------------- | ------------------------------------------------------- |
| `account-opens-first`     | An account accepts `open_account` first and never again |
| `balance-never-negative`  | No withdrawal takes the balance below zero              |
| `closed-account-is-empty` | An account closes only with a balance of zero           |
| `closed-account-is-final` | A closed account rejects every command                  |

The core enforces every invariant. A rejection names the invariant it protects. `core/tests/account-invariants.test.ts` holds one property per invariant.

---

## 6. The integration boundary

The `ledger` adapter passes the command to the gate unchanged. A new place to hold accounts is a new adapter. The core stays the same.

---

## 7. Contracts with the outside

`POST /accounts/{accountId}/commands` takes `{ "variant": "ledger", "command": { "type": "deposit_funds", "amount": 25 } }` and returns the account. `packages/schema/src/account.ts` defines both shapes. A new optional field is a safe change. Any other change needs a new route.

---

## 8. Checklist for a new feature

- [ ] Does every new name appear in both this document and `core/vocabulary.ts`?
- [ ] Does every new invariant have a property in `core/tests/`?
- [ ] Does the change keep every movement of money inside the core?
