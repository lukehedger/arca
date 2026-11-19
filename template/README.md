# <Project>

<!-- One paragraph: what the system does and who depends on it. Use the same paragraph as CLAUDE.md. -->

<!-- if: migration -->
This directory holds the new implementation. The previous implementation is everything outside it. Run every command below from `<app-dir>/`.

<!-- end -->
## Start

Install the Bun version that `packageManager` in `package.json` names. Then install the dependencies and run the checks:

```sh
bun install
bun verify
```

## Commands

| Command                 | Does                                                                         |
| ----------------------- | ---------------------------------------------------------------------------- |
| `bun verify`            | Runs lint and format, the type check, the fitness functions and unit tests. |
| `bun mutation`          | Runs the mutation tests on `core/`.                                          |
| `bun env:deploy`        | Deploys a disposable environment named after the current branch.            |
| `bun env:test`          | Runs the integration tests against that environment.                         |
| `bun env:destroy`       | Deletes that environment.                                                    |

The three `env:` commands change AWS. CI runs them on every pull request.

## Layout

| Directory   | Holds                                                                     |
| ----------- | ------------------------------------------------------------------------- |
| `api/`      | Thin Lambda handlers behind API Gateway, one directory per resource       |
| `async/`    | Handlers for durable functions, queues, schedules and streams             |
| `core/`     | The functional core: state, transitions and domain rules                  |
| `packages/` | The shell layers and shared libraries, one workspace package each         |
| `infra/`    | The CDK app and stack                                                     |
| `tools/`    | The fitness functions, the disposable environment tool and the status line |
| `docs/`     | Strategy documents                                                        |

## Documents

- [DOMAIN.md](DOMAIN.md) defines the domain model: its language, statuses, transitions and invariants.
- [ARCHITECTURE.md](ARCHITECTURE.md) defines where the code lives, how it runs and the anti-patterns each check catches.
- [docs/correctness-strategy.md](docs/correctness-strategy.md) lists each check and what it proves.
- [CLAUDE.md](CLAUDE.md) holds the instructions for coding agents.
