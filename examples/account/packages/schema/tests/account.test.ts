import { describe, expect, test } from 'bun:test';
import { executeAccountCommandEventSchema } from '../src/index.ts';

const event = (overrides: Record<string, unknown> = {}) => ({
  pathParameters: { accountId: 'acc-1' },
  headers: { 'Idempotency-Key': 'request-1' },
  body: JSON.stringify({
    variant: 'ledger',
    command: { type: 'deposit_funds', amount: 25 },
  }),
  ...overrides,
});

describe('executeAccountCommandEventSchema', () => {
  test('reads the variant, the account, the command and the idempotency key', () => {
    expect(executeAccountCommandEventSchema.parse(event())).toEqual({
      variant: 'ledger',
      request: {
        accountId: 'acc-1',
        command: { type: 'deposit_funds', amount: 25 },
        idempotencyKey: 'request-1',
      },
    });
  });

  test('reads the idempotency key whatever the header case', () => {
    const parsed = executeAccountCommandEventSchema.parse(
      event({ headers: { 'idempotency-key': 'request-2' } }),
    );

    expect(parsed.request.idempotencyKey).toBe('request-2');
  });

  test('leaves the idempotency key out when the header is absent', () => {
    const parsed = executeAccountCommandEventSchema.parse(
      event({ headers: null }),
    );

    expect(parsed.request.idempotencyKey).toBeUndefined();
  });

  test.each([
    ['a fractional amount', { type: 'deposit_funds', amount: 1.5 }],
    ['a zero amount', { type: 'withdraw_funds', amount: 0 }],
    ['an unknown command', { type: 'transfer_funds', amount: 1 }],
    ['an extra field', { type: 'close_account', reason: 'moved' }],
  ])('rejects %s', (_case, command) => {
    const parsed = executeAccountCommandEventSchema.safeParse(
      event({ body: JSON.stringify({ variant: 'ledger', command }) }),
    );

    expect(parsed.success).toBe(false);
  });

  test('rejects an unknown variant', () => {
    const parsed = executeAccountCommandEventSchema.safeParse(
      event({
        body: JSON.stringify({
          variant: 'acme',
          command: { type: 'open_account' },
        }),
      }),
    );

    expect(parsed.success).toBe(false);
  });

  test('rejects an idempotency key over 128 characters', () => {
    const parsed = executeAccountCommandEventSchema.safeParse(
      event({ headers: { 'Idempotency-Key': 'k'.repeat(129) } }),
    );

    expect(parsed.success).toBe(false);
  });

  test('rejects an account id outside the allowed characters', () => {
    const parsed = executeAccountCommandEventSchema.safeParse(
      event({ pathParameters: { accountId: 'acc/1' } }),
    );

    expect(parsed.success).toBe(false);
  });
});
