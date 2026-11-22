// if: event-sourcing
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  createDocumentClient,
  createDynamoDbEventLog,
} from '../../index.ts';
import {
  type ContractEvent,
  describeEventLogContract,
} from '../contract/event-log.ts';
import { requiredEnv } from './env.ts';

const contractEventSchema = z.object({
  type: z.literal('incremented'),
  by: z.number(),
});

const client = createDocumentClient();
const tableName = requiredEnv('STATE_TABLE_NAME');

describeEventLogContract('DynamoDB', {
  createLog: () =>
    createDynamoDbEventLog<ContractEvent>({
      client,
      tableName,
      entity: 'CONTRACT',
      clock: () => new Date(),
      parseEvent: (value) => contractEventSchema.parse(value),
    }),
  newStreamId: () => randomUUID(),
});
// end
