# arca

arca packages an agent-optimised architecture as a project template. `template/` is the project an agent copies into the user's repository.

## Bootstrapping a project

Follow these steps when the user asks you to bootstrap a project with arca. The source is this repository. Step 2 sets the target.

1. **Ask the questions.** Ask them one at a time and wait for each answer.
   - Is this a new project or a migration of an existing system?
   - For a migration, what should the directory that holds the new implementation be called?
   - Event sourcing or CRUD? Recommend event sourcing.
   - What is the project called?
2. **Prepare the target.** For a new project, the target is the directory the session runs in. Stop and ask if it already contains files other than `.git`. For a migration, the target is the new directory inside the existing repository. Stop and ask if it already exists. Do not move or change any existing file.
3. **Copy the template.** Copy everything in `template/` into the target, including dotfiles such as `.claude/` and `.gitignore`. Never overwrite an existing file. Stop and ask instead.
4. **Resolve the conditional blocks.** The answer on a new project or a migration sets `greenfield` or `migration`. The answer on event sourcing or CRUD sets `event-sourcing` or `crud`. A block starts at `<!-- if: <flag> -->` and runs to the next `if` marker or `<!-- end -->`. Keep each block whose flag is set. Delete every other block and every marker.
5. **Fill the project placeholders.** Replace `<project>` and `<Project>` with the project name. For a migration, replace `<app-dir>` with the directory name. Write the description that the comment at the top of `CLAUDE.md` asks for. Ask the user for it if you cannot draft it.
6. **Install and verify.** Run `bun install`, then `bun verify`, from the target. A fresh copy of the template must pass both. If either fails, stop and report the failure.
7. **Complete `DOMAIN.md`.** Work through it one section at a time.
   - For a new project, interview the user. Propose terms, states and invariants from their answers. Ask the user to confirm each one.
   - For a migration, read the existing code and documents outside the target first. Draft each section from what you find. List every invariant the existing code enforces with the file that enforces it. Ask the user to confirm each one.

   Replace the `<Domain>`, `<Entity>`, `<entity>`, `<ENTITY>` and `<Term>` placeholders as you go. Delete each guidance comment once its section is written.
8. **Plan the migration.** Skip this step for a new project. Assess the existing system against the aspects in the migration section of this repository's `README.md`. Write the assessment and the plan to `docs/migration-plan.md` in the target. The plan lists every invariant from `DOMAIN.md`, expresses the data model as schemas and names the routing config that shifts traffic. Replace `<routing config>` in `CLAUDE.md` with its path.
9. **Hand over.** Delete the temporary copy of arca. Do not commit. Summarise what you created and list the open questions left in `DOMAIN.md`. Offer to deploy a disposable environment. Ask before you run any command that touches AWS.

## Extending arca

Follow these rules when the user asks you to change arca itself, such as to add an organisation standard, a skill or a tool.

- **Change the template.** Everything a project receives lives in `template/`. Put a skill in `template/.claude/skills/<name>/SKILL.md`, a rule in `template/.claude/rules/`, a command in `template/.claude/commands/` and a tool in `template/tools/<name>/` as a workspace package.
- **Keep the template green.** Copy `template/` to a temporary directory, replace `<project>` with a sample name, then run `bun install` and `bun verify` there. A fresh copy must pass both. Never run them inside `template/`: the placeholders are not valid package names.
- **Mark content that depends on an answer.** Put it in a conditional block. Reuse the existing flags where you can. A new flag needs a question in step 1 and a rule in step 4.
- **Use a placeholder for every project-specific value.** A new placeholder needs a bootstrap step that fills it.
- **Turn each new rule into a check.** Enforce it with a Biome rule, a type, a fitness function in `template/tools/fitness/` or an infrastructure assertion. Add a row to the anti-pattern table in `template/ARCHITECTURE.md`. Mark the row review if no check can enforce the rule.
- **Pin every new dependency in the catalog.** Add its exact version to the `catalog` in `template/package.json`.
- **Keep each rule in one place.** An instruction file for another agent points at the existing documents. It does not copy them.
- **Update the documents that describe the change.** A change to bootstrapping updates the steps above. A change to what arca offers updates `README.md`. Write all prose to the writing skill in `template/.claude/skills/writing/SKILL.md`.
