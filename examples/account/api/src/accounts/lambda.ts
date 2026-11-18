import { createAppRouter } from '@<project>/router';
import { createTelemetry, instrument } from '@<project>/telemetry';
import { makeHandler, routeAccountCommands } from './handler.ts';

const tableName = process.env.STATE_TABLE_NAME;
if (tableName === undefined) {
  throw new Error('STATE_TABLE_NAME is not set on the accounts function');
}

// Built once per container, so warm invocations reuse the DynamoDB client.
export const handler = instrument(
  createTelemetry({ serviceName: 'accounts', namespace: '<project>' }),
  makeHandler(routeAccountCommands(createAppRouter({ tableName }))),
);
