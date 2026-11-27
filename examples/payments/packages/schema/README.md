# @payments/schema

Zod schemas for every request and response shape. Each schema gives the compile-time type through `z.infer`, the runtime validation and the OpenAPI spec. A request schema parses straight into the core's command, so this package imports the core's types and no other workspace package.

## Public API

- `jsonBody(schema)` - wraps a schema so it parses a raw request body as JSON before it validates it. A missing or malformed body fails with a validation issue like any other.
- `Same<A, B>` - `true` when `A` and `B` accept the same values, otherwise `false`.
- `Assert<T>` - compiles only when `T` is `true`. `Assert<Same<z.infer<typeof schema>, Command>>` ties a command schema to the core's command type, so a command on one side only fails the type check.

## Example

```ts
import type { OrderCommand } from '@payments/core';
import { type Assert, jsonBody, type Same } from '@payments/schema';
import { z } from 'zod';

export const orderCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('place_order'),
    quantity: z.number().int().positive(),
  }),
  z.strictObject({ type: z.literal('cancel_order') }),
]);

export type OrderCommandMatchesCore = Assert<
  Same<z.infer<typeof orderCommandSchema>, OrderCommand>
>;

const result = jsonBody(orderCommandSchema).safeParse(event.body);
if (!result.success) throw new ValidationError(result.error.issues);
```
