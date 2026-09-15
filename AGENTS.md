# AGENTS.md

This file provides guidance to AI agents when working with code in this repository.

## Commands

```bash
npm install                                    # install the single dependency (graphql)

npm run validate                               # validate all .bru files against the live schema
npm run sync-docs                              # sync schema descriptions + deprecations into docs {} blocks, and folder docs into folder.bru
npm run sync-docs:check                        # exit 1 if any request or folder docs block is stale (needs the schema)
npm run sync-docs:check-folders                # exit 1 if a folder is undocumented or stale (offline, instant)
npm run coverage                               # show which schema operations have no .bru file
npm run coverage -- --ignore-deprecated        # same, hiding deprecated operations
npm run coverage -- --show-covered             # also list covered operations
npm run coverage -- --show-advanced            # list the advanced operations by category
npm run coverage -- --check-baseline           # exit 1 if coverage regressed past .coverage-baseline
npm run coverage -- --check-deprecated-marks   # exit 1 if a deprecated op's .bru file isn't marked deprecated
npm run coverage -- --check-advanced-marks     # exit 1 if an advanced op's .bru file isn't marked advanced
npm run collection-changelog:collect            # write changelog entries for new commits
npm run collection-changelog:sync              # mirror the newest entries into Bruno's docs pane
npm run collection-changelog:check             # exit 1 if either of those is out of date
npm run api-changelog                          # Spacelift's own changelog since .api-changelog-checkpoint

npm run format                                 # format js/json/yaml/md files with prettier
npm run format:check                           # check formatting without writing
npm run pre-commit:update                      # freeze/update pre-commit hook revisions

# The three schema scripts accept --endpoint to target a non-demo account:
node scripts/validate-schema.js --endpoint https://myaccount.app.spacelift.io/graphql
node scripts/sync-docs.js --dry-run                       # preview docs changes without writing
node scripts/api-changelog.js --url <url>                 # read a changelog page other than the default
node scripts/collection-changelog.js --sync --entries 8   # show fewer entries in Bruno's docs pane
node scripts/collection-changelog.js --collect --dry-run  # preview changelog entries without writing
```

No credentials are required. All scripts introspect `https://demo.app.spacelift.io/graphql` publicly.

## Architecture

### Collection Layout

`Spacelift/` is the Bruno collection root (`bruno.json` marks it). It contains:

- `environments/my-account.bru` — the one environment that ships with the collection, and the only one tracked in git (`.gitignore` excludes every other file in that directory). It holds `SPACELIFT_ENDPOINT` and `SPACELIFT_API_KEY_ID` as plain vars, and `SPACELIFT_API_KEY_SECRET` and `jwt` as **secret** vars.

  Tracking it is safe because of how Bruno serializes secrets: `jsonToEnv` filters every variable marked secret out of the `vars { }` block and emits only its _name_ into `vars:secret [ ]`, keeping the value in an OS-encrypted store outside the collection. A committed environment therefore cannot leak a key secret or a token, however many times `bru.setEnvVar("jwt", …)` runs.

  This is load-bearing, not incidental. It is what lets setup be "fill in three fields in the app" instead of "find the clone on disk, copy a template, create an environment by hand" — the step users dropped out at. Never move `jwt` out of `vars:secret`: it would start writing live tokens into a tracked file.

- Subfolders of `.bru` request files grouped by resource type, one operation per file. `npm run validate` reports the current file count.
- `collection.bru` — collection-level settings. It holds a `script:pre-request` block (see **Authentication Flow**) and a `docs { }` block written by `collection-changelog.js --sync`, which is what Bruno shows in the collection's Docs pane. Do not hand-edit the docs block; `--sync` replaces it wholesale and leaves every other block alone, so the script, and any auth, headers or vars added through Bruno's UI, survive.
- A `folder.bru` in every folder, holding a `meta { }` block and the folder's `docs { }`. Written by `sync-docs.js` from `scripts/folder-docs.js` — see **Folder Docs** below. `Advanced/folder.bru` additionally carries `seq: 99`, which pins `Advanced` to the bottom of the sidebar; see **Advanced Operations**.

