import { describe, expect, test } from 'bun:test';
import { type Payment, pendingOperations } from '../index.ts';

type AuthorisedPayment = Extract<
  Payment,
  { readonly providerReference: string }
>;

const authorised = (
  fields: Partial<
    Pick<AuthorisedPayment, 'status' | 'captures' | 'refunds'>
  > = {},
): AuthorisedPayment => ({
  status: 'authorised',
  currency: 'GBP',
  amount: 1000,
  providerReference: 'provider-1',
  captures: {},
  refunds: {},
  ...fields,
});

describe('pendingOperations', () => {
  test('waits on the authorisation while the payment is authorising', () => {
    expect(
      pendingOperations({
        status: 'authorising',
        currency: 'GBP',
        amount: 1000,
      }),
    ).toEqual([{ type: 'authorisation', currency: 'GBP', amount: 1000 }]);
  });

  test('waits on nothing once the payment is declined', () => {
    expect(
      pendingOperations({ status: 'declined', currency: 'GBP', amount: 1000 }),
    ).toEqual([]);
  });

  test('waits on nothing when every operation is resolved', () => {
    const payment = authorised({
      captures: {
        'capture-1': { amount: 300, status: 'confirmed' },
        'capture-2': { amount: 200, status: 'failed' },
      },
      refunds: { 'refund-1': { amount: 100, status: 'confirmed' } },
    });

    expect(pendingOperations(payment)).toEqual([]);
  });

  test('waits on each pending capture and refund with the provider reference', () => {
    const payment = authorised({
      captures: {
        'capture-1': { amount: 300, status: 'confirmed' },
        'capture-2': { amount: 200, status: 'pending' },
      },
      refunds: {
        'refund-1': { amount: 100, status: 'pending' },
        'refund-2': { amount: 50, status: 'failed' },
      },
    });

    expect(pendingOperations(payment)).toEqual([
      {
        type: 'capture',
        captureId: 'capture-2',
        amount: 200,
        providerReference: 'provider-1',
      },
      {
        type: 'refund',
        refundId: 'refund-1',
        amount: 100,
        providerReference: 'provider-1',
      },
    ]);
  });

  test('waits on the void while the payment is voiding', () => {
    const payment = authorised({
      status: 'voiding',
      refunds: { 'refund-1': { amount: 100, status: 'pending' } },
    });

    expect(pendingOperations(payment)).toEqual([
      {
        type: 'refund',
        refundId: 'refund-1',
        amount: 100,
        providerReference: 'provider-1',
      },
      { type: 'void', providerReference: 'provider-1' },
    ]);
  });

  test('waits on no void once the payment is voided', () => {
    expect(pendingOperations(authorised({ status: 'voided' }))).toEqual([]);
  });
});
