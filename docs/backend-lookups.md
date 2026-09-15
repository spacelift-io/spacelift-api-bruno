# Looking up values in the API backend

Introspection gives the _shape_ of every operation: argument names, types, enum
members, which fields are non-null. That is enough to write a request that
validates.

It is not enough to write a request that **works**. A handful of arguments are
typed `String!` in the schema but only accept certain values, decided by code in
the API backend. Those values cannot be derived from the schema, and a wrong one
passes `npm run validate` and then fails against a real account.

This document is how to find them. It exists because the lookups are not
obvious, and repeating the search from scratch costs more than reading this.

## Configuring the path

The backend is a separate private repository,
[`spacelift-io/backend`](https://github.com/spacelift-io/backend). Everything
below assumes `$SPACELIFT_BACKEND` points at your local clone:

```bash
export SPACELIFT_BACKEND=~/Projects/backend   # wherever you cloned it
```

Set it wherever you keep shell config; there is no default, because the path
differs per person. Every command below is written relative to it, so nothing in
this repository hardcodes a location.

Nothing in this collection's tooling reads the backend — `validate`, `coverage`
and `sync-docs` all work from public introspection alone, with no credentials
and no clone. This is a manual reference for the rare case where a value cannot
come from the schema.

## Ground rules

**Take values from definitions, not from tests.** A test value is valid, but it
was chosen to exercise a code path, so it is often atypical. Test files are also
where internal detail lives — real account identifiers, staging hostnames — and
this collection is public. Use generated files, enum declarations and embedded
data as the source; treat a matching test value as corroboration.

**Prefer a runtime lookup when one exists.** Several of these values are
themselves queryable. If the collection can tell a user "run this request to see
the valid values", that beats hardcoding a value that will age.

## Layout

| Path                                                   | What is there                                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `$SPACELIFT_BACKEND/server/resolvers/schema/*.graphql` | The GraphQL schema, split by domain. The comments are good and usually explain what a loosely-typed field accepts. |
| `$SPACELIFT_BACKEND/server/resolvers/<domain>/`        | Resolvers — argument validation lives here.                                                                        |
| `$SPACELIFT_BACKEND/shared/<domain>/`                  | Domain logic, embedded data, generated tables.                                                                     |

Start with the `.graphql` file. Its comments are the fastest route and often
name the query that returns the valid values.

```bash
grep -rn "ScanScopeInput" "$SPACELIFT_BACKEND/server/resolvers/schema/"
```

## Worked example: scan provider version

`ScanProviderConfigInput.version` is `String!`. The schema comment says:

> Provider major to pin the scan to, one of `ScanProviderSchema.majorVersions`.

So the valid set is whatever `scanProviderSchemas` returns — already covered by
`Spacelift/Scans/List Scan Provider Schemas.bru`. To find what it returns today:

```bash
grep -n "func Majors" -A 8 "$SPACELIFT_BACKEND/shared/scans/schemas/provider.go"
grep -n "Version:" "$SPACELIFT_BACKEND/shared/scans/schemas/schemas_gen.go" | head -1
```

`Majors()` returns the major of the single embedded release, and the generated
file pins that release. At the time of writing it is `6.61.0`, so the only
accepted value is `"6"`. The collection originally guessed `"5"`, which
validated fine and would have been rejected by the API.

This value moves when the embedded provider is upgraded. It is a major version,
so not often — but it is not permanent, and `List Scan Provider Schemas` is the
request that answers it live.

## Worked example: scan scope type

`ScanScopeInput.type` is `String!`. The schema comment on `ScanListSchema.type`
says it matches `ScanScope.type`, and the list schemas come from the same
generated file:

```bash
grep -oE '"aws_[a-z0-9_]+"' "$SPACELIFT_BACKEND/shared/scans/schemas/schemas_gen.go" | sort -u
```

204 resource types at the time of writing, `aws_s3_bucket` among them. Also the
value the backend's own scan tests use, which is a useful cross-check.

## When you find something

Fix the `.bru` file, then record the finding here if the lookup was not obvious.
The point of this document is that the second person to need a value does not
repeat the first person's search.

Values that are merely illustrative — `"my-stack"`, `"user@example.com"`,
`"My policy"` — need none of this. They are placeholders doing their job, and
the backend has no opinion on them.