Bruno sorts folders alphabetically and then splices any folder carrying a valid `seq` in at index `seq - 1`, so a folder's position is settled entirely by its `folder.bru` — no instruction in this file can move it. Every folder but `Advanced` is deliberately seq-less and therefore alphabetical.

The README tells users to install the collection with Bruno's **Import Collection → Git Repository** clone, which scans the whole cloned repository for `bruno.json` files. That is why `Spacelift/` can sit in a subfolder alongside `scripts/` and `docs/` — nothing requires the collection at the repository root.

### .bru File Format

```
meta { name: ...; type: graphql; seq: <order> }

docs {
  <managed by sync-docs.js — do not hand-edit>
}

post { url: {{SPACELIFT_ENDPOINT}}; body: graphql; auth: inherit }

body:graphql {
  <raw GraphQL operation — no "query:" prefix>
}

body:graphql:vars {
  { <JSON variables> }
}
```

`seq` controls ordering within a folder. IDs in vars use placeholder strings like `STACK_ID_HERE`.

`auth: inherit` means "use the collection's auth", resolved by Bruno's `prepare-request.js`: a request whose mode is `inherit` takes the collection's `auth { mode: bearer }` and gets `Authorization: Bearer {{jwt}}`. New requests should use `inherit` and carry no `auth:bearer` block of their own — the token is configured in exactly one place, `collection.bru`. `Auth/Get Token.bru` is the sole exception, at `auth: none`.

### Folder Docs

Every folder carries a `docs { }` block, which Bruno renders in its Docs pane the same way it renders a request's. The text lives in `scripts/folder-docs.js`, keyed by folder path relative to `Spacelift/`.

These are hand-written, and have to be: a schema describes one operation at a time and can never say which order to send them in, that Templates supersede Blueprints, or that a cloud integration attached to nothing does nothing. That is precisely what someone needs before they start clicking through 25 requests.

- `npm run sync-docs` writes them, alongside the request docs it takes from the schema.
- `npm run sync-docs:check-folders` fails if a folder has no entry, has an entry but no folder, or has a stale file. It touches no network, so it runs in pre-commit and on pull requests.
- `npm run sync-docs:check` is the same plus request docs, which do need the schema. That one runs in the weekly job, where schema drift is expected and opens an issue rather than failing somebody's PR.

Two invariants in `buildFolderBru` protect the sidebar, and both are easy to break by accident:

- **`seq` is preserved, never invented.** Bruno orders folders alphabetically and splices only the ones carrying a `seq` in at `seq - 1`. Writing a `seq` into a folder that had none would move it; dropping `Advanced`'s would move 196 administrative requests to the top of the sidebar.
- **`meta.name` defaults to the directory name.** Bruno sorts on the meta name when a folder has one, so a name that differs from its directory reorders the sidebar just as effectively.

When changing either, verify by dumping the sidebar order before and after and diffing — the rules are reimplemented in `collection-changelog.js`'s `buildSidebarOrder`.

### Authentication Flow

Authentication is automatic. `collection.bru`'s `script:pre-request` block runs before every request, decodes the `exp` claim of the `jwt` environment variable, and mints a replacement via `apiKeyUser` when the token is missing, unreadable or within two minutes of expiring. Users never send a token request; requests just work.

Details that matter if you touch it:

