// Every name DOMAIN.md defines. The domain drift fitness function fails when the two disagree.
export const vocabulary = {
  commands: [
    'request_authorisation',
    'confirm_authorisation',
    'fail_authorisation',
    'request_capture',
    'confirm_capture',
    'fail_capture',
    'request_refund',
    'confirm_refund',
    'fail_refund',
    'request_void',
    'confirm_void',
    'fail_void',
  ],
  events: [
    'authorisation_requested',
    'authorisation_confirmed',
    'authorisation_failed',
    'capture_requested',
    'capture_confirmed',
    'capture_failed',
    'refund_requested',
    'refund_confirmed',
    'refund_failed',
    'void_requested',
    'void_confirmed',
    'void_failed',
  ],
  statuses: ['authorising', 'authorised', 'declined', 'voiding', 'voided'],
  invariants: [
    'payment-authorises-first',
    'declined-payment-is-final',
    'captures-only-while-authorised',
    'captures-within-authorisation',
    'refunds-within-captures',
    'void-waits-for-captures',
    'operation-ids-are-unique',
    'operations-resolve-once',
  ],
} as const;

export type CommandName = (typeof vocabulary.commands)[number];
export type EventName = (typeof vocabulary.events)[number];
export type StatusName = (typeof vocabulary.statuses)[number];
export type InvariantName = (typeof vocabulary.invariants)[number];
