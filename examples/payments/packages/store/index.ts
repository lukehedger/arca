// biome-ignore-all assist/source/organizeImports: sorting would move exports across the mode markers.
export { createDocumentClient } from './client.ts';
export type {
  Append,
  AppendResult,
  EventLog,
  EventStream,
  InMemoryEventLogDeps,
  StoredEvent,
} from './event-sourcing.ts';
export { createInMemoryEventLog } from './event-sourcing.ts';
export type {
  DynamoDbEventLogDeps,
  EventLogClient,
} from './event-sourcing-dynamodb.ts';
export { createDynamoDbEventLog } from './event-sourcing-dynamodb.ts';