- **It calls `axios` directly, not `bru.runRequest("Auth/Get Token")`.** Bruno documents that `runRequest` from a _collection-level_ pre-request script can recurse infinitely, because the request it runs triggers the same script again. `axios` and `atob` are both in Bruno's Safe Mode allowlist, so this needs no sandbox change — keep it that way.
- **A token it cannot read counts as unusable**, not as good. Being wrong in that direction costs one round trip; the other direction is the authentication failure the script exists to prevent.
- **`MANAGES_ITS_OWN_TOKEN` skips `Get Token`, `Refresh Token` and `Logout`** by `req.getName()`. Without that, the script would mint a token purely for those requests to replace or discard.
- **An unconfigured environment throws with the missing variable names**, before any network call. The default `SPACELIFT_ENDPOINT` counts as unset — otherwise the failure is a DNS error for the literal host `myaccount.app.spacelift.io`.
- **`npm run validate` checks the mutation inside the script.** It has no `body:graphql` block, so the file loop would skip it; `extractCollectionScriptGraphQL` pulls the `GET_TOKEN` template literal out instead. Renaming that variable fails the run on purpose rather than silently dropping the check — the alternative is a rename of `apiKeyUser` breaking authentication for every user while CI stays green.

`Auth/Get Token.bru` remains, as the explicit way to obtain a token (to copy one out for use elsewhere), and is still the only request with `auth: none`.

### Scripts

`validate-schema.js`, `sync-docs.js` and `coverage.js` share the same core helpers:

- `post(url, body)` — raw HTTPS POST (no dependencies beyond Node built-ins + `graphql` package)
- `extractGraphQL(content)` — brace-depth tracking to extract the `body:graphql { ... }` block from .bru text
- `findBruFiles(dir)` — recursive directory walker

**`validate-schema.js`**: Fetches schema via introspection, parses the GraphQL from each .bru file, runs `graphql.validate()`, reports PASS/FAIL per file. Files whose document is valid then have their `body:graphql:vars` JSON coerced against the types the operation declares, which `graphql.validate()` never inspects — a wrong enum member or a renamed input field otherwise passes here and fails against a real account. Both count as failures. Files that pass are then checked with `NoDeprecatedCustomRule`, which reports selections of deprecated fields, enum values and input fields. These are printed as warnings and never fail the run — deprecation is information, retirement is the defect. This is the only check that sees deprecation _inside_ a request: `coverage.js` walks root fields only, and selecting a deprecated field is valid GraphQL.

**`coverage.js`**: Walks the schema's Query and Mutation root fields, maps them against which root fields appear in .bru files (`extractRootFields`), reports missing operations. Every schema operation is in scope; the ones listed in `advanced-operations.js` are counted like any other but tagged `[advanced]` in the report. Run `npm run coverage -- --show-advanced` to see them by category. It also reports advanced entries that no longer exist in the schema, since that list is hand-maintained and an operation can be retired out from under it.

**`advanced-operations.js`**: The list of operations that are real but not the everyday surface — account administration, billing, SSO, in-app UI plumbing. Maps each to a category with a `folder` and a user-facing `note`. Imported by `sync-docs.js` (which writes the note) and `coverage.js` (which checks it was written), so membership and wording cannot drift between writer and checker.

**`api-changelog.js`**: Fetches `https://docs.spacelift.io/product/changelog` and prints the entries dated after `.api-changelog-checkpoint`, split on the page's `<h2 id="YYYY-MM-DD">` anchors. It deliberately does no matching — the changelog is free-form prose, and the GraphQL lines under its Deprecations headings are verbatim `deprecationReason` strings already surfaced by `coverage.js`. Its value is removals and retirements that introspection cannot express. `--since <date>` overrides the checkpoint; `--list-dates` prints dates only. The only script that does not talk to the GraphQL endpoint.

**`folder-docs.js`**: Hand-written docs for every folder, keyed by path relative to `Spacelift/`. Imported by `sync-docs.js`, which both writes them and checks them, so a folder cannot be added without documenting it. Same one-module-for-writer-and-checker shape as `advanced-operations.js`.

