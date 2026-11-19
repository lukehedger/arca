import { classifyError, type ErrorClassification } from './classify-error.ts';
import type { ErrorBody } from './error-body.ts';

// Assignable to APIGatewayProxyResult, so a handler returns it as is.
export type ErrorResponse = {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
};

// Telemetry sees only the response, so it looks up the classification here. The response body never carries it.
const classifications = new WeakMap<object, ErrorClassification>();

// Pass the request id as the errorId so a caller's report leads straight to the invocation's wide event.
export const mapErrorToResponse = (
  error: unknown,
  errorId: string,
): ErrorResponse => {
  const classification = classifyError(error);
  const { statusCode, code, message } = classification;
  const body: ErrorBody = { errorId, code, message };
  const response: ErrorResponse = {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
  classifications.set(response, classification);

  return response;
};

export const classificationOf = (
  response: object,
): ErrorClassification | undefined => classifications.get(response);
