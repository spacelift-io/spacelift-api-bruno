# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install                                    # install the single dependency (graphql)

npm run validate                               # validate all .bru files against the live schema
npm run sync-docs                              # sync schema descriptions into docs {} blocks
npm run coverage                               # show which schema operations have no .bru file
npm run coverage -- --ignore-deprecated        # same, hiding deprecated operations
npm run coverage -- --show-covered             # also list covered operations

# All three scripts accept --endpoint to target a non-demo account:
node scripts/validate-schema.js --endpoint https://myaccount.app.spacelift.io/graphql
node scripts/sync-docs.js --dry-run            # preview docs changes without writing
```

No credentials are required. All scripts introspect `https://demo.app.spacelift.io/graphql` publicly.

## Architecture

### Collection Layout

`Spacelift/` is the Bruno collection root (`bruno.json` marks it). It contains:

- `environments/local.bru` — environment variables (`SPACELIFT_ENDPOINT`, `SPACELIFT_API_KEY_ID`, `SPACELIFT_API_KEY_SECRET`, `jwt`). The example file is `local.bru` but the actual file is gitignored.
- ~54 subfolders of `.bru` request files, one operation per file, 382 request files.

### .bru File Format

```
meta { name: ...; type: graphql; seq: <order> }

docs {
  <managed by sync-docs.js — do not hand-edit>
}

post { url: {{SPACELIFT_ENDPOINT}}; body: graphql; auth: bearer }

auth:bearer { token: {{jwt}} }

body:graphql {
  <raw GraphQL operation — no "query:" prefix>
}

body:graphql:vars {
  { <JSON variables> }
}
```

`seq` controls ordering within a folder. IDs in vars use placeholder strings like `STACK_ID_HERE`.

### Authentication Flow

`Auth/Get Token.bru` is the only request without `auth: bearer`. Its `script:post-response` block extracts `data.apiKeyUser.jwt` and calls `bru.setEnvVar("jwt", ...)`. All other requests reference `{{jwt}}`.

### Scripts

All three scripts share the same core helpers:

- `post(url, body)` — raw HTTPS POST (no dependencies beyond Node built-ins + `graphql` package)
- `extractGraphQL(content)` — brace-depth tracking to extract the `body:graphql { ... }` block from .bru text
- `findBruFiles(dir)` — recursive directory walker

**`validate-schema.js`**: Fetches schema via introspection, parses the GraphQL from each .bru file, runs `graphql.validate()`, reports PASS/FAIL per file.

**`coverage.js`**: Walks the schema's Query and Mutation root fields, maps them against which root fields appear in .bru files (`extractRootFields`), reports missing operations. Has a hardcoded `IGNORED` set (~130 operations) for intentionally out-of-scope operations: analytics events, UI state, OAuth flows, billing, SSO/SAML, notifications, autocomplete suggestions, and internal debug fields.

**`sync-docs.js`**: Builds a map of root field name → schema description, then for each .bru file inserts or replaces a `docs { ... }` block using `upsertDocsBlock`. The block is placed after `meta { }` if it doesn't exist yet. Lines are indented with 2 spaces. Idempotent.

### Coverage Ignore List

`scripts/coverage.js` has an `IGNORED` set. When a schema operation should not have a .bru file (browser OAuth, billing, SSO, in-app UI state, etc.), add it there rather than creating a placeholder file.
