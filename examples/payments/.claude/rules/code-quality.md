# Code quality

These rules hold for every change. Several run counter to habit, so do not guess them from experience.

## Simplicity and abstractions

**[SHOULD]** Choose the simplest option. Simple can take longer than easy. It pays off later.

**[SHOULD]** Defer abstractions. Start with one of everything and accept repetition. Abstract only when all three hold:

- The same logic exists in three or more places.
- The duplication causes real maintenance pain, such as one bug fix needing several edits.
- You understand every use case well enough to serve them all.

Every abstraction has a cost and can leak. Repetition is debt with a known repayment plan. A premature abstraction is debt with none.

**[CONSIDER]** Defer decisions to the last responsible moment, particularly one-way doors. Ask how likely the thing is to change. Then ask how easily you could change it later.

## Control flow and errors

**[SHOULD]** Put important things at the top of a file. Branch as early as possible: check every condition in the top-level function, then call functions that do the work with few checks of their own.

**[SHOULD]** Return or throw early. The happy path is the last line of the function.

```ts
const completeOrder = (order: Order): Receipt => {
  if (order.items.length === 0) throw new ValidationError('Order has no items');
  if (order.total <= 0) throw new ValidationError('Order total must be positive');

  return issueReceipt(order);
};
```

**[MUST]** Error messages tell the caller what went wrong: `'Capture failed: amount exceeds authorised amount'`, not `'Error'`. A public API error is informative but never leaks internals such as table names, column names or the expected request format.

**[SHOULD]** Give each kind of failure its own error class. Map errors to responses in one place, never by hand in each handler.

## Logging

**[MUST]** Each invocation emits one wide structured event with all the context gathered during the request. Add identifiers to that context. Do not log each step.

**[MUST]** Never log whole objects, PII, card data or any other sensitive data. Log identifiers and specific values. Prefer trace annotations for timing detail.

## Naming

**[SHOULD]** Get the nouns and verbs right. A good name gives the reader a crisp mental model and shows you understand the domain. Use the ubiquitous language in `DOMAIN.md`, so a concept has one name everywhere. Do not abbreviate.

**[MUST]** Name a function for its outcome in domain terms: `rejectExpiredOrder`, not `handle` or `procOrd`. Predicates read as assertions: `isRefundable`, `canCapture`. A name that needs "and" means the function does two things. Split it.

Name AWS resources by their role in the data flow: `pending-fraud-analysis-queue`, not `fraud-queue`.

## Comments

A comment is a durable note about code nuance for whoever opens the file in a year. It is not a record of the PR that introduced it.

**[MUST]** Write from the perspective of the code as it now stands. Do not narrate the branch's history: earlier approaches, reverts or what a reviewer asked for. That belongs in the commit message or the PR description.

**[MUST]** Explain why, never what. If the comment restates the code, delete it.

**[SHOULD]** Use comments sparingly. Default to none.

**[SHOULD]** Keep to one line, two at most. Write each comment as a sentence, with a space after `//`, a capital letter and a full stop.

A comment that needs a paragraph means one of two things. Either the code is too complicated and needs simplifying, or the knowledge belongs in documentation such as DOMAIN.md, ARCHITECTURE.md or an ADR. Leave at most a one-line pointer in the code.

## Tests

**[MUST]** Write them. Keep them short, simple and structured. Aim for confidence, not coverage. Tests live in a `tests/` folder at the root of the package under test, with the `.test.ts` suffix.

**[MUST]** Write typed tests with `bun:test`. Use inline fakes passed through `deps`, not module mocks.

## Security and tooling

**[MUST]** Never commit or hard-code API keys, tokens, passwords or other credentials. Treat the supply chain as a threat: every dependency is code you run without reading.

**[SHOULD]** Minimise dependencies.
