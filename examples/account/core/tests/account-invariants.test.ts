import { history } from './history.ts';
import { invariant } from './invariant.ts';

invariant('balance-never-negative', history, (steps) =>
  steps.every(({ after }) => after === undefined || after.balance >= 0),
);

invariant('closed-account-is-empty', history, (steps) =>
  steps.every(({ after }) => after?.status !== 'closed' || after.balance === 0),
);

invariant('closed-account-is-final', history, (steps) =>
  steps.every(
    ({ before, approved, after }) =>
      before?.status !== 'closed' || (!approved && after === before),
  ),
);

invariant('account-opens-first', history, (steps) =>
  steps.every(({ before, command, approved, after }) => {
    const isOpen = command.type === 'open_account';
    if (before !== undefined) return !(isOpen && approved);
    if (!isOpen) return !approved && after === undefined;
    return approved && after?.status === 'open' && after.balance === 0;
  }),
);
