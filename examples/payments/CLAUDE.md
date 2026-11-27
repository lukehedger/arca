# Payments

Payments takes a card payment through its lifecycle with an external payment service provider (PSP). It authorises an amount on the card. It then captures, voids or refunds that amount. The answers from the provider become commands on the same path as every other write. Checkout and order services depend on it to learn whether a payment is authorised, captured or refunded and how much money has moved.

**[MUST]** Read [DOMAIN.md](DOMAIN.md) before you design or implement any change to the domain model. It defines the data model, lifecycle statuses, invariants and the external systems. If a change cannot fit the model, change the model deliberately and update DOMAIN.md in the same PR. Do not work around it locally.

**[MUST]** Read [ARCHITECTURE.md](ARCHITECTURE.md) before you design or implement a non-trivial change. It defines the core rules, the AWS strategy and the anti-patterns. If a change genuinely needs a rule to change, update ARCHITECTURE.md in the same change and give the reason.

## Dependencies

**[MUST]** Define the exact version of every third-party dependency in the root `package.json` `catalog`. Use `catalog:` in workspace manifests and `workspace:*` for a dependency on another workspace package. Never put a version, range or tag directly in a workspace manifest.

## Worktrees

**[MUST]** Make every change in a worktree. Before your first shell command, edit or write in a session, call `EnterWorktree` with a short name for the task. Skip this when the session already runs in a worktree, such as one started with `claude --worktree`.

The wren plugin in `tools/wren/` enforces this. It refuses every shell command in the primary checkout and every edit or write to a file in the repository. Before Claude Code creates a worktree, the plugin fetches `origin/main`, so the worktree starts from the latest code.

**[MUST]** Change files only inside your worktree. Never change the primary checkout or another worktree. A file you read before you entered the worktree has its own copy in the worktree. Change that copy.

**[MUST]** If the plugin refuses `EnterWorktree`, stop and report its reason to the user. Never work around a refusal.

**[MUST]** Never call `ExitWorktree` unless the user asks. Claude Code offers to keep or remove the worktree when the session ends.

**[MUST]** Run `bun install` in a new worktree before you run `bun verify`. A new worktree has no `node_modules`.

## Shell commands

The wren plugin refuses destructive Git and file commands and every AWS CLI call outside the read-only list in the `aws` skill. It asks the user before a recursive removal, `sudo`, `chmod 777` or a recursive `chown`.

**[MUST]** If the plugin refuses a command, never work around it with another command that has the same effect. Report the refusal to the user.

## Verification

**[MUST]** Run `bun verify` from the repository root before you hand over a change and fix what it reports. It runs Biome lint and format, the type check, the fitness functions and the unit tests. It fails if any of them fails.

**[MUST]** When you change `core/`, also run `bun mutation`. Add tests until it passes.

## Scope and TODOs

Stay inside the scope of the task. Work you notice along the way (a latent bug, a rough abstraction, a missing test, dead code) does not get fixed in the same change. Mention it in your closing summary.

**[SHOULD]** Use `TODO`s sparingly. Only findings with real consequences if forgotten earn one.

At the end of the change, once the request is built and verified, list the out-of-scope findings worth tracking, with one line of reasoning each. Add a `TODO` for one only when the user asks.
