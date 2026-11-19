# arca

arca packages an agent-optimised architecture as a project template. `template/` is the project an agent copies into the user's repository. `scripts/bootstrap.ts` does the copy. `examples/account/` is a vertical slice through every layer that shows the shape of a finished core and shell.

## Bootstrapping a project

Follow these steps when the user asks you to bootstrap a project with arca. The source is this repository. Step 2 sets the target.

1. **Ask the questions.** Ask them one at a time and wait for each answer.
   - Is this a new project or a migration of an existing system?
   - For a migration, what should the directory that holds the new implementation be called?
   - Event sourcing or CRUD? Recommend event sourcing.
   - What is the project called? It becomes the package scope, so it must be lower-case kebab-case.
   - Which GitHub user or team owns the rules files? CODEOWNERS names it.
2. **Prepare the target.** For a new project, the target is the directory the session runs in. Stop and ask if it already contains files other than `.git`. For a migration, the target is the root of the existing repository and the new directory must not exist yet. Stop and ask if it does. Do not move or change any existing file.
3. **Run the bootstrap script.** From this repository, run `bun scripts/bootstrap.ts --target <target> --name <project> --owner <owner> --state <event-sourcing|crud>`. Add `--title <Project>` for a display name and `--migration <app-dir>` for a migration. The script copies `template/`, including dotfiles. It keeps each conditional block whose flag is set, deletes every other block and drops the files of the other mode. It fills `<project>`, `<Project>`, `<owner>`, `<app-dir>`, `<app-root>` and `<workflow-prefix>`.
   - For a migration, the script writes `.github/` at the repository root, because GitHub reads workflows only there. Each workflow is named `<app-dir>-<name>.yml`, runs from `<app-dir>/` and triggers only on changes inside it. Everything else goes into `<app-dir>/`.
   - The script never overwrites a file. When a destination exists, it writes nothing and lists the conflicts. Stop and ask the user how to merge them. With their agreement, run it again with `--skip-existing`. It then leaves those files untouched and prints a rendered copy of each one to merge by hand, such as an existing CODEOWNERS or pull request template.
4. **Write the description.** Write the paragraph that the comments at the top of `README.md` and `CLAUDE.md` ask for. Use the same paragraph in both and delete both comments. Ask the user for it if you cannot draft it.
5. **Install and verify.** Run `bun install`, then `bun verify`, from the new project's root (`<app-dir>/` for a migration). A fresh copy must pass both. If either fails, stop and report the failure.
6. **Complete `DOMAIN.md`.** Work through it one section at a time.
   - For a new project, interview the user. Propose terms, states and invariants from their answers. Ask the user to confirm each one.
   - For a migration, read the existing code and documents outside the new directory first. Draft each section from what you find. List every invariant the existing code enforces with the file that enforces it. Ask the user to confirm each one.

   Replace the `<Domain>`, `<Entity>`, `<entity>`, `<ENTITY>`, `<Term>` and `<path to core model>` placeholders as you go. Delete each guidance comment once its section is written.
7. **Build the model.** The checks compare `DOMAIN.md` with the code, so a completed `DOMAIN.md` fails `bun verify` until the code agrees with it. Bring the code up to date in this order:
   - Declare every command, event, status and invariant name from the tables in `core/vocabulary.ts`.
   - Write the state, command and event types at the path `DOMAIN.md` names. Derive their names from the vocabulary.
   - Write the decider and evolve function, or the guard for CRUD, with the assertions `DOMAIN.md` describes.
   - Add one property per invariant with the `invariant` helper in `core/tests/`, plus example tests for each transition.

   Follow the core of `examples/account/` in this repository for the shape. Leave the shell to wren.
8. **Plan the migration.** Skip this step for a new project. Assess the existing system against the aspects in the migration section of this repository's `README.md`. Write the assessment and the plan to `docs/migration-plan.md` in the new directory. The plan lists every invariant from `DOMAIN.md`, expresses the data model as schemas and names the routing config that shifts traffic. Replace `<routing config>` in `CLAUDE.md` with its path.
9. **Verify the finished project.** Run `bun verify` and `bun mutation` from the project root. Fix what they report until both pass. Never hand over a project that fails either one.
10. **Hand over.** Delete the temporary copy of arca. Do not commit. Summarise what you created and list the open questions left in `DOMAIN.md`. Name each file the script left untouched for a manual merge. Tell the user that CI deploys a disposable environment for every pull request. It needs a GitHub environment named `ephemeral` with `AWS_REGION` and `AWS_DEPLOY_ROLE_ARN` for an account that is not production. The account stack must already exist in that account. Offer to deploy a disposable environment. Ask before you run any command that touches AWS.

## Extending arca

Follow these rules when the user asks you to change arca itself, such as to add an organisation standard, a skill or a tool.

- **Change the template.** Everything a project receives lives in `template/`. Put a skill in `template/.claude/skills/<name>/SKILL.md`, a rule in `template/.claude/rules/`, a command in `template/.claude/commands/` and a tool in `template/tools/<name>/` as a workspace package.
- **Keep the template green.** Run `bun install` once in this repository, then `bun run test`. It runs `scripts/test-bootstrap.ts`, which bootstraps all four profiles into temporary directories and runs `bun install` and `bun verify` on each fresh copy. It then lays `examples/account/` over each copy and runs `bun verify` and `bun mutation`. Last, it applies deliberate architecture, domain and concurrency breakages and checks that each one fails `bun verify` for the expected reason. Every profile must pass. Never run `bun install` or `bun verify` inside `template/`: the placeholders are not valid package names.
- **Mark content that depends on an answer.** Put it in a conditional block. A block starts at an `if: <flag>` marker and runs to the next `if` marker or the `end` marker. Write the marker as a comment in the file's own syntax, alone on its line: `<!-- if: crud -->` in Markdown, `// if: crud` in TypeScript and GritQL, `# if: crud` in YAML, CODEOWNERS and `.gitignore`. Blocks do not nest. A file that holds only one mode's code goes inside a block from its first line to its last, so the other mode never receives it. Reuse the existing flags where you can. A new flag needs a question in step 1 and support in `scripts/bootstrap.ts`.
- **Use a placeholder for every project-specific value.** A new placeholder needs a bootstrap step that fills it. The script fills a value it can derive from the answers. The agent fills one that needs the interview.
- **Turn each new rule into a check.** Enforce it with a Biome rule, a type, a fitness function in `template/tools/fitness/` or an infrastructure assertion. Add a row to the anti-pattern table in `template/ARCHITECTURE.md`. Mark the row review if no check can enforce the rule. Add a breakage to `scripts/test-bootstrap.ts` that proves the check fails.
- **Keep the example working.** When a change to the template alters an interface the example uses, update `examples/account/` in the same change.
- **Pin every new dependency in the catalog.** Add its exact version to the `catalog` in `template/package.json`.
- **Keep each rule in one place.** An instruction file for another agent points at the existing documents. It does not copy them.
- **Update the documents that describe the change.** A change to bootstrapping updates the steps above. A change to what arca offers updates `README.md`. Write all prose to the writing skill in `template/.claude/skills/writing/SKILL.md`.
