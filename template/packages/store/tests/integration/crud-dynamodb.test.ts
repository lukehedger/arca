// if: crud
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  createDocumentClient,
  createDynamoDbRecordStore,
} from '../../index.ts';
import {
  type ContractRecord,
  describeRecordStoreContract,
} from '../contract/record-store.ts';
import { requiredEnv } from './env.ts';

const contractRecordSchema = z.object({
  status: z.enum(['open', 'closed']),
  count: z.number(),
});

const client = createDocumentClient();
const tableName = requiredEnv('STATE_TABLE_NAME');

describeRecordStoreContract('DynamoDB', {
  createStore: () =>
    createDynamoDbRecordStore<ContractRecord>({
      client,
      tableName,
      entity: 'CONTRACT',
      clock: () => new Date(),
      parseValue: (value) => contractRecordSchema.parse(value),
    }),
  newRecordId: () => randomUUID(),
});
// end
