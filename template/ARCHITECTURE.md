# Architecture

This document defines the architecture of the system and the rules that keep its structure intact. Read [DOMAIN.md](DOMAIN.md) alongside it. DOMAIN.md defines the model. This document defines where the code that implements it lives and how it runs.

If a change genuinely needs a rule to change, update this document in the same change and give the reason. Do not erode a rule with small diversions.

## Engineering approach

Reliability comes first. Make everything observable, monitor and analyse it continuously and keep the system releasable at all times.

The architecture is Lambda-centric, with the fewest infrastructure components and third-party dependencies that do the job.

The domain is modelled as state transitions governed by rules (see DOMAIN.md). The rules live in a pure _functional core_. An _imperative shell_ of closed layers surrounds the core and does all I/O. Each layer can only call the layer directly below it. Every request that enters the shell becomes a command for the core or a read of an entity's state.

These properties let an agent verify its own work and reach near-deterministic outcomes:

- **Closed layers, split by domain.** Each layer only calls the layer below. Modules are split by domain, not by technical role (controllers, services).
- **Functional core, imperative shell.** Decisions are pure functions of state and input. I/O happens only in the shell.
- **Schema at the boundaries.** Every input and output is parsed against a schema where it enters or leaves the system.
- **Negative-space programming.** Illegal states are unrepresentable and unhandled cases fail to compile. Assertions state what must never happen at run time and fail loudly when it does. `.claude/rules/typescript.md` lists the techniques.

## Core rules

### One stack, one environment per account

All application infrastructure lives in one CDK stack in `infra/stack.ts`. Each environment, such as dev, acc and prod, is its own AWS account and holds one instance of the stack. The account separates the environments, so the stack knows nothing about them. Its name and every resource name are fixed. No name contains the environment, the account or the region. Instances differ through stack props only, never through per-environment infrastructure. The stack synthesises the same template in every account, so every environment runs the same infrastructure as production. One stack also keeps each deployment atomic. Settings that AWS holds once per account and region, such as API Gateway's CloudWatch role, live in the same stack, because the account holds no other instance. Internal tools with no application routes may have their own stack.

### Handlers stay thin

A handler declares its route with `createApiHandler` from the HTTP package. The declaration names the request schema, the gate call, the response schema and a `respond` function that builds the body from the result. The factory parses the request, calls the gate, parses the response and maps every error through the errors package. A handler holds no business logic, no direct SDK calls and no error mapping.

The factory comes before the three uses that `.claude/rules/code-quality.md` asks an abstraction to wait for. This document fixes the pipeline that every route follows, so its use cases are known in advance. A route that needs another status, a header or a body that is not JSON extends the factory. Every route keeps its own Lambda function, so each one has its own permissions, alarms and metrics.

Handlers export `makeHandler(deps)` so tests inject inline fakes. A handler that is hard to fake has absorbed logic from a lower layer.

### The request pipeline is a fixed sequence of layers

```
API Gateway  ->  handler  ->  gate  ->  store
async event  ->     |          |      load, persist
                    v          v
                 schema       core
                 parse    decide, project
```

Every request takes this path, whether API Gateway or an async trigger delivers it. The handler parses the request into a command or a read. For a command, the gate asks the core for a decision and the store persists the decision. For a read, the gate loads the state and returns it.

Shell layers only call the layer below. Skipping a layer or calling upward removes the separation that makes each layer testable and replaceable on its own.

The schema and the core sit outside the chain. A handler calls the schema to parse the request. The gate is the only caller of the core. The core calls nothing.

### State changes go through the core

The core validates every state transition with a pure function. Only the core enforces lifecycle validity and domain rules.

The gate runs every state change in three steps. It loads the current state from the store. It passes the state and the command to the core, which returns a decision. It persists an approved decision with a conditional write and returns a rejection unchanged. The binding of the gate for each entity, such as `packages/gate/order.ts`, raises a rejection as a `DecisionRejectedError` and a lost race as a `ConflictError`. A handler then maps every outcome through the errors package. The core never calls the store or performs any other I/O. Persistence sits behind a store interface. Every store implementation passes one contract suite, which includes two concurrent writes at the same version.

