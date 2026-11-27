import { describe, expect, test } from 'bun:test';
import {
  ConflictError,
  classificationOf,
  errorBodySchema,
} from '@<project>/errors';
import { z } from 'zod';
import { createApiHandler } from '../index.ts';
import { apiEvent, lambdaContext } from './api-event.ts';

type Widget = { readonly colour: string };

const widgetEventSchema = z
  .object({ pathParameters: z.object({ widgetId: z.string().min(3) }) })
  .transform(({ pathParameters }) => pathParameters);

const widgetResponseSchema = z.strictObject({
  widgetId: z.string(),
  colour: z.string().min(1),
});

const readWidget = (widgetId: string) =>
  apiEvent({
    httpMethod: 'GET',
    resource: '/widgets/{widgetId}',
    pathParameters: { widgetId },
  });

const handlerCalling = (
  call: (input: { readonly widgetId: string }) => Promise<Widget>,
) =>
  createApiHandler({
    request: widgetEventSchema,
    call,
    response: widgetResponseSchema,
    respond: (widget, { widgetId }) => ({ widgetId, ...widget }),
  });

const errorBodyOf = (body: string) => errorBodySchema.parse(JSON.parse(body));

describe('createApiHandler', () => {
  test('passes the parsed request to the call and returns the parsed response', async () => {
    const received: unknown[] = [];
    const handler = handlerCalling(async (input) => {
      received.push(input);
      return { colour: 'red' };
    });

    const response = await handler(readWidget('w-1'), lambdaContext);

    expect(received).toEqual([{ widgetId: 'w-1' }]);
    expect(response.statusCode).toBe(200);
    expect(response.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(response.body)).toEqual({
      widgetId: 'w-1',
      colour: 'red',
    });
  });

  test('answers 400 without calling when the request fails its schema', async () => {
    const received: unknown[] = [];
    const handler = handlerCalling(async (input) => {
      received.push(input);
      return { colour: 'red' };
    });

    const response = await handler(readWidget('w'), lambdaContext);

    expect(response.statusCode).toBe(400);
    expect(errorBodyOf(response.body).code).toBe('ValidationError');
    expect(received).toEqual([]);
  });

  test('maps an error from the call through the errors package', async () => {
    const handler = handlerCalling(async () => {
      throw new ConflictError('Widget w-1 changed during the request');
    });

    const response = await handler(readWidget('w-1'), lambdaContext);

    expect(response.statusCode).toBe(409);
    expect(errorBodyOf(response.body)).toEqual({
      errorId: 'lambda-request-1',
      code: 'Conflict',
      message: 'Widget w-1 changed during the request',
    });
  });

  test('answers 500 as a failed assertion when the response breaks its schema', async () => {
    // The types allow an empty colour, so only the response schema can refuse it.
    const handler = handlerCalling(async () => ({ colour: '' }));

    const response = await handler(readWidget('w-1'), lambdaContext);

    expect(response.statusCode).toBe(500);
    expect(errorBodyOf(response.body).code).toBe('InternalError');
    expect(classificationOf(response)?.outcome).toBe('assertion_failed');
  });
});
