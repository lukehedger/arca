// if: crud
import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createInMemoryRecordStore } from '../src/index.ts';
import {
  type ContractRecord,
  describeRecordStoreContract,
} from './contract/record-store.ts';

const clock = (): Date => new Date('2026-01-01T00:00:00.000Z');

describeRecordStoreContract('in-memory', {
  createStore: () => createInMemoryRecordStore<ContractRecord>({ clock }),
  newRecordId: () => randomUUID(),
});

describe('in-memory record store', () => {
  test('stamps a written record with the clock', async () => {
    const store = createInMemoryRecordStore<ContractRecord>({ clock });

    await store.write('counter-1', { status: 'open', count: 0 }, undefined);

    expect(await store.read('counter-1')).toEqual({
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      value: { status: 'open', count: 0 },
    });
  });

  test('rejects an update of a missing record', async () => {
    const store = createInMemoryRecordStore<ContractRecord>({ clock });

    const result = await store.write(
      'counter-1',
      { status: 'open', count: 1 },
      { status: 'open', version: 1 },
    );

    expect(result).toEqual({ outcome: 'conflict' });
  });
});
// end
