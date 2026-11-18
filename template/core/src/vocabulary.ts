// Every name DOMAIN.md defines. The domain drift fitness function fails when the two disagree.
export const vocabulary = {
  commands: [],
  events: [],
  statuses: [],
  invariants: [],
} as const;

export type CommandName = (typeof vocabulary.commands)[number];
export type EventName = (typeof vocabulary.events)[number];
export type StatusName = (typeof vocabulary.statuses)[number];
export type InvariantName = (typeof vocabulary.invariants)[number];