**`sync-docs.js`**: Builds a map of root field name → docs text, then for each .bru file inserts or replaces a `docs { ... }` block using `upsertDocsBlock`. Also writes each folder's `folder.bru` from `folder-docs.js`. The docs text is the schema field's `deprecationReason` (as a `⚠ **DEPRECATED** — ...` first line, when present), then the `ℹ **ADVANCED** — ...` note if the operation is listed in `advanced-operations.js`, then its `description`. The block is placed after `meta { }` if it doesn't exist yet. Lines are indented with 2 spaces. Idempotent.

**`collection-changelog.js`**: Maintains the collection's own changelog — `CHANGELOG.md` for the full history, and a "What's New" `docs { }` block in `Spacelift/collection.bru` for the newest `DEFAULT_ENTRIES` of it, which is what a user sees in Bruno without leaving the app. Three modes: `--collect` derives entries from git and appends them, `--sync` rewrites the docs block, `--check` fails if either is stale.

Entries are derived, not written, because per-request granularity is only sustainable if a coverage sprint doesn't cost two hundred hand-written lines: a `.bru` file appearing is `Added`, disappearing is `Removed`, gaining `DEPRECATED_MARKER` in its docs block is `Deprecated`, and changing in a `fix:` commit is `Fixed` with the reason taken from the commit subject. A change that leaves the file identical once its docs block is stripped produces nothing — a resynced description is not news.

Ordering, within a date section: grouped by kind as `Removed`, `Deprecated`, `Fixed`, `Added`, so a retirement is never buried under two hundred additions or pushed out of Bruno's pane; and inside each group, the order Bruno draws the sidebar, so scanning the changelog and scanning the sidebar are the same motion. That order is neither alphabetical nor file order — `buildSidebarOrder` reimplements it from Bruno's own `sortItemsBySidebarOrder` and `sortByNameThenSequence` (folders first, alphabetical with `seq` folders spliced in at `seq - 1`, then requests by `seq`). Removed requests have no sidebar position left, so they fall to the end of their group alphabetically. If Bruno changes its sort this drifts silently, which is acceptable: it is cosmetic ordering, not correctness.

`--collect` never rewrites the text of an entry, so wording polished by hand survives; it only ever moves lines, re-sorting every section on each run. That makes it idempotent — running it with nothing new to collect is how a hand-edit that landed in the wrong place gets put back. Polish is expected on `Fixed` entries in particular: a commit subject describes the repository, and the reader needs to know what was wrong with the request they may have copied.

### Changelog Checkpoints

Two, for two different changelogs. Keep them straight:

- `.api-changelog-checkpoint` holds a single ISO date — the newest _Spacelift product_ changelog entry that has been reviewed. `/sync-schema` prints everything after it and advances it once reviewed; `npm run api-changelog` prints what is still pending.
- `.collection-changelog-commit` holds a commit SHA — the last commit whose request changes are in `CHANGELOG.md`. `npm run collection-changelog:collect` reads `<sha>..HEAD` and advances it. A squash or rebase merge can orphan that SHA; the script says so and asks for a re-point rather than failing with a raw git error. Emptying the file means "from the first commit" — a range needs a commit on its left and the first commit has no parent, so this is the only way to rebuild the whole history. Emptying it does not clear `CHANGELOG.md`; delete the entries first or the rebuild lands on top of them.

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

The `Advanced/` folder is pinned to the bottom of the sidebar by `seq: 99` in its `folder.bru` — the same policy applied to navigation rather than to docs. It holds roughly 200 of the collection's requests, so alphabetical order would otherwise park all of it between `Account` and `AI Integrations`, in front of everyone looking for `Contexts` or `Runs`.

`99` is deliberately far above the folder count: with every other folder seq-less, any `seq` past the end of the list appends, so adding folders later cannot displace `Advanced`, whereas a `seq` equal to today's count would leave it second-to-last the moment a folder sorting after "Advanced" appears. Deleting the file does not just lose a number — it puts the whole administrative surface back at the top. `CHANGELOG.md` follows the same order, since `buildSidebarOrder` reads this file too.
