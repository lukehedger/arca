// if: event-sourcing
import { describe, expect, test } from 'bun:test';
import type { EventLog } from '../../index.ts';

export type ContractEvent = {
  readonly type: 'incremented';
  readonly by: number;
};

export type EventLogContractDeps = {
  readonly createLog: () => EventLog<ContractEvent>;
  // A real table outlives one run, so each test needs a stream no earlier run wrote to.
  readonly newStreamId: () => string;
};

const incremented = (by: number): ContractEvent => ({
  type: 'incremented',
  by,
});

// Every EventLog implementation must pass this suite, the in-memory one in unit tests and DynamoDB in integration tests.
export const describeEventLogContract = (
  name: string,
  deps: EventLogContractDeps,
): void => {
  describe(`${name} event log contract`, () => {
    test('reads an unknown stream as empty at version 0', async () => {
      const log = deps.createLog();

      expect(await log.read(deps.newStreamId())).toEqual({
        version: 0,
        events: [],
      });
    });

    test('appends events in sequence with their idempotency key', async () => {
      const log = deps.createLog();
      const streamId = deps.newStreamId();

      const result = await log.append(streamId, {
        expectedVersion: 0,
        idempotencyKey: 'request-1',
        events: [incremented(1), incremented(2)],
      });

      expect(result).toEqual({ outcome: 'appended', version: 2 });
      const stream = await log.read(streamId);
      expect(stream.version).toBe(2);
      expect(stream.events).toMatchObject([
        { sequence: 1, idempotencyKey: 'request-1', event: incremented(1) },
        { sequence: 2, idempotencyKey: 'request-1', event: incremented(2) },
      ]);
    });

    test('rejects an append at a stale version and keeps the stream', async () => {
      const log = deps.createLog();
      const streamId = deps.newStreamId();
      await log.append(streamId, {
        expectedVersion: 0,
        idempotencyKey: undefined,
        events: [incremented(1)],
      });

      const result = await log.append(streamId, {
        expectedVersion: 0,
        idempotencyKey: undefined,
        events: [incremented(5)],
      });

      expect(result).toEqual({ outcome: 'conflict' });
      const stream = await log.read(streamId);
      expect(stream.events.map(({ event }) => event)).toEqual([incremented(1)]);
    });

    test.each([
      ['single events', [incremented(1)], [incremented(2)]],
      [
        'multi-event appends',
        [incremented(1), incremented(3)],
        [incremented(2), incremented(4)],
      ],
    ] as const)(
      'lets exactly one of two concurrent %s at the same version win',
      async (_case, first, second) => {
        const log = deps.createLog();
        const streamId = deps.newStreamId();

        const results = await Promise.all(
          [first, second].map((events) =>
            log.append(streamId, {
              expectedVersion: 0,
              idempotencyKey: undefined,
              events,
            }),
          ),
        );

        const outcomes = results.map(({ outcome }) => outcome).sort();
        expect(outcomes).toEqual(['appended', 'conflict']);
        const winner = results[0]?.outcome === 'appended' ? first : second;
        const stream = await log.read(streamId);
        expect(stream.version).toBe(winner.length);
        expect(stream.events.map(({ event }) => event)).toEqual([...winner]);
      },
    );

    test('keeps streams apart', async () => {
      const log = deps.createLog();
      await log.append(deps.newStreamId(), {
        expectedVersion: 0,
        idempotencyKey: undefined,
        events: [incremented(1)],
      });

      expect(await log.read(deps.newStreamId())).toEqual({
        version: 0,
        events: [],
      });
    });
  });
};
// end
