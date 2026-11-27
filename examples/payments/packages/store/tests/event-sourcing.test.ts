import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createInMemoryEventLog } from '../index.ts';
import {
  type ContractEvent,
  describeEventLogContract,
} from './contract/event-log.ts';

const clock = (): Date => new Date('2026-01-01T00:00:00.000Z');

describeEventLogContract('in-memory', {
  createLog: () => createInMemoryEventLog<ContractEvent>({ clock }),
  newStreamId: () => randomUUID(),
});

describe('in-memory event log', () => {
  test('stamps appended events with the clock', async () => {
    const log = createInMemoryEventLog<ContractEvent>({ clock });

    await log.append('counter-1', {
      expectedVersion: 0,
      idempotencyKey: undefined,
      events: [{ type: 'incremented', by: 1 }],
    });

    expect((await log.read('counter-1')).events).toEqual([
      {
        sequence: 1,
        recordedAt: '2026-01-01T00:00:00.000Z',
        idempotencyKey: undefined,
        event: { type: 'incremented', by: 1 },
      },
    ]);
  });

  test('writes nothing and checks no version for an empty append', async () => {
    const log = createInMemoryEventLog<ContractEvent>({ clock });

    const result = await log.append('counter-1', {
      expectedVersion: 3,
      idempotencyKey: undefined,
      events: [],
    });

    expect(result).toEqual({ outcome: 'appended', version: 3 });
    expect(await log.read('counter-1')).toEqual({ version: 0, events: [] });
  });
});
