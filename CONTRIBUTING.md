# Contributing

## Keeping the Collection in Sync with the API

The Spacelift GraphQL schema evolves over time. Three npm scripts help keep the collection accurate and complete:

```bash
npm install

# Validate all requests against the live schema — reports broken fields, renamed
# mutations, or missing required arguments
npm run validate

# Sync documentation into the docs { } block of each .bru file — schema
# descriptions for requests, scripts/folder-docs.js for folders.
# Idempotent; safe to run repeatedly
npm run sync-docs

# Check without writing: every folder documented and every docs block current
npm run sync-docs:check-folders   # offline, instant — also runs in pre-commit
npm run sync-docs:check           # the above plus request docs (needs the schema)

# Report coverage: how many schema operations have a corresponding request file
npm run coverage
npm run coverage -- --ignore-deprecated
```

No credentials are required — all three scripts use public schema introspection.

If you have Claude Code installed, run `/sync-schema` to validate, fix any issues, sync docs, and report coverage in one step.

## Updating the Changelog

[CHANGELOG.md](./CHANGELOG.md) records what changed for the people sending these requests. Entries are collected from git rather than written by hand, so the workflow is: commit your request changes first, then collect.

```bash
npm run collection-changelog:collect   # write entries for commits since .collection-changelog-commit
npm run collection-changelog:sync      # mirror the newest entries into Bruno's Docs pane
```

To rebuild the file from scratch, empty `.collection-changelog-commit` and delete the entries below the preamble; `collect` then reads from the first commit. Note that rewording is lost, so this is a bootstrap step, not routine maintenance.

`collect` reads every commit since the one recorded in `.collection-changelog-commit` and derives an entry from each `.bru` file that appeared, disappeared, gained a deprecation notice, or changed in a `fix:` commit. Everything else — doc syncs, chores, refactors — is invisible to users and produces no entry.

Reword anything that reads like a commit subject rather than a note to a user, particularly the reason on a `Fixed` entry: it should say what was wrong with the request, since anyone who copied that request is still holding the broken version. Entries already in the file are never rewritten by a later `collect`, so polish survives.

Don't worry about where an entry goes. Each run re-sorts every section — grouped by kind, then in the order Bruno draws the requests in its sidebar — so a line pasted anywhere in its date's section ends up in the right place. Running `collect` with nothing new to collect does the sort on its own.

Commit the changelog, the checkpoint and `Spacelift/collection.bru` together. `npm run collection-changelog:check` is what CI runs; it fails if request changes have no entries, or if Bruno's docs pane has fallen behind the file.

## Pre-Commit Hook

A [pre-commit](https://pre-commit.com/) config is included. It runs `npm run validate` automatically whenever `.bru` files are staged, catching schema errors before they reach CI.

Install pre-commit using your preferred method ([installation docs](https://pre-commit.com/#installation)), then run:

```bash
pre-commit install
```

`npm install` must be run at least once beforehand (the hook uses your local `node_modules`).

## Adding New Requests

> [!TIP]
> If you have Claude Code installed, run `/sync-schema`. It validates all existing requests, fixes schema errors, syncs docs, and reports coverage gaps in one step. Use the coverage output to identify missing operations, then create files for the ones you want to add.

If Claude Code is not available, add requests manually:

1. Find the operation name using `npm run coverage -- --ignore-deprecated`.
2. Create a `.bru` file in the appropriate folder under `Spacelift/`, following the format of existing files in that folder.
3. Run `npm run validate` to confirm the new request is schema-valid.
4. Run `npm run sync-docs` to populate the `docs { }` block from the schema description.

## File Format

All request files follow this structure:

```
meta {
  name: <human-readable name>
  type: graphql
  seq: <order within folder>
}

docs {
  <populated automatically by sync-docs from the schema — do not hand-edit>

  <!-- notes: hand-written, preserved by sync-docs -->
  <optional notes; see "Adding Notes to a Request" below>
}

post {
  url: {{SPACELIFT_ENDPOINT}}
  body: graphql
  auth: inherit
}

body:graphql {
  <raw GraphQL operation — no "query:" prefix>
}

body:graphql:vars {
  {
    <JSON variables with realistic placeholder values>
  }
}
```

Use obvious placeholder strings like `STACK_ID_HERE` for required ID arguments.

`auth: inherit` takes the bearer token from `Spacelift/collection.bru`, so a new request needs no `auth:bearer` block of its own. Don't add one — the token lives in exactly one place.

## Adding Notes to a Request

A request's docs come from the schema, and `sync-docs` rewrites them every run. To add something the schema cannot say — where to get an ID, which request to send first, which values an argument really accepts — put it below this marker inside the `docs { }` block:

```
<!-- notes: hand-written, preserved by sync-docs -->
```

Everything from that line down is preserved verbatim; everything above it is regenerated. You can add it from Bruno's own Docs editor — it renders as markdown, so the marker itself is invisible in the Docs pane.

Please write notes for what actually trips people up rather than restating the schema. If the schema _could_ say it, it is better fixed there.

## Adding a New Folder

Folders carry their own documentation, and it is not generated — the schema cannot tell a reader which order to send things in or which folder supersedes another.

If you add a folder, add an entry for it to [`scripts/folder-docs.js`](./scripts/folder-docs.js) and run `npm run sync-docs`. The pre-commit hook and CI both fail on an undocumented folder, so you will not get far without it.

Keep entries to three or four sentences: what the folder is for, what order things happen in, and the one thing that will otherwise trip someone up. Anything specific to a single operation belongs in the schema description, where `sync-docs` picks it up on its own.

## Destructive Requests

Requests whose name contains `Delete`, `Destroy`, `Revoke`, `Reset`, `Yank`, `Unlink`, `Clean`, `Purge` or `Eject` take their IDs as prompt variables instead of placeholders:

```
"id": "{{?Stack ID}}"
```

Bruno asks for each one at send time, and cancelling the dialog cancels the request. It also means the collection runner and CLI skip these requests, since neither can prompt — so a collection run can't delete anything.

Add a destructive request the normal way, then run `npm run destructive-prompts` to convert its placeholders. The pre-commit hook and CI fail if you forget.
