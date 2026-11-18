# Store

Persistence for domain state. Each mode has an interface, a DynamoDB single-table implementation and an in-memory implementation for tests. The store knows nothing of the core. It stores the values it is given and parses what it reads with the function it is given. Only the gate calls it.

Every write is conditional. A write that loses a race returns `{ outcome: 'conflict' }` instead of overwriting. Any other failure is thrown.

## Key layout

<!-- if: event-sourcing -->
| PK            | SK                                    |
| ------------- | ------------------------------------- |
| `<ENTITY>#id` | `EVENT#<sequence>`, zero-padded to 12 |

An event row holds `sequence`, `recordedAt`, `idempotencyKey` and `event`.
<!-- if: crud -->
| PK            | SK       |
| ------------- | -------- |
| `<ENTITY>#id` | `RECORD` |

A record row holds `status`, `version`, `updatedAt` and `value`. The status sits beside the value so the write condition can read it.
<!-- end -->

## Contract

Every implementation passes the same contract suite in `tests/contract/`. The in-memory implementation runs it in the unit tests. DynamoDB runs it in `tests/integration/` against the table of a disposable environment, through `bun env:test`. The suite includes two concurrent conditional writes at the same version: exactly one wins and the other returns a conflict. A change that lets both succeed fails the suite.

## Public API

- `createDocumentClient()` - the DynamoDB document client every implementation takes. It drops undefined fields when it marshals an item.
<!-- if: event-sourcing -->
- `EventLog<Event>` - `read(streamId)` returns the stream and its version. `append(streamId, { expectedVersion, idempotencyKey, events })` appends only when the stream is still at `expectedVersion`.
- `createDynamoDbEventLog(deps)` - appends one event with a conditional put and several with one transaction of up to 100 events.
- `createInMemoryEventLog(deps)` - the same contract in memory.
- `EventStream`, `StoredEvent`, `Append`, `AppendResult`, `EventLogClient` - the types around them.
<!-- if: crud -->
- `RecordStore<Value>` - `read(id)` returns the record and its version. `write(id, value, expected)` writes only when the record still has the expected status and version. An `expected` of `undefined` creates the record and fails if it exists.
- `createDynamoDbRecordStore(deps)` - a conditional put on the status and version.
- `createInMemoryRecordStore(deps)` - the same contract in memory.
- `StoredRecord`, `ExpectedRecord`, `WriteResult`, `StatusRecord`, `RecordStoreClient` - the types around them.
<!-- end -->

<!-- if: event-sourcing -->
## Example

```ts
import { createDocumentClient, createDynamoDbEventLog } from '@<project>/store';

const eventLog = createDynamoDbEventLog({
  client: createDocumentClient(),
  tableName: 'state-table',
  entity: 'ORDER',
  clock: () => new Date(),
  parseEvent: (value) => orderEventSchema.parse(value),
});

const { version } = await eventLog.read('order-1');
const result = await eventLog.append('order-1', {
  expectedVersion: version,
  idempotencyKey: 'request-1',
  events: [{ type: 'order_placed' }],
});
```
<!-- end -->
