# Payments Domain

The system takes a card payment from authorisation to capture, refund or void against an external payment service provider. A payment holds one authorisation and any number of partial captures and refunds. The model keeps the capture and refund records as the truth about money. The core approves every movement of money before the provider sees it.

The code is the source of truth. Where this document and the code disagree, this document is stale and must be fixed. The authoritative definitions live in `core/payment.ts`.

If a feature cannot be expressed within the model, change the model deliberately and update this document in the same change.

Every name in backticks in the command, event, transition, status and invariant tables must match `core/vocabulary.ts` exactly. The domain drift fitness function fails when a name exists on one side only.

---

## 1. What the domain is

The domain owns card payments and the money that moves on them. It does not own orders, customers, card details or currency conversion. The provider holds the card details. Every movement of money is a command on one payment. The core approves that command before the provider sees it.

### Ubiquitous language

Use these terms exactly. Do not introduce synonyms.

- **Payment** - one card payment, identified by its payment id. It holds one authorisation with its captures and refunds.
- **Provider** - the external payment service provider. It holds the card authorisation and moves the money.
- **Authorisation** - the hold of an amount on the card by the provider.
- **Capture** - a request to take part or all of the authorised amount, identified by its capture id.
- **Refund** - a request to return part or all of the captured amount, identified by its refund id.
- **Void** - a request to release the part of the authorisation not yet captured.
- **Amount** - a whole number of minor units, such as pence, in the currency of the payment.
- **Pending** - requested, but not yet confirmed or failed by the provider.

---

## 2. The data model

### 2.1 The payment

A payment is an append-only stream of events. Its state is the projection of every event through `evolve`, starting from no payment.

### 2.2 State

```ts
type Operation = {
  readonly amount: number;
  readonly status: 'pending' | 'confirmed' | 'failed';
};

type Payment =
  | {
      readonly status: 'authorising';
      readonly currency: string;
      readonly amount: number;
    }
  | {
      readonly status: 'declined';
      readonly currency: string;
      readonly amount: number;
    }
  | {
      readonly status: 'authorised' | 'voiding' | 'voided';
      readonly currency: string;
      readonly amount: number;
      readonly providerReference: string;
      readonly captures: Readonly<Record<string, Operation>>;
      readonly refunds: Readonly<Record<string, Operation>>;
    };
```

The capture and refund records are the truth about money. The captured amount is the sum of the confirmed captures. The refunded amount is the sum of the confirmed refunds. Only `capture_confirmed` and `refund_confirmed` change them.

Each capture and refund is a record with its own status. A record starts `pending`. The provider answer moves it to `confirmed` or `failed`. A pending record counts against the limits in section 5. A failed record counts against nothing.

### 2.3 Immutable context

The payment id, the currency as an ISO 4217 code and the authorised amount. `request_authorisation` fixes all three.

### 2.4 Idempotency

The `Idempotency-Key` header identifies a repeated request. A key the stream already holds returns the current payment and appends nothing.

The caller supplies the capture id and the refund id. The handler sends each one to the provider as the provider idempotency key. A retried provider call therefore moves money once.

### 2.5 Persistence

| Key | Format             |
| --- | ------------------ |
| PK  | `PAYMENT#{id}`     |
| SK  | `EVENT#{sequence}` |

The payment id is the only access pattern.

### 2.7 Data that is not domain state

None.

---

## 3. The engine

```
Command ──▶ Decider ──▶ Event(s) ──▶ Evolve ──▶ State
```

### 3.1 Commands and events

Commands are imperative and events are past tense. Every operation follows three phases: request, confirm and fail. Each approved command produces exactly one event. A rejected command produces none.

| Command                 | Event                     |
| ----------------------- | ------------------------- |
| `request_authorisation` | `authorisation_requested` |
| `confirm_authorisation` | `authorisation_confirmed` |
| `fail_authorisation`    | `authorisation_failed`    |
| `request_capture`       | `capture_requested`       |
| `confirm_capture`       | `capture_confirmed`       |
| `fail_capture`          | `capture_failed`          |
| `request_refund`        | `refund_requested`        |
| `confirm_refund`        | `refund_confirmed`        |
| `fail_refund`           | `refund_failed`           |
| `request_void`          | `void_requested`          |
| `confirm_void`          | `void_confirmed`          |
| `fail_void`             | `void_failed`             |

