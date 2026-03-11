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

### Step 4 — Update README

12. Read the **Collection Structure** section in `README.md`. It contains a single summary line of the form: "The collection covers X operations across Y folders, including all non-deprecated Spacelift API endpoints."
13. Update X to match the current `.bru` file count (`find Spacelift -name "*.bru" | grep -v environments | wc -l`) and Y to match the number of unique folders.

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