<!-- if: event-sourcing -->
State is an append-only stream of immutable events. Current state is a projection of those events and is never stored or mutated in place. Append-only removes write conflicts, gives a complete audit trail and makes commands idempotent. The gate projects the new events through `evolve` before it appends them, so an event that fails a core assertion never reaches the stream.
<!-- if: crud -->
State is a record guarded by a state machine. Every write is a transition the core has approved, applied with a conditional write on the current status and version.
<!-- end -->

### Reads go through the gate

The binding of the gate for each entity owns that entity's state. It guards every change to the state and serves every read of it. A read loads the state from the store and returns it. It never calls the decider, because a read changes nothing. A read of an entity that does not exist raises a `NotFoundError`.

The gate already loads the state for every command, so a read reuses that load. The result is one definition of current state: a response shows the state that the next command is decided against. A second path from storage to state, such as a handler that replays events itself, can drift from it.

A binding may call the read of another entity's binding to fetch a fact for a decision. These calls stay inside the gate layer, so the closed-layer rule allows them. Pass the other binding in through the deps.

A query across entities, such as a list or a search, needs a read model. A read model is a table that a stream consumer keeps up to date, so it is an architectural decision (see AWS strategy). Do not serve such a query by loading every entity through the gate.

### External calls stay outside the decision

The core decides on the facts it receives. A fact from an external system, such as a price or a verification result, is shell work. Fetch it in the binding of the gate for the entity, before the gate reads the state. Pass it to the core as a field of the command, the same way the shell passes the time.

The state of another entity is a fact too. The conditional write protects only the entity that the gate writes. The other entity can change between the read and the write. An invariant that spans entities therefore needs its own way to hold. DOMAIN.md names each one and the way it holds:

- **Inside one entity** - the two things that must agree become one entity.
- **In one transaction** - the write checks the version of the other entity in the same transaction. The store interface and its contract suite gain the check.
- **Eventually** - a durable function checks the invariant after the write and compensates. The invariant can break for a short time.

An effect that must follow an approved decision, such as a notification, runs in `async/` from the persisted outcome. Never make it inline in the same request after the gate returns. A failure there leaves the decision persisted and the effect lost.

### Schemas are the only contract

Schemas define every request and response shape. They produce the compile-time types, the runtime validation and the OpenAPI spec. Do not hand-write types that duplicate a schema, hand-edit generated output or validate ad hoc in a handler.

### The boundary parses straight into the core's commands

The schema of a command route parses each request into one of the core's commands. The command schema and the core's command type must accept the same values. Assert it beside the schema with `Assert<Same<z.infer<typeof schema>, Command>>` from the schema package, so a command on one side only fails to compile. Never widen a union to `string`, cast away exhaustiveness or add a default case that hides an unhandled member.

### The core is deterministic

The same state and command always produce the same decision. The core reads no clock, random source, identifier generator, environment, timer or other global. The shell generates those values and passes them in with the command. Biome enforces this in `core/`, with a GritQL plugin in `tools/fitness/rules/` for `Math.random`. `tools/fitness/tests/lint-rules.test.ts` proves each of these rules still fails a violation.

### The core asserts what must never happen

The core checks its negative space with `assert` and `unreachable` from `core/assert.ts`. Both throw `AssertionError`. Never catch it to carry on. The gate then persists nothing and the shell responds with a 500.

### The code and DOMAIN.md share one vocabulary

`core/vocabulary.ts` declares every command, event, status and invariant name that DOMAIN.md defines. Derive the core's name unions from it. Never redeclare a name as a string literal elsewhere. The domain drift fitness function fails when a name exists on one side only, so a change to the model updates both in the same change.

### Reliability comes from observability, not retry machinery

