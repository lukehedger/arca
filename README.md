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

arca helps you complete `DOMAIN.md` based on your domain. wren, the coding agent, builds the core and shell of your application based on `ARCHITECTURE.md`.

## agents 

- wren - the coding agent for every task, named after the architect Christopher Wren. Opus 5.5 high.

## features

### fitness

The architectural framework is preserved via executable fitness functions, such as dependency rules that fail CI when a layer reaches past its neighbour, a lint that bans I/O in core/, a check that DOMAIN.md and the code use the same names, a property test for every invariant and mutation tests on the core.

### commands

- `/ship` - opens a pull request with auto-merge enabled, then addresses review comments and failed checks until it is clean.

### worktrees

wren never changes the checkout you opened. The wren plugin refuses every change in the primary checkout until wren enters a Claude Code worktree. Before each new worktree, it fetches `origin/main`. If the fetch fails, it refuses the worktree.

### shell commands

The wren plugin checks every shell command before it runs. It refuses `git reset --hard`, a forced `git clean`, a force push, `git branch -D` and a forced recursive removal of the root, home or parent directory. It asks you before a recursive removal, `sudo`, `chmod 777` or a recursive `chown`. Without an interactive UI, it refuses them. It refuses every AWS CLI call outside the read-only list in the `aws` skill, including a DynamoDB scan and a secret value read. It looks through shell wrappers, chained commands and command substitutions.

### attribution

Claude Code adds no attribution to commits or pull requests. `.claude/settings.json` sets both `attribution` values to an empty string.

### status line

Built-in agent status line showing model, effort, context used, cache hit rate, branch and worktree.

## problems

The top 3 common mistakes that make codebases unmaintainable as they scale over time:

1. **Business logic tangled with I/O.** Domain rules get spread across handlers, ORM calls and SDK clients, so nothing can be tested without mocking the world.
2. **No enforced boundaries between modules.** Any module can import any other, so every change risks touching everything. The database becomes the real integration layer: any service can query any table, so a schema change breaks unknown code.
3. **Implicit invariants.** The rules that must always hold live in people's heads or in scattered `if` statements, so state quietly drifts into impossible combinations.

## migration

If you are migrating from an existing architecture to arca then your first step is ask your agents to plan the migration. This typically involves creating a folder in your codebase to isolate the arca version of your application, building until you reach 100% feature parity and deciding on a traffic-shifting strategy.

As part of the migration plan, the agent can perform an assessment of your current architecture vs the target across the following aspects:

- Architecture and codebase structure
- AWS service sprawl
- Test quality and coverage
- CI checks
- Delivery pipeline
- Tooling
- Documentation and agentic guides

## extending

arca can be extended to bundle your org's standards and tools. Just fork it and get your agent to extend with things like:

- skill to read and write jira tickets
- integrate with internal model gateway
- support for agents other than Claude Code

## example

`examples/account/` is a vertical slice through every layer of the request pipeline for both persistence modes: a ledger account with a handler, router, adapter, gate, core and store.
