# arca

architecting for agents on aws

## about

arca is based on the premise that software must be deliberately architected to fully realise the development lifecycle automation that agents make possible. Safe, minimal-interaction automation is only possible if agents can act with self-verification and near-determinism.

arca packages an agent-optimised architecture as an opinionated scaffold for deployment to AWS.

You can point Claude Code at arca to build your own coding assistants on an architecture they'll love.

## run

Open Claude Code in your project directory and paste:

```
Bootstrap this project with arca: clone https://github.com/lukehedger/arca to a temporary directory and follow its CLAUDE.md.
```

arca copies the template with `scripts/bootstrap.ts`, then helps you complete `DOMAIN.md` and builds the core that `DOMAIN.md` describes. wren, the coding agent, builds the shell of your application based on `ARCHITECTURE.md`.

## agents 

- wren - the coding agent for every task, named after the architect Christopher Wren. Opus 5.5 high.

## features

### fitness

The architectural framework is preserved via executable fitness functions, such as dependency rules that fail CI when a layer reaches past its neighbour, a lint that bans I/O, clocks and randomness in core/, a check that DOMAIN.md and the code use the same names, a property test that runs for every invariant and mutation tests on the core. A test in each project proves the lint rules still fail each violation.

### disposable environments

Every environment is an instance of one stack, named after the environment. `bun env:deploy` deploys a stack for the current branch, `bun env:test` runs the integration tests against it and `bun env:destroy` deletes it. CI runs the same three steps on every pull request.

### example

`examples/account/` is a vertical slice through every layer for both persistence modes: a ledger account with a handler, router, adapter, gate, core, store, infrastructure and integration test. Bootstrapping uses its core as the reference shape.

### commands

- `/ship` - opens a pull request with auto-merge enabled, then addresses review comments and failed checks until it is clean.

### status line

Built-in agent status line showing model, effort, context used, cache hit rate, branch and worktree.

## problems

The top 3 common mistakes that make codebases unmaintainable as they scale over time:

1. **Business logic tangled with I/O.** Domain rules get spread across handlers, ORM calls and SDK clients, so nothing can be tested without mocking the world.
2. **No enforced boundaries between modules.** Any module can import any other, so every change risks touching everything. The database becomes the real integration layer: any service can query any table, so a schema change breaks unknown code.
3. **Implicit invariants.** The rules that must always hold live in people's heads or in scattered `if` statements, so state quietly drifts into impossible combinations.

## migration

If you are migrating from an existing architecture to arca then your first step is ask your agents to plan the migration. This typically involves creating a folder in your codebase to isolate the arca version of your application, building until you reach 100% feature parity and deciding on a traffic-shifting strategy.

The bootstrap places the workflows at the repository root, because GitHub reads them only there. Each one is named after the folder, runs from it and triggers only on changes inside it. The bootstrap never overwrites an existing file. It stops and lists each conflict, such as an existing CODEOWNERS, for you to merge.

As part of the migration plan, the agent can perform an assessment of your current architecture vs the target across the following aspects:

- Architecture and codebase structure
- AWS service sprawl
- Test quality and coverage
- CI checks
- Delivery pipeline
- Tooling
- Documentation and agentic guides

## testing arca

Run `bun install`, then `bun run test`. It bootstraps the four profiles (new project or migration, event sourcing or CRUD) and verifies each fresh copy. It then lays the account example over each one and runs `bun verify` and `bun mutation`. Last, it applies deliberate architecture, domain and concurrency breakages and checks that each one fails `bun verify` for the right reason.

## extending

arca can be extended to bundle your org's standards and tools. Just fork it and get your agent to extend with things like:

- skill to read and write jira tickets
- integrate with internal model gateway
- support for agents other than Claude Code
