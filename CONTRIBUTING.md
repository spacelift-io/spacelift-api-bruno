# Contributing

## Keeping the Collection in Sync with the API

The Spacelift GraphQL schema evolves over time. Three npm scripts help keep the collection accurate and complete:

```bash
npm install

# Validate all requests against the live schema — reports broken fields, renamed
# mutations, or missing required arguments
npm run validate

# Sync documentation from schema descriptions into the docs { } block of each
# .bru file — idempotent; safe to run repeatedly
npm run sync-docs

# Report coverage: how many schema operations have a corresponding request file
npm run coverage
npm run coverage -- --ignore-deprecated
```

No credentials are required — all three scripts use public schema introspection.

If you have Claude Code installed, run `/sync-schema` to validate, fix any issues, sync docs, and report coverage in one step.

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
  <populated automatically by sync-docs — do not hand-edit>
}

post {
  url: {{SPACELIFT_ENDPOINT}}
  body: graphql
  auth: bearer
}

auth:bearer {
  token: {{jwt}}
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
