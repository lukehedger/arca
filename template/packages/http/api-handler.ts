import { AssertionError } from 'node:assert';
import { mapErrorToResponse, ValidationError } from '@<project>/errors';
import type { ApiHandler } from '@<project>/telemetry';
import type { z } from 'zod';

export type ApiRoute<Input, Result, Body> = {
  // Parses the whole API Gateway event, so a bad path, header or body is one validation error.
  readonly request: z.ZodType<Input>;
  readonly call: (input: Input) => Promise<Result>;
  readonly response: z.ZodType<Body>;
  readonly respond: (result: Result, input: Input) => Body;
};

const JSON_HEADERS = { 'content-type': 'application/json' } as const;

export const createApiHandler =
  <Input, Result, Body>(route: ApiRoute<Input, Result, Body>): ApiHandler =>
  async (event, context) => {
    const parsed = route.request.safeParse(event);
    if (!parsed.success) {
      return mapErrorToResponse(
        new ValidationError(parsed.error.issues),
        context.awsRequestId,
      );
    }

    return route
      .call(parsed.data)
      .then((result) => ({
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(serialise(route, result, parsed.data)),
      }))
      .catch((error: unknown) =>
        mapErrorToResponse(error, context.awsRequestId),
      );
  };

// Only a bug can build a body that breaks its own schema, so it raises the assertion alarm instead of a client error.
const serialise = <Input, Result, Body>(
  route: ApiRoute<Input, Result, Body>,
  result: Result,
  input: Input,
): Body => {
  const body = route.response.safeParse(route.respond(result, input));
  if (!body.success) {
    throw new AssertionError({ message: 'Response breaks its schema' });
  }

  return body.data;
};