Every invocation emits one wide structured event with all the context gathered during the request. Tracing, metrics and DLQ alarms complete the picture. A failed assertion has its own alarm, so a broken invariant never hides among generic errors. `classifyError` gives it the `assertion_failed` outcome, the wide event records that outcome and `Monitoring` alarms on a single occurrence. Do not add bespoke retry frameworks, reconciliation jobs or shadow state. Idempotent writes plus observability are the reliability strategy.

### Dependencies stay minimal

Add a library only when it solves a real problem that a small amount of internal code cannot. Pin shared versions in the root `package.json` catalog. Prefer small focused packages over frameworks.

## AWS strategy

Keep the AWS surface area small. Every new primitive is one more thing to operate, monitor and reason about. Wire each primitive the same way every time.

- **Sync** - Lambda behind one API Gateway REST API. No always-on compute or containers. Handlers run on Node.js and are bundled with esbuild through CDK's `NodejsFunction`.
- **Async** - Lambda durable functions for long-running, multi-step or callback-driven work.
- **State** - DynamoDB, single-table per store, reached only through the store package.
- **Infrastructure** - CDK, standardised through L3 constructs that apply tracing, IAM, log groups and alarms. Extend the constructs rather than add raw resources.

Any other async mechanism (SQS queue, S3 trigger, DynamoDB Stream consumer, EventBridge bus) is an architectural decision, not a routine addition. Each must earn its place:

- **Queue** - the work has no second copy anywhere, so a failed attempt must come back on its own.
- **S3 trigger** - the object is the unit of work. Re-putting it is the replay. Scope it to a key prefix.
- **Stream consumer** - every change it reacts to lands in one table, so subscribing beats a call at each write site.
- **Event bus** - consumers outside the system need a contract behind its own trust boundary.

A durable execution that exhausts its retries records FAILED instead of throwing, so the Lambda `Errors` alarm cannot see it. Emit a failure metric of your own and pass it to `Monitoring` in `failureMetrics`.

## Codebase structure

- `api/` - thin Lambda handlers behind API Gateway
- `async/` - handlers for durable functions, queues, schedules and streams
- `core/` - the functional core: state, transitions and domain rules
- `packages/` - shared libraries: schema, http, gate, store, errors, telemetry and CDK constructs
- `infra/` - the CDK app
- `tools/` - repo-internal CLIs that agents run: the fitness functions and the status line
- `docs/` - strategy documents and agent design

Each top-level directory and each package holds its modules directly, with no `src/` directory between. A handler lives at `api/<resource>/<operation>.ts` (such as `api/orders/read-order.ts`), the core model at `core/<entity>.ts`, the stack at `infra/stack.ts` and a package's entry point at `packages/<name>/index.ts`. Tests sit beside the modules in `tests/`.

## Stack

The `catalog` in the root `package.json` pins every version. This section names each tool and the rule for its use.

- **TypeScript** - the only language, in strict mode. `bun check` checks the types and reports the same errors as `tsc`. It emits nothing.
- **Bun** - package manager, test runner and script runner. Bun is dev tooling only. Deployed code runs on Node.js, so it never imports `bun:` modules or uses the `Bun` global.
- **Turbo** - runs each task across the workspaces in dependency order. It caches the results, so an unchanged package is not checked again.
- **Biome** - the only linter and formatter. Its import rules enforce the layer boundaries in this document, so a layer that imports past the one below it fails CI.
- **Zod** - the only schema library. Each schema produces the compile-time type through `z.infer`, the runtime validation and the OpenAPI spec.
- **AWS CDK** - defines all infrastructure in TypeScript, in `infra/`.
- **fast-check** - property-based tests for the core. Each invariant in DOMAIN.md has a property, declared with the `invariant` helper in `core/tests/`, that holds for every generated command. The fitness functions run the core tests and count a property only when it ran and passed.
- **Stryker** - mutation tests for the core. A change to the core passes only when its tests kill at least 80% of the mutants.
- **Powertools for AWS Lambda** - Logger emits the one wide event per invocation. Tracer sends traces to X-Ray. Metrics publishes CloudWatch metrics. Do not log, trace or publish metrics any other way.

## Extending the system

