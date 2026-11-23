import { describe, expect, test } from 'bun:test';
import { registry } from '../index.ts';

describe('registry', () => {
  test('routes the ledger variant to an adapter that executes commands', () => {
    expect(registry.ledger.capabilities.executeCommand).toBeFunction();
  });
});
