---
description: Validate all Bruno requests against the live Spacelift GraphQL schema and fix any failures.
allowed-tools: Bash, Read, Edit
---

Validate all Bruno requests against the live Spacelift GraphQL schema, fix any failures, then report coverage gaps.

## Process

### Step 1 — Validate Existing Files

1. Run `node scripts/validate-schema.js` and capture output.
2. If all pass, skip to Step 2.
3. For each failing file, read the error message(s) carefully:
   - "Cannot query field X on type Y" → field was renamed or removed; introspect the type to find the correct name
   - "Field X of type T! must have a selection of subfields" → T is now an OBJECT type; introspect T and add `{ id name }` (or relevant scalar fields)
   - "Abstract type X must resolve to an Object type at runtime" / "must have a selection of `__typename`" → T is a UNION type; replace any field selection with `{ __typename }`
   - "Field X must not have a selection since type T has no subfields" → T is a scalar or enum; remove the sub-selection `{ ... }` entirely
   - "Unknown argument X on field Mutation.Y" → argument was renamed or removed; check the mutation's current args via introspection
   - "argument X of type T! is required, but not provided" → new required arg added; introspect the mutation, add it with a sensible placeholder in both the operation signature and `body:graphql:vars`
   - "Variable $X of type A used in position expecting type B" → fix the variable type declaration to match B exactly; pay attention to nullability (`T` vs `T!`) and list wrapping (`[T!]!`)
4. After all edits, re-run `node scripts/validate-schema.js` and confirm 0 failures before continuing.

### Step 2 — Sync Docs

5. Run `node scripts/sync-docs.js` and capture output.
6. This updates or inserts a `docs { ... }` block in every .bru file with the schema field's description. Files whose root operation has no schema description are left untouched.
7. Report how many files were updated vs already up-to-date.

### Step 3 — Check Coverage

8. Run `node scripts/coverage.js --ignore-deprecated` and capture output.
9. Report the coverage summary (e.g. "47% — 202 missing operations").
10. Highlight any newly uncovered operations that look like significant additions to the API — things that weren't missing before or that belong to resource types already covered by the collection.
11. Do **not** automatically create new files. Coverage gaps require human judgment about what's worth implementing.
    Coverage also prints a **Deprecated but still in use** section — operations that have a .bru file but carry a `deprecationReason`. Report these with their suggested replacements; they are the next removals. Do not migrate them automatically, since the replacement often has a different shape.

### Step 4 — Cross-Reference the Product Changelog

12. Run `node scripts/api-changelog.js`. It prints every changelog entry newer than the date in `.api-changelog-checkpoint`, newest first.
13. The changelog is free-form prose with no feed and no topic tags, so read the entries — do not grep them for `GraphQL`. Most lines under a **Deprecations** heading are verbatim copies of the schema's own `deprecationReason` and tell you nothing Step 3 did not already report. Look instead for what introspection cannot express:
    - **Removals** — an operation that is gone leaves no trace in the schema. When Step 1 reports `Cannot query field X`, the changelog is the only place that says what replaced it, or whether it was withdrawn rather than renamed.
    - **Retirements filed under another heading** — a capability that moved is often a _Features_ or _Improvements_ entry with no `GraphQL` prefix, even when it removes operations. These are exactly the ones a keyword search misses.
    - **Dated notices** — a host, transport or endpoint being sunset on a deadline. No `deprecationReason` carries these.
14. Cross-reference what you find against Step 1's failures and Step 3's "Deprecated but still in use" list. Report which entries explain a failure, and which describe a change the collection should react to that no check has caught.
15. Do **not** edit .bru files on the strength of a changelog entry alone — confirm against introspection first. The schema is the source of truth; the changelog is the explanation.
16. Once the entries have been reviewed, update `.api-changelog-checkpoint` to the newest date printed.

## Step 5 — Check the README

17. Read the **Collection Structure** section in `README.md`. It describes the collection qualitatively — "all Spacelift API endpoints, organized into folders by resource type" — and deliberately carries no operation or folder counts. Full coverage is the aim; the gap Step 3 reports is a backlog to work through, not a caveat to add here.
18. Do not add counts to this section. A reader here is deciding whether the collection covers the API at all — "all" versus "some" is the useful distinction, not whether the figure is 355 or 358. Anyone who needs exact numbers runs `npm run coverage`; a digit in the README only rots between runs of this command.
19. Only edit this section if the _shape_ of the collection changed — for example if requests stop being organized by resource type. Report any such change rather than rewriting the section unprompted.

## Step 6 — Record What Changed

20. If Step 1 fixed any request, or requests were added or removed, those changes belong in `CHANGELOG.md`. Entries are derived from commits, so this step only works once the request changes are committed — if they are still in the working tree, say so and stop here rather than committing on the user's behalf.
21. Run `npm run collection-changelog:collect`, then `npm run collection-changelog:sync`.
22. Read the `Fixed` entries it wrote. Each one takes its reason from the commit subject, which describes the repository rather than the request — reword it to say what was wrong with the request itself, since anyone who copied it is still holding the broken version. "correct invalid variable payloads in 34 requests" becomes "its sample variables used values the API rejects".
23. Re-run `npm run collection-changelog:sync` after rewording, and report the entries added.

## How to Introspect

Use a single `curl` to batch-check multiple types or mutations at once rather than one call per issue. Examples:

```bash
# Check a type's kind (OBJECT, UNION, ENUM, SCALAR, INPUT_OBJECT, INTERFACE) and its fields
curl -s -X POST https://demo.app.spacelift.io/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ __type(name: \"TypeName\") { kind fields { name type { kind name ofType { kind name } } } } }"}' \
  | python3 -c "
import json,sys
t = json.load(sys.stdin)['data']['__type']
print('kind:', t['kind'])
if t['fields']:
    for f in t['fields']: print(f['name'], f['type'])
"

# Check mutation arguments and return type
curl -s -X POST https://demo.app.spacelift.io/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ __schema { mutationType { fields { name type { kind name ofType { kind name ofType { kind name } } } args { name type { name kind ofType { name kind } } } } } } }"}' \
  | python3 -c "
import json,sys
for f in json.load(sys.stdin)['data']['__schema']['mutationType']['fields']:
    if f['name'] in ['mutationNameHere']:
        print('returns:', f['type'])
        print('args:', [(a['name'], a['type']) for a in f['args']])
"
```

**Common type patterns:**

- `kind: OBJECT` with fields → requires `{ field1 field2 }` sub-selection
- `kind: UNION` → requires `{ __typename }` (or inline fragments for specific types)
- `kind: ENUM` or `kind: SCALAR` → no sub-selection allowed
- `kind: NON_NULL` wrapping `OBJECT` → same as OBJECT, sub-selection required
- `kind: LIST` wrapping `OBJECT` → same as OBJECT, sub-selection required

## Rules

- When fixing schema errors, edit only the `body:graphql { ... }` block and `body:graphql:vars { ... }` block — never touch `meta`, `post`, `auth`, or `seq`.
- The `docs { ... }` block is managed exclusively by `sync-docs.js` — do not hand-edit it.
- Keep `body:graphql:vars` placeholder values realistic (e.g. `"STACK_ID_HERE"`, `3600` for duration seconds, `[]` for empty arrays).
- Never create new .bru files during sync — only fix existing ones.
