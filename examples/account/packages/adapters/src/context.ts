import { createDynamoDbAccountGate } from '@<project>/gate';
import type { ContextDeps } from './index.ts';

export type ContextConfig = { readonly tableName: string };

// The production wiring. Tests build a ContextDeps of their own with a fake gate.
export const createContextDeps = (config: ContextConfig): ContextDeps => ({
  accounts: createDynamoDbAccountGate(config),
});
