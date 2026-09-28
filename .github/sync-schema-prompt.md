You are running inside the weekly sync check of this repository, a Bruno
collection for the Spacelift GraphQL API. The checks at the end of this prompt
failed against the live schema. The mechanical fixes (`npm run sync-docs`,
`npm run destructive-prompts`) have already been applied. What is left needs
judgment, and that is your job. A maintainer reviews everything you change in
a pull request before it merges.

Read `AGENTS.md` first. It is the authority on how requests are laid out, and
the rules below point into it.

## Fix requests that no longer validate

Follow Step 1 of `.claude/commands/sync-schema.md`: it maps each validation
error to its fix. Edit only the `body:graphql` and `body:graphql:vars` blocks
of an existing request.

## Add a request for every missing operation

Unlike `/sync-schema`, you do create files here: every operation the coverage
check lists as missing gets a `.bru` file.

- **Introspect it** with `node scripts/introspect.js Mutation.<name>` (or
  `Query.<name>`, or a type name to see its fields). This is the only way to
  reach the schema in this job.
- **Place it** in the folder of the resource it acts on. Read that folder's
  requests first and match their naming (`Delete Run Logs`, not
  `runLogsDelete`), their selection sets and their placeholders
  (`STACK_ID_HERE`). Use the next free `seq` in the folder.
- **Write the file** in the format under **.bru File Format** in `AGENTS.md`,
  with `auth: inherit` and no `docs` block — `npm run sync-docs` writes it.
- **Danger Zone.** Decide whether the operation is hard or impossible to
  revert, per **Danger Zone** in `AGENTS.md`. The line is revertibility, not
  blast radius. If it belongs there, create it in `Spacelift/Danger Zone/`
  instead, add it to that folder's list in `scripts/folder-docs.js`, and add
  "**<name>** is in **Danger Zone**." to the docs of the folder it would
  otherwise have lived in.
- **Advanced.** If the operation is clearly account administration, billing,
  SSO or in-app UI plumbing, add it to the matching category in
  `scripts/advanced-operations.js`. When in doubt, leave it out: a wrong label
  discourages legitimate use.

## Finish

Run, in order, and fix anything they report:

1. `npm run destructive-prompts`
2. `npm run sync-docs`
3. `npm run validate`
4. `npm run coverage -- --ignore-deprecated --check-baseline --check-deprecated-marks --check-advanced-marks`
5. `npm test`

Do not commit, and do not touch `CHANGELOG.md`, `.collection-changelog-commit`,
`.coverage-baseline`, `.github/`, or any script other than
`scripts/folder-docs.js` and `scripts/advanced-operations.js`. The job rejects
changes outside `Spacelift/` and those two files.

If something cannot be fixed with confidence, leave it and say so. A failing
check the reviewer knows about is better than a guess that passes.

Your structured output's `summary` becomes part of the pull request
description. Write it for the reviewer, in Markdown: one bullet per request you
added or changed, saying where you put it and why — in particular every Danger
Zone and advanced decision, since those are the calls a reviewer should check.
Then anything you left unresolved. No preamble.

## Failed checks
