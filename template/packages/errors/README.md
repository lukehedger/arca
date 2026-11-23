# @<project>/errors

One error class per kind of failure and the one place that maps them to API responses. This package is a leaf: it imports no other workspace package.

## Public API

- `ValidationError(issues)` - the request failed its schema. 400. Takes Zod issues as they are and keeps them on the error for telemetry. The response never includes them, because they would tell a caller the expected request format.
- `NotFoundError(message)` - the requested entity does not exist. 404.
- `CapabilityNotSupportedError(variant, capability)` - the variant's adapter does not offer the capability. 422. The router raises it.
- `ConflictError(message)` - another write changed the state after the gate read it, so nothing was persisted. 409. The caller may retry.
- `DecisionRejectedError(code, message)` - the core rejected the command. 422 with the rejection code.
- `IntegrationError(integration, options)` - an external system failed. 502. The public message never names the integration or the cause.
- `classifyError(error)` - the status, public code, public message and telemetry `outcome` (`client_error`, `server_error`, `timeout` or `assertion_failed`) for any thrown value. Anything unrecognised is a 500 with a generic message. A failed core assertion is a 500 with the same generic message and the `assertion_failed` outcome.
- `isAssertionFailure(error)` - whether the value is an `AssertionError`. It matches the name, because this leaf cannot import the core.
- `mapErrorToResponse(error, errorId)` - an `APIGatewayProxyResult`-shaped JSON response built from `classifyError`.
- `classificationOf(response)` - the classification behind a response that `mapErrorToResponse` built, or `undefined` for any other response. Telemetry reads it, so the wide event records the outcome that the status alone cannot show. Return the response as it is: a copy has no classification.
- `errorBodySchema` - the schema of every error response body. `ErrorBody` is inferred from it.
- `ErrorClassification`, `ErrorOutcome`, `ErrorResponse`, `ValidationIssue` - the types of the values above.

A new kind of failure needs a class in `errors.ts` and one branch in `classifyError`.

## Example

```ts
import { classifyError, mapErrorToResponse } from '@<project>/errors';

export const makeHandler = (deps: Deps) => async (event, context) => {
  try {
    return await createOrder(deps, event);
  } catch (error: unknown) {
    deps.telemetry.record({ outcome: classifyError(error).outcome });
    return mapErrorToResponse(error, context.awsRequestId);
  }
};
```
