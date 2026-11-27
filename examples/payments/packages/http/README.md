# HTTP

Turns a route declaration into an API Gateway handler. Every sync route runs the same steps, so a handler declares only what differs between routes and has nowhere to put business logic.

`createApiHandler` runs each request in four steps:

1. It parses the whole API Gateway event against the request schema. A failure answers 400 through the errors package and calls nothing.
2. It calls the gate with the parsed input.
3. It builds the body from the result with `respond` and parses it against the response schema. A body that breaks its schema can only come from a bug, so it throws an `AssertionError`. The errors package answers 500 and classifies it as `assertion_failed`, which raises the assertion alarm.
4. It answers 200 with the JSON body. Every error from the call goes through `mapErrorToResponse`.

Telemetry stays outside the factory. Wrap the handler with `instrument` where the Lambda entry point builds it.

## Public API

- `createApiHandler({ request, call, response, respond })` - returns an `ApiHandler`.
  - `request` - a schema that parses the API Gateway event into the call's input.
  - `call` - the gate method the route runs, such as `execute` for a command or `read` for a read.
  - `response` - the schema of the body that leaves the system.
  - `respond(result, input)` - builds the body from the call's result and the parsed input.
- `ApiRoute<Input, Result, Body>` - the type of the declaration.

A route that needs a status other than 200, a header such as `Location` or a body that is not JSON extends this factory. Do not write the handler by hand.

## Example

```ts
import type { OrderGate } from '@payments/gate';
import { createApiHandler } from '@payments/http';
import { orderResponseSchema, readOrderEventSchema } from '@payments/schema';
import type { ApiHandler } from '@payments/telemetry';

export type ReadOrderDeps = { readonly orders: Pick<OrderGate, 'read'> };

// GET /orders/{orderId}
export const makeHandler = (deps: ReadOrderDeps): ApiHandler =>
  createApiHandler({
    request: readOrderEventSchema,
    call: ({ orderId }) => deps.orders.read(orderId),
    response: orderResponseSchema,
    respond: (order, { orderId }) => ({ orderId, ...order }),
  });
```
