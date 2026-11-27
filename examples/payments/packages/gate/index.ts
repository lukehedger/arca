// biome-ignore-all assist/source/organizeImports: sorting would move exports across the mode markers.
export type {
  Decision,
  EventSourcedCommand,
  EventSourcedGate,
  EventSourcedGateDeps,
  EventSourcedResult,
} from './event-sourcing.ts';
export { createEventSourcedGate } from './event-sourcing.ts';
export type {
  PaymentCommandInput,
  PaymentGate,
  PaymentGateDeps,
} from './payment.ts';
export { createDynamoDbPaymentGate, createPaymentGate } from './payment.ts';
// The shell above the gate cannot import the core, so it names these through the binding.
export type {
  InvariantName,
  Payment,
  PendingOperation,
} from '@payments/core';