### 3.2 Creation

`request_authorisation` is the only command a payment that does not exist accepts. It fixes the currency and the authorised amount. The payment starts `authorising`.

### 3.3 Decider

`decide(state, command)` returns the events to append or a rejection that names the invariant the command would break. It asserts that every amount is a positive whole number and that the currency is three upper-case letters.

### 3.4 Evolve

`evolve(state, event)` applies one event. It asserts the invariants on the state it returns, so the gate appends nothing that breaks one.

### 3.5 Features

None.

---

## 4. Lifecycle statuses

```
authorising ──▶ authorised ──▶ voiding ──▶ voided
     │               ▲            │
     ▼               └────────────┘
  declined
```

| Status        | Meaning                                                    |
| ------------- | ---------------------------------------------------------- |
| `authorising` | The provider has not answered the authorisation            |
| `authorised`  | The payment accepts captures, refunds and a void           |
| `declined`    | The provider refused the authorisation                     |
| `voiding`     | The void is pending and the payment accepts no new capture |
| `voided`      | The provider released the rest of the authorisation        |

`declined` is terminal. `voided` accepts only refunds of captured money and their answers. `fail_void` returns the payment to `authorised`. A failed capture or refund changes no status. Fully captured and fully refunded are quantities, not statuses.

---

## 5. Invariants

| Invariant                        | Meaning                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| `payment-authorises-first`       | A payment accepts `request_authorisation` first and never again                    |
| `declined-payment-is-final`      | A declined payment rejects every command                                           |
| `captures-only-while-authorised` | A capture is requested only while the payment is `authorised`                      |
| `captures-within-authorisation`  | Pending and confirmed captures never exceed the authorised amount                  |
| `refunds-within-captures`        | Pending and confirmed refunds never exceed the captured amount                     |
| `void-waits-for-captures`        | A void is requested only while the payment is `authorised` with no pending capture |
| `operation-ids-are-unique`       | A capture id or refund id names one operation on the payment                       |
| `operations-resolve-once`        | A confirm or fail resolves only a pending authorisation, capture, refund or void   |

The core enforces every invariant. A rejection names the invariant it protects. `core/tests/payment-invariants.test.ts` holds one property per invariant.

No invariant spans more than one payment, so the conditional write on each payment holds every invariant.

---

## 6. External systems

No command needs a fact from outside before its decision.

Each request event is followed by one call to the provider in the same HTTP request:

- `authorisation_requested` - the handler asks the provider to authorise the amount.
- `capture_requested` - the handler asks the provider to capture the amount against the provider reference. It sends the capture id as the idempotency key.
- `refund_requested` - the handler asks the provider to refund the amount. It sends the refund id as the idempotency key.
- `void_requested` - the handler asks the provider to release the rest of the authorisation.

The handler then sends the matching confirm or fail command through the core, on the same path as every other write. `confirm_authorisation` carries the provider reference.

No inbound callback reaches the payment.

Open questions:

- Which provider does the system use? The answer names its API and its error taxonomy.
- A provider timeout leaves an operation pending. Reconciliation is not designed yet.

---

## 7. Contracts with the outside

`POST /payments/{paymentId}/commands` takes `{ "command": { "type": "request_capture", "captureId": "capture-1", "amount": 500 } }` and returns the payment.

The public schema accepts only the four request commands. Only the handler issues confirm and fail commands, after the provider answers. No caller can therefore confirm money the provider did not move.

`packages/schema/payment.ts` defines both shapes. A new optional field is a safe change. Any other change needs a new route.

---

## 8. Checklist for a new feature

- [ ] Does every new name appear in both this document and `core/vocabulary.ts`?
- [ ] Does every new invariant have a property in `core/tests/`?
- [ ] Does the core approve every movement of money before the provider sees it?
- [ ] Does the public API still accept only request commands?
- [ ] Does every provider call send the operation id as its idempotency key?
