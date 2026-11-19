// if: event-sourcing
export type {
  Account,
  AccountCommand,
  AccountDecision,
  AccountEvent,
  AccountRejection,
  AccountState,
} from './account.ts';
export { decide, evolve, initialState } from './account.ts';
// if: crud
export type {
  Account,
  AccountCommand,
  AccountRejection,
  AccountState,
  AccountTransition,
} from './account.ts';
export { decide } from './account.ts';
// end
export { AssertionError, assert, unreachable } from './assert.ts';
export type {
  CommandName,
  EventName,
  InvariantName,
  StatusName,
} from './vocabulary.ts';
export { vocabulary } from './vocabulary.ts';
