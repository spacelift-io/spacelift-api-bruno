#!/usr/bin/env node
/**
 * response-examples.js — Attach an illustrative response to key requests.
 *
 * Bruno shows saved response examples beside a request, so you can see the
 * shape of what comes back before you have an account, credentials, or any
 * stacks to list. Without one, a request is a question with no answer next to
 * it: the GraphQL says which fields are asked for, but nothing shows how they
 * nest, which are arrays, or what a timestamp looks like here.
 *
 * These examples are GENERATED FROM THE SCHEMA, not captured from a live
 * account. Every example carries a description saying so, because a fabricated
 * response passed off as a real one is worse than no example at all. What they
 * are accurate about is shape — every field, its nesting and its type come from
 * the schema and from the request's own selection set, so they cannot drift
 * from what the request actually asks for without this script noticing.
 *
 * Values are obviously placeholder ("example-stack", "Example Stack") so nobody
 * mistakes them for real data from somebody's account.
 *
 * Only the requests in EXAMPLE_REQUESTS get one. Doing all 649 would add a few
 * hundred kilobytes of synthetic JSON to every clone to little end; these are
 * the ones people open first.
 *
 * Usage:
 *   node scripts/response-examples.js            write the examples
 *   node scripts/response-examples.js --check    exit 1 if any is stale
 *   node scripts/response-examples.js --dry-run  show what would change
 */

const {
  buildClientSchema,
  getIntrospectionQuery,
  parse,
  getNamedType,
  isObjectType,
  isInterfaceType,
  isUnionType,
  isEnumType,
  isListType,
  isNonNullType,
} = require("graphql");
const { bruToJsonV2, jsonToBruV2 } = require("@usebruno/lang");
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

const DEFAULT_ENDPOINT = "https://demo.app.spacelift.io/graphql";
const COLLECTION_DIR = path.join(__dirname, "../Spacelift");

const EXAMPLE_NAME = "Example response";
const EXAMPLE_DESCRIPTION =
  "Illustrative, generated from the schema — not captured from a live account. " +
  "The shape and field names are exact; the values are placeholders.";

/**
 * The requests worth carrying an example. Everything people open first: the
 * list endpoints that answer "what does this account have", and the run
 * lifecycle that most scripts are built around.
 */
const EXAMPLE_REQUESTS = [
  "Account/List Outgoing IP Addresses.bru",
  "Advanced/Viewer/Viewer.bru",
  "API Keys/List API Keys.bru",
  "Contexts/List Contexts.bru",
  "Modules/List Modules.bru",
  "Policies/List Policies.bru",
  "Runs/Confirm Run.bru",
  "Runs/Get Run.bru",
  "Runs/Trigger Run.bru",
  "Spaces/List Spaces.bru",
  "Stacks/Get Stack.bru",
  "Stacks/List Stacks.bru",
  "Stacks/Search Stacks.bru",
  "Version Catalog/List Terraform Versions.bru",
  "Worker Pools/List Worker Pools.bru",
];

const args = process.argv.slice(2);
const endpointFlag = args.indexOf("--endpoint");
const ENDPOINT =
  endpointFlag !== -1 ? args[endpointFlag + 1] : DEFAULT_ENDPOINT;
const CHECK = args.includes("--check");
const DRY_RUN = args.includes("--dry-run");

