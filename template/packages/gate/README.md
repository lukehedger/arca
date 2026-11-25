# Gate

The only path for a state change. The gate loads the current state from the store, passes the state and the command to the core's pure decision function and persists an approved decision with a conditional write. It returns a rejection unchanged and does no I/O between the read and the write.

The gate is generic over the core's State, Command, Event and Rejection types. It takes the core's functions as arguments, so the core needs no knowledge of the gate. The core returns a value of the shape below and declares that shape itself, because it imports no other package.

Each call returns one of these outcomes. Nothing is thrown except store failures.

- `approved` - the decision is persisted. Carries the new state.
- `rejected` - the core refused the command. Carries the core's rejection as it was returned.
- `conflict` - another write landed between the read and the write, so nothing was persisted. The caller may retry, which decides again on fresh state.
<!-- if: event-sourcing -->
- `replayed` - the stream already holds the idempotency key, so nothing was appended. Carries the current state.
<!-- end -->

Bind the gate once per entity, such as in `order.ts`. The binding is what handlers call. It raises `rejected` as a `DecisionRejectedError` and `conflict` as a `ConflictError`, so a handler maps every outcome through the errors package. It is also where the shell adds a fact from an external system to the command, before the gate reads the state.

## Public API

<!-- if: event-sourcing -->
- `createEventSourcedGate({ eventLog, initialState, decide, evolve })` - returns `apply({ streamId, command, idempotencyKey })` and `load(streamId)`. State is the replay of every event through `evolve` from `initialState`. `load` returns `undefined` for an empty stream.
- `Decision<Event, Rejection>` - what `decide` returns: `{ outcome: 'approved', events }` or `{ outcome: 'rejected', rejection }`.
- `EventSourcedCommand`, `EventSourcedResult`, `EventSourcedGate`, `EventSourcedGateDeps` - the types around them.

`apply` projects the new state before it appends the events. An event that fails a core assertion in `evolve` throws there, so the stream never holds it.
<!-- if: crud -->
- `createRecordGate({ recordStore, decide })` - returns `apply({ id, command })` and `load(id)`. `decide` receives `undefined` when no record exists. The write is conditional on the status and version that were read.
- `Transition<State, Rejection>` - what `decide` returns: `{ outcome: 'approved', state }` or `{ outcome: 'rejected', rejection }`.
- `RecordCommand`, `RecordResult`, `RecordGate`, `RecordGateDeps` - the types around them.
<!-- end -->

<!-- if: event-sourcing -->
## Example

```ts
import { decide, evolve, initialState } from '@<project>/core';
import { ConflictError, DecisionRejectedError } from '@<project>/errors';
import { createEventSourcedGate } from '@<project>/gate';

const gate = createEventSourcedGate({ eventLog, initialState, decide, evolve });

const result = await gate.apply({
  streamId: 'order-1',
  command: { type: 'place_order' },
  idempotencyKey: request.idempotencyKey,
});
if (result.outcome === 'rejected') {
  const { invariant } = result.rejection;
  throw new DecisionRejectedError(invariant, `The command would break the ${invariant} rule`);
}
if (result.outcome === 'conflict') {
  throw new ConflictError('Order order-1 changed during the request. Retry it.');
}
```
<!-- end -->
