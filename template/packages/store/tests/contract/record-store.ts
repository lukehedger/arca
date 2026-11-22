// if: crud
import { describe, expect, test } from 'bun:test';
import type { RecordStore } from '../../index.ts';

export type ContractRecord = {
  readonly status: 'open' | 'closed';
  readonly count: number;
};

export type RecordStoreContractDeps = {
  readonly createStore: () => RecordStore<ContractRecord>;
  // A real table outlives one run, so each test needs a record no earlier run wrote to.
  readonly newRecordId: () => string;
};

const open = (count: number): ContractRecord => ({ status: 'open', count });

// Every RecordStore implementation must pass this suite, the in-memory one in unit tests and DynamoDB in integration tests.
export const describeRecordStoreContract = (
  name: string,
  deps: RecordStoreContractDeps,
): void => {
  describe(`${name} record store contract`, () => {
    test('reads an unknown record as undefined', async () => {
      const store = deps.createStore();

      expect(await store.read(deps.newRecordId())).toBeUndefined();
    });

    test('creates a record at version 1', async () => {
      const store = deps.createStore();
      const id = deps.newRecordId();

      const result = await store.write(id, open(0), undefined);

      expect(result).toEqual({ outcome: 'written', version: 1 });
      expect(await store.read(id)).toMatchObject({
        version: 1,
        value: open(0),
      });
    });

    test('updates a record that matches the expected status and version', async () => {
      const store = deps.createStore();
      const id = deps.newRecordId();
      await store.write(id, open(0), undefined);

      const result = await store.write(
        id,
        { status: 'closed', count: 0 },
        { status: 'open', version: 1 },
      );

      expect(result).toEqual({ outcome: 'written', version: 2 });
      expect((await store.read(id))?.value.status).toBe('closed');
    });

    test('rejects a create when the record exists', async () => {
      const store = deps.createStore();
      const id = deps.newRecordId();
      await store.write(id, open(0), undefined);

      const result = await store.write(id, open(9), undefined);

      expect(result).toEqual({ outcome: 'conflict' });
      expect((await store.read(id))?.value.count).toBe(0);
    });

    test('rejects an update at a stale version or from a different status', async () => {
      const store = deps.createStore();
      const id = deps.newRecordId();
      await store.write(id, open(0), undefined);
      await store.write(id, open(1), { status: 'open', version: 1 });

      const stale = await store.write(id, open(2), {
        status: 'open',
        version: 1,
      });
      const wrongStatus = await store.write(id, open(2), {
        status: 'closed',
        version: 2,
      });

      expect([stale, wrongStatus]).toEqual([
        { outcome: 'conflict' },
        { outcome: 'conflict' },
      ]);
      expect(await store.read(id)).toMatchObject({
        version: 2,
        value: open(1),
      });
    });

    test('lets exactly one of two concurrent creates win', async () => {
      const store = deps.createStore();
      const id = deps.newRecordId();
      const candidates = [open(1), open(2)];

      const results = await Promise.all(
        candidates.map((value) => store.write(id, value, undefined)),
      );

      expect(results.map(({ outcome }) => outcome).sort()).toEqual([
        'conflict',
        'written',
      ]);
      const winner = results[0]?.outcome === 'written' ? 0 : 1;
      expect(await store.read(id)).toMatchObject({
        version: 1,
        value: candidates[winner],
      });
    });

    test('lets exactly one of two concurrent updates at the same version win', async () => {
      const store = deps.createStore();
      const id = deps.newRecordId();
      await store.write(id, open(0), undefined);
      const candidates = [open(1), open(2)];

      const results = await Promise.all(
        candidates.map((value) =>
          store.write(id, value, { status: 'open', version: 1 }),
        ),
      );

      expect(results.map(({ outcome }) => outcome).sort()).toEqual([
        'conflict',
        'written',
      ]);
      const winner = results[0]?.outcome === 'written' ? 0 : 1;
      expect(await store.read(id)).toMatchObject({
        version: 2,
        value: candidates[winner],
      });
    });
  });
};
// end