function post(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const data = JSON.stringify(body);
    const req = lib.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(raw));
          } catch {
            reject(new Error(`Failed to parse response: ${raw}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Value synthesis
// ---------------------------------------------------------------------------

// A fixed point in time, so regenerating produces no diff.
const EXAMPLE_EPOCH = 1758000000; // 2025-09-16T05:20:00Z

const humanize = (name) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());

/** "labels" -> "label", so a list item doesn't read "example-labels". */
const singularize = (name) => (/[^s]s$/.test(name) ? name.slice(0, -1) : name);

/** A placeholder value for one scalar field, chosen from its name and type. */
function scalarValue(fieldName, typeName, parentTypeName, inList = false) {
  if (typeName === "Boolean") {
    // Read the field name rather than always saying true, so a "deleted" or
    // "disabled" flag doesn't imply a broken example object.
    return !/^(deleted|disabled|locked|drained|obsolete|yanked)/i.test(
      fieldName,
    );
  }

  if (typeName === "Int") {
    if (/(^|[a-z])At$|^timestamp|Timestamp$/i.test(fieldName)) {
      return EXAMPLE_EPOCH;
    }
    if (/count$|^num|size$|priority$/i.test(fieldName)) return 1;
    return 1;
  }

  if (typeName === "Float") return 1;

  // ID and String. Ordered most specific first; the last two are the fallback.
  if (fieldName === "id") return `example-${parentTypeName.toLowerCase()}`;
  if (/(^|[a-z])Id$/.test(fieldName)) {
    return `example-${fieldName.replace(/Id$/, "").toLowerCase()}`;
  }
  if (fieldName === "name") return `Example ${humanize(parentTypeName)}`;
  if (fieldName === "description")
    return `Example ${humanize(parentTypeName)} description`;
  // "root" is the real name of every account's top-level space, so this one is
  // accurate rather than merely plausible.
  if (fieldName === "space") return "root";
  if (fieldName === "email") return "someone@example.com";
  if (/url$/i.test(fieldName)) return "https://example.com";
  if (/branch$/i.test(fieldName)) return "main";
  if (/^repository$|repo$/i.test(fieldName)) return "example-org/example-repo";
  if (/^projectRoot$/.test(fieldName)) return "terraform/production";
  if (/sha$/i.test(fieldName)) return "0".repeat(40);
  if (/^jwt$|token$/i.test(fieldName)) return "example-token";
  if (/version$/i.test(fieldName)) return "1.0.0";
  if (/^address$|^ip/i.test(fieldName)) return "203.0.113.1";

  const base = inList ? singularize(fieldName) : fieldName;
  if (typeName === "ID") return `example-${base.toLowerCase()}`;
  return `example-${base}`;
}

/**
 * A representative member of an enum.
 *
 * The first member is often a placeholder — RunState and RunType both start at
 * UNKNOWN, StackState at NONE — and an example reading "UNKNOWN" suggests
 * something went wrong rather than showing what a normal response looks like.
 */
function enumValue(type) {
  const values = type.getValues();
  const representative = values.find(
    (v) => !/^(UNKNOWN|NONE|UNSPECIFIED|UNRECOGNIZED|NOT_SET)$/.test(v.name),
  );
  return (representative ?? values[0])?.name ?? null;
}

/**
 * Build a value for one selection set against `type`.
 *
 * Aliases win over field names, matching what the server would return. Unions
 * and interfaces resolve against whichever concrete type the selection set
 * names, and inline fragments are flattened in, which is how the collection's
 * polymorphic requests are written.
 */
function selectionValue(schema, type, selectionSet, seen) {
  const named = getNamedType(type);

  if (isEnumType(named)) return enumValue(named);
  if (!isObjectType(named) && !isInterfaceType(named) && !isUnionType(named)) {
    return null; // handled by the caller for scalars
  }
  if (!selectionSet) return null;

  const out = {};
  const fields =
    isObjectType(named) || isInterfaceType(named) ? named.getFields() : {};

  for (const selection of selectionSet.selections) {
    if (selection.kind === "InlineFragment") {
      const fragmentType = selection.typeCondition
        ? schema.getType(selection.typeCondition.name.value)
        : named;
      const nested = selectionValue(
        schema,
        fragmentType,
        selection.selectionSet,
        seen,
      );
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        // __typename tells a reader which branch of the union this is.
        Object.assign(out, nested);
        if (selection.typeCondition) {
          out.__typename = selection.typeCondition.name.value;
        }
      }
      continue;
    }
    if (selection.kind !== "Field") continue;

    const fieldName = selection.name.value;
    const key = selection.alias?.value ?? fieldName;

    if (fieldName === "__typename") {
      out[key] = named.name;
      continue;
    }

    const field = fields[fieldName];
    if (!field) continue;

    out[key] = fieldValue(schema, field.type, selection, named.name, seen);
  }

  return out;
}

/** A value for one field, unwrapping non-null and list wrappers as it goes. */
function fieldValue(
  schema,
  type,
  selection,
  parentTypeName,
  seen,
  inList = false,
) {
  if (isNonNullType(type)) {
    return fieldValue(
      schema,
      type.ofType,
      selection,
      parentTypeName,
      seen,
      inList,
    );
  }

  if (isListType(type)) {
    const inner = fieldValue(
      schema,
      type.ofType,
      selection,
      parentTypeName,
      seen,
      true,
    );
    return inner === null ? [] : [inner];
  }

  const named = getNamedType(type);

  if (isEnumType(named)) return enumValue(named);

  if (isObjectType(named) || isInterfaceType(named) || isUnionType(named)) {
    // Guard against a self-referential selection (a stack's dependencies'
    // stacks, say) recursing forever.
    if (seen.has(named.name) && seen.get(named.name) > 2) return null;
    seen.set(named.name, (seen.get(named.name) ?? 0) + 1);
    const value = selectionValue(schema, named, selection.selectionSet, seen);
    seen.set(named.name, seen.get(named.name) - 1);
    return value;
  }

  return scalarValue(selection.name.value, named.name, parentTypeName, inList);
}

/** The full `{ "data": ... }` payload for one operation. */
function buildResponse(schema, query) {
  const doc = parse(query);
  const operation = doc.definitions.find(
    (d) => d.kind === "OperationDefinition",
  );
  if (!operation) return null;

  const rootType =
    operation.operation === "mutation"
      ? schema.getMutationType()
      : schema.getQueryType();
  if (!rootType) return null;

  return {
    data: selectionValue(schema, rootType, operation.selectionSet, new Map()),
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

function buildExample(json, responseBody) {
  return {
    name: EXAMPLE_NAME,
    description: EXAMPLE_DESCRIPTION,
    request: {
      url: json.http?.url ?? "{{SPACELIFT_ENDPOINT}}",
      method: "POST",
      body: {
        mode: "graphql",
        graphql: {
          query: json.body?.graphql?.query ?? "",
          variables: json.body?.graphql?.variables ?? "",
        },
      },
    },
    response: {
      status: 200,
      statusText: "OK",
      headers: [{ name: "content-type", value: "application/json" }],
      body: {
        type: "json",
        content: JSON.stringify(responseBody, null, 2),
      },
    },
  };
}

const EXAMPLE_BLOCK_START = /^example \{/m;

/**
 * Replace the file's example blocks, touching nothing else.
 *
 * Serializing the whole file with jsonToBruV2 and writing that back would be
 * simpler, but it puts two writers with different formatting habits on the same
 * file: Bruno's serializer indents a blank line inside a docs block as two
 * spaces, sync-docs.js leaves it empty, and the two then rewrite each other
 * forever with `--check` failing in between.
 *
 * So Bruno's serializer is still what formats the example — it is the authority
 * on that syntax — but only its example blocks are taken, and they are spliced
 * onto a file that is otherwise byte-for-byte unchanged. jsonToBruV2 emits
 * examples last, which is what makes the tail safe to cut at.
 */
function spliceExamples(source, json) {
  const serialized = jsonToBruV2(json);
  const start = serialized.search(EXAMPLE_BLOCK_START);
  if (start === -1) return source;

  // Bruno's serializer indents its blank separator lines, which the repo's
  // trailing-whitespace pre-commit hook then strips — leaving the file
  // permanently "stale" by --check's reckoning. Trim to match the hook.
  const block = serialized
    .slice(start)
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd();
  const existing = source.search(EXAMPLE_BLOCK_START);
  const head = (existing === -1 ? source : source.slice(0, existing)).trimEnd();

  return `${head}\n\n${block}\n`;
}

async function main() {
  process.stdout.write(`Fetching schema from ${ENDPOINT} ... `);
  let introspection;
  try {
    const res = await post(ENDPOINT, { query: getIntrospectionQuery() });
    if (res.errors)
      throw new Error(res.errors.map((e) => e.message).join(", "));
    introspection = res.data;
    console.log("OK");
  } catch (err) {
    console.error(`FAILED\n  ${err.message}`);
    process.exit(1);
  }

  const schema = buildClientSchema(introspection);

  let written = 0;
  let unchanged = 0;
  const problems = [];

  for (const rel of EXAMPLE_REQUESTS) {
    const filePath = path.join(COLLECTION_DIR, rel);
    if (!fs.existsSync(filePath)) {
      problems.push(`${rel} — listed in EXAMPLE_REQUESTS but no such file`);
      continue;
    }

    const source = fs.readFileSync(filePath, "utf8");
    const json = bruToJsonV2(source);
    const query = json.body?.graphql?.query;
    if (!query) {
      problems.push(`${rel} — no GraphQL body`);
      continue;
    }

    let responseBody;
    try {
      responseBody = buildResponse(schema, query);
    } catch (err) {
      problems.push(`${rel} — could not build a response: ${err.message}`);
      continue;
    }
    if (!responseBody) {
      problems.push(`${rel} — no operation found in the GraphQL body`);
      continue;
    }

    // Replace ours; leave any example a human saved from a real response.
    const others = (json.examples ?? []).filter((e) => e.name !== EXAMPLE_NAME);
    json.examples = [...others, buildExample(json, responseBody)];

    const updated = spliceExamples(source, json);
    if (updated === source) {
      unchanged++;
      continue;
    }

    if (CHECK) {
      problems.push(
        `${rel} — example is out of date. Run \`npm run response-examples\`.`,
      );
      continue;
    }

    if (!DRY_RUN) fs.writeFileSync(filePath, updated, "utf8");
    written++;
    console.log(`  ${DRY_RUN ? "(dry-run) " : ""}example  ${rel}`);
  }

  console.log(
    `\n${written} written, ${unchanged} already up to date, of ${EXAMPLE_REQUESTS.length}`,
  );

  if (problems.length > 0) {
    console.log(`\n✖ ${problems.length} problem(s):\n`);
    for (const p of problems) console.log(`  ${p}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