Common changes are additive and touch a small, predictable set of places. A change that edits many files or reaches across layers is a signal to stop and check it against the rules.

- **New command** - a name in DOMAIN.md and `core/vocabulary.ts`, a case in the decider, a member of the command schema and tests. Handlers and infrastructure stay unchanged.
- **New external fact** - a call in the binding of the gate for the entity and a field on the command that carries the result.
- **New route** - a route entry in the stack and a handler declared with `createApiHandler`.
- **New read** - a `read` on the binding of the gate for the entity, a schema for the event and a new route.
- **New query across entities** - a read model, which is an architectural decision.
- **Shared code** - an existing package where it fits. Create a package only for a distinct responsibility.

## Anti-patterns

Each row names the check that catches the anti-pattern. A row marked review has no check yet, so a reviewer must catch it. Replace review with a check wherever one is possible.

| Anti-pattern                                                                                  | Caught by                                                                                                                                  |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| A second application stack definition, or infrastructure split per feature or per environment | Review                                                                                                                                     |
| Business logic or lifecycle handling in a handler                                             | Partly by Biome, which stops a handler importing the core, the store, the errors package or an AWS SDK. Logic written inline needs review. |
| A handler that maps errors or builds its response outside `createApiHandler`                  | Biome layer import rules. A handler may not import the errors package.                                                                     |
| A response that leaves the system without passing its schema                                  | HTTP unit tests                                                                                                                            |
| A read that loads or projects state outside the gate                                          | Biome layer import rules                                                                                                                   |
| A read sent through the decider as a command                                                  | Review                                                                                                                                     |
| An invariant that spans entities, with no way to hold it named in DOMAIN.md                   | Review                                                                                                                                     |
| A query across entities served by loading every entity through the gate                       | Review                                                                                                                                     |
| A layer calling upward or skipping the layer below                                            | Biome layer import rules                                                                                                                   |
| State changed anywhere but through the gate and the core                                      | Biome layer import rules. Only the gate may import the store. Only the gate and the schema may import the core.                            |
| The core calling the store or performing any other I/O                                        | Biome core rules                                                                                                                           |
| A clock, random value, identifier or other global read in the core                            | Biome core rules and the determinism plugin. `tools/fitness/tests/lint-rules.test.ts` proves they still fail each violation.               |
| Events appended before the core has checked the state they produce                            | Gate unit tests                                                                                                                            |
| A store write that lets two concurrent writers both succeed                                   | Store contract tests against the in-memory implementations                                                                                 |
| A stack or resource name built from the environment or the account                            | Infrastructure assertions                                                                                                                  |
| An external call or effect made after the decision in the same request                        | Review                                                                                                                                     |
| Hand-written types or hand-edited OpenAPI that duplicate a schema                             | Review                                                                                                                                     |
| A command schema that accepts other commands than the core decides                            | Type check: the `Assert<Same<...>>` beside the schema                                                                                      |
| A widened union or default case that hides an unhandled member                                | Review                                                                                                                                     |
| Bespoke retry, reconciliation or shadow-state infrastructure                                  | Review                                                                                                                                     |
| A new async mechanism added as if it were routine                                             | Review                                                                                                                                     |
| A dependency added to save a few lines of internal code                                       | Review                                                                                                                                     |
| A name in DOMAIN.md that the core does not declare, or the reverse                            | Fitness functions: domain drift                                                                                                            |
| An invariant without a property that runs, such as a skipped or commented-out one             | Fitness functions: invariant coverage                                                                                                      |
| Core tests that still pass when the core's behaviour changes                                  | Mutation tests                                                                                                                             |
| An `AssertionError` caught so the code can carry on                                           | Review                                                                                                                                     |
| An assertion that a valid command can trigger, or a rejection that only a bug can trigger     | Review                                                                                                                                     |
| An assertion failure that raises no alarm                                                     | Errors and constructs unit tests: the classification of a failed assertion and the alarm on it                                             |
| A `src/` directory anywhere in the project                                                    | Review                                                                                                                                     |
