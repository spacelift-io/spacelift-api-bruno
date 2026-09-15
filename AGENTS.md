# AGENTS.md

This file provides guidance to AI agents when working with code in this repository.

## Commands

```bash
npm install                                    # install the single dependency (graphql)

npm run validate                               # validate all .bru files against the live schema
npm run sync-docs                              # sync schema descriptions + deprecations into docs {} blocks
npm run coverage                               # show which schema operations have no .bru file
npm run coverage -- --ignore-deprecated        # same, hiding deprecated operations
npm run coverage -- --show-covered             # also list covered operations
npm run coverage -- --show-advanced            # list the advanced operations by category
npm run coverage -- --check-baseline           # exit 1 if coverage regressed past .coverage-baseline
npm run coverage -- --check-deprecated-marks   # exit 1 if a deprecated op's .bru file isn't marked deprecated
npm run coverage -- --check-advanced-marks     # exit 1 if an advanced op's .bru file isn't marked advanced
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

**`validate-schema.js`**: Fetches schema via introspection, parses the GraphQL from each .bru file, runs `graphql.validate()`, reports PASS/FAIL per file. Files whose document is valid then have their `body:graphql:vars` JSON coerced against the types the operation declares, which `graphql.validate()` never inspects — a wrong enum member or a renamed input field otherwise passes here and fails against a real account. Both count as failures. Files that pass are then checked with `NoDeprecatedCustomRule`, which reports selections of deprecated fields, enum values and input fields. These are printed as warnings and never fail the run — deprecation is information, retirement is the defect. This is the only check that sees deprecation _inside_ a request: `coverage.js` walks root fields only, and selecting a deprecated field is valid GraphQL.

**`coverage.js`**: Walks the schema's Query and Mutation root fields, maps them against which root fields appear in .bru files (`extractRootFields`), reports missing operations. Every schema operation is in scope; the ones listed in `advanced-operations.js` are counted like any other but tagged `[advanced]` in the report. Run `npm run coverage -- --show-advanced` to see them by category. It also reports advanced entries that no longer exist in the schema, since that list is hand-maintained and an operation can be retired out from under it.

**`advanced-operations.js`**: The list of operations that are real but not the everyday surface — account administration, billing, SSO, in-app UI plumbing. Maps each to a category with a `folder` and a user-facing `note`. Imported by `sync-docs.js` (which writes the note) and `coverage.js` (which checks it was written), so membership and wording cannot drift between writer and checker.

**`changelog-since.js`**: Fetches `https://docs.spacelift.io/product/changelog` and prints the entries dated after `.changelog-checkpoint`, split on the page's `<h2 id="YYYY-MM-DD">` anchors. It deliberately does no matching — the changelog is free-form prose, and the GraphQL lines under its Deprecations headings are verbatim `deprecationReason` strings already surfaced by `coverage.js`. Its value is removals and retirements that introspection cannot express. `--since <date>` overrides the checkpoint; `--list-dates` prints dates only. The only script that does not talk to the GraphQL endpoint.

**`sync-docs.js`**: Builds a map of root field name → docs text, then for each .bru file inserts or replaces a `docs { ... }` block using `upsertDocsBlock`. The docs text is the schema field's `deprecationReason` (as a `⚠ **DEPRECATED** — ...` first line, when present), then the `ℹ **ADVANCED** — ...` note if the operation is listed in `advanced-operations.js`, then its `description`. The block is placed after `meta { }` if it doesn't exist yet. Lines are indented with 2 spaces. Idempotent.

### Changelog Checkpoint

`.changelog-checkpoint` holds a single ISO date — the newest changelog entry that has been reviewed. `/sync-schema` prints everything after it and advances it once reviewed. The file itself is the source of truth for where the review stands; `npm run changelog` prints what is still pending.

### Coverage Baseline

`.coverage-baseline` holds a single integer: the maximum acceptable count of missing non-deprecated schema operations. Advanced operations count here like any other — labelling an operation does not excuse it from coverage. `npm run coverage -- --check-baseline` fails CI if live coverage regresses past it. The count is always computed over non-deprecated operations, independent of whether `--ignore-deprecated` was passed for display purposes. After adding requests, lower this number to the missing count reported by `npm run coverage -- --ignore-deprecated`, otherwise a later run treats your own improvement as headroom.

### Deprecated Operations

Deprecated operations are **not** removed from the collection — they stay supported by the API, so removing them would break users who still rely on them. Instead they are marked, to discourage new use:

- Every deprecated root field in the schema carries a `deprecationReason`, and in practice each one names its replacement. `sync-docs.js` writes it into the request's `docs { }` block as `⚠ **DEPRECATED** — <reason>`, ahead of the description, so the notice is the first thing in Bruno's Docs pane.
- `npm run coverage -- --check-deprecated-marks` fails if a covered operation is deprecated in the schema but its `.bru` file carries no marker — i.e. a _newly_ deprecated operation that hasn't been synced. The fix is always `npm run sync-docs`.
- The marker string is duplicated as `DEPRECATED_MARKER` in both `sync-docs.js` (writer) and `coverage.js` (checker); change both together.
- Deprecation is never itself a CI failure. `coverage.js` lists deprecated covered operations informationally, under "Deprecated operations kept in the collection". Retirement — the operation actually being removed from the schema — is what fails CI, via `npm run validate`: the request's GraphQL stops validating ("Cannot query field"). That is the signal to act on, and it arrives through the normal validation path with no extra flag.

### Values Introspection Cannot Give You

A few arguments are typed `String!` in the schema but only accept certain values,
decided in the API backend. A wrong one passes `npm run validate` and fails
against a real account — `ScanProviderConfigInput.version` is the known case.

[`docs/backend-lookups.md`](docs/backend-lookups.md) explains how to find them in
the `spacelift-io/backend` repository, with worked examples. It expects
`$SPACELIFT_BACKEND` to point at a local clone; there is no default, since the
path differs per person.

None of the scripts read the backend — they work from public introspection with
no credentials and no clone. This is a manual reference only, for the rare value
the schema cannot express.

### Advanced Operations

**Everything in the schema gets documented.** Deciding which operations are worth exposing is not this collection's job — Spacelift staff and advanced users have real reasons to call the administrative and internal corners of the API, and hiding them only makes them harder to find.

What `scripts/advanced-operations.js` does is _label_ them, so nobody mistakes them for the everyday surface:

- Each operation maps to a category carrying a `folder` and a one-line `note`.
- `sync-docs.js` writes `ℹ **ADVANCED** — <note>` into the request's `docs { }` block, after any deprecation warning and before the description.
- `npm run coverage -- --check-advanced-marks` fails if a covered advanced operation's `.bru` file has no marker — the same shape as `--check-deprecated-marks`. The fix is always `npm run sync-docs`.
- Unlike `DEPRECATED_MARKER`, which is duplicated in `sync-docs.js` and `coverage.js`, `ADVANCED_MARKER` and the operation list live in one module both import. Nothing to keep in sync by hand.

Being advanced is never a CI failure — it is a label, like deprecation. Add new entries to the appropriate category when an operation is clearly administrative or internal plumbing; when in doubt, leave it unlabelled, since a wrong label discourages legitimate use.
