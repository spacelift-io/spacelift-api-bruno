# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install                                    # install the single dependency (graphql)

npm run validate                               # validate all .bru files against the live schema
npm run sync-docs                              # sync schema descriptions + deprecations into docs {} blocks
npm run coverage                               # show which schema operations have no .bru file
npm run coverage -- --ignore-deprecated        # same, hiding deprecated operations
npm run coverage -- --show-covered             # also list covered operations
npm run coverage -- --show-ignored             # list what the IGNORED set filters out
npm run coverage -- --check-baseline           # exit 1 if coverage regressed past .coverage-baseline
npm run coverage -- --check-deprecated-marks   # exit 1 if a deprecated op's .bru file isn't marked deprecated
npm run changelog                              # changelog entries since .changelog-checkpoint

npm run format                                 # format js/json/yaml/md files with prettier
npm run format:check                           # check formatting without writing
npm run pre-commit:update                      # freeze/update pre-commit hook revisions

# The three schema scripts accept --endpoint to target a non-demo account:
node scripts/validate-schema.js --endpoint https://myaccount.app.spacelift.io/graphql
node scripts/sync-docs.js --dry-run            # preview docs changes without writing
node scripts/changelog-since.js --url <url>    # read a changelog page other than the default
```

No credentials are required. All scripts introspect `https://demo.app.spacelift.io/graphql` publicly.

## Architecture

### Collection Layout

`Spacelift/` is the Bruno collection root (`bruno.json` marks it). It contains:

- `environments/local.bru` — environment variables (`SPACELIFT_ENDPOINT`, `SPACELIFT_API_KEY_ID`, `SPACELIFT_API_KEY_SECRET`, `jwt`). The tracked template is `local.bru.example`; the real file, `local.bru`, is gitignored.
- Subfolders of `.bru` request files grouped by resource type, one operation per file. `npm run validate` reports the current file count.

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

`validate-schema.js`, `sync-docs.js` and `coverage.js` share the same core helpers:

- `post(url, body)` — raw HTTPS POST (no dependencies beyond Node built-ins + `graphql` package)
- `extractGraphQL(content)` — brace-depth tracking to extract the `body:graphql { ... }` block from .bru text
- `findBruFiles(dir)` — recursive directory walker

**`validate-schema.js`**: Fetches schema via introspection, parses the GraphQL from each .bru file, runs `graphql.validate()`, reports PASS/FAIL per file.

**`coverage.js`**: Walks the schema's Query and Mutation root fields, maps them against which root fields appear in .bru files (`extractRootFields`), reports missing operations. Has a hardcoded `IGNORED` set for intentionally out-of-scope operations: analytics events, UI state, OAuth flows, billing, SSO/SAML, notifications, autocomplete suggestions, and internal debug fields. Run `npm run coverage -- --show-ignored` to see the current list.

**`changelog-since.js`**: Fetches `https://docs.spacelift.io/product/changelog` and prints the entries dated after `.changelog-checkpoint`, split on the page's `<h2 id="YYYY-MM-DD">` anchors. It deliberately does no matching — the changelog is free-form prose, and the GraphQL lines under its Deprecations headings are verbatim `deprecationReason` strings already surfaced by `coverage.js`. Its value is removals and retirements that introspection cannot express. `--since <date>` overrides the checkpoint; `--list-dates` prints dates only. The only script that does not talk to the GraphQL endpoint.

**`sync-docs.js`**: Builds a map of root field name → docs text, then for each .bru file inserts or replaces a `docs { ... }` block using `upsertDocsBlock`. The docs text is the schema field's `deprecationReason` (as a `⚠ **DEPRECATED** — ...` first line, when present) followed by its `description`. The block is placed after `meta { }` if it doesn't exist yet. Lines are indented with 2 spaces. Idempotent.

### Changelog Checkpoint

`.changelog-checkpoint` holds a single ISO date — the newest changelog entry that has been reviewed. `/sync-schema` prints everything after it and advances it once reviewed. The file itself is the source of truth for where the review stands; `npm run changelog` prints what is still pending.

### Coverage Baseline

`.coverage-baseline` holds a single integer: the maximum acceptable count of missing (non-deprecated, non-ignored) schema operations. `npm run coverage -- --check-baseline` fails CI if live coverage regresses past it. The count is always computed over non-deprecated operations, independent of whether `--ignore-deprecated` was passed for display purposes. When intentionally adding scope to the collection (or deciding to leave new operations uncovered), update this number to the current missing count reported by `npm run coverage -- --ignore-deprecated`.

### Deprecated Operations

Deprecated operations are **not** removed from the collection — they stay supported by the API, so removing them would break users who still rely on them. Instead they are marked, to discourage new use:

- Every deprecated root field in the schema carries a `deprecationReason`, and in practice each one names its replacement. `sync-docs.js` writes it into the request's `docs { }` block as `⚠ **DEPRECATED** — <reason>`, ahead of the description, so the notice is the first thing in Bruno's Docs pane.
- `npm run coverage -- --check-deprecated-marks` fails if a covered operation is deprecated in the schema but its `.bru` file carries no marker — i.e. a _newly_ deprecated operation that hasn't been synced. The fix is always `npm run sync-docs`.
- The marker string is duplicated as `DEPRECATED_MARKER` in both `sync-docs.js` (writer) and `coverage.js` (checker); change both together.
- Deprecation is never itself a CI failure. `coverage.js` lists deprecated covered operations informationally, under "Deprecated operations kept in the collection". Retirement — the operation actually being removed from the schema — is what fails CI, via `npm run validate`: the request's GraphQL stops validating ("Cannot query field"). That is the signal to act on, and it arrives through the normal validation path with no extra flag.

### Coverage Ignore List

`scripts/coverage.js` has an `IGNORED` set. When a schema operation should not have a .bru file (browser OAuth, billing, SSO, in-app UI state, etc.), add it there rather than creating a placeholder file.
