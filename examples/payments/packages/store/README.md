# Store

Persistence for domain state. Each mode has an interface, a DynamoDB single-table implementation and an in-memory implementation for tests. The store knows nothing of the core. It stores the values it is given and parses what it reads with the function it is given. Only the gate calls it.

Every write is conditional. A write that loses a race returns `{ outcome: 'conflict' }` instead of overwriting. Any other failure is thrown.

## Key layout

| PK           | SK                                    |
| ------------ | ------------------------------------- |
| `PAYMENT#id` | `EVENT#<sequence>`, zero-padded to 12 |

An event row holds `sequence`, `recordedAt`, `idempotencyKey` and `event`.

## Contract

Every implementation passes the same contract suite in `tests/contract/`. The in-memory implementation runs it in the unit tests. The suite includes two concurrent conditional writes at the same version: exactly one wins and the other returns a conflict. A change that lets both succeed fails the suite.

## Public API

- `createDocumentClient()` - the DynamoDB document client every implementation takes. It drops undefined fields when it marshals an item.
- `EventLog<Event>` - `read(streamId)` returns the stream and its version. `append(streamId, { expectedVersion, idempotencyKey, events })` appends only when the stream is still at `expectedVersion`.
- `createDynamoDbEventLog(deps)` - appends one event with a conditional put and several with one transaction of up to 100 events.
- `createInMemoryEventLog(deps)` - the same contract in memory.
- `EventStream`, `StoredEvent`, `Append`, `AppendResult`, `EventLogClient` - the types around them.

## Example

```ts
import { createDocumentClient, createDynamoDbEventLog } from '@payments/store';

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
