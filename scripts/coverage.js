#!/usr/bin/env node
/**
 * Reports which Spacelift GraphQL operations have no corresponding .bru file.
 *
 * Works in the opposite direction from validate-schema.js:
 *   validate-schema.js  — given files, are they valid?
 *   coverage.js         — given the schema, which operations have no file?
 *
 * No credentials required — uses the public introspection endpoint.
 *
 * Usage:
 *   node scripts/coverage.js
 *   node scripts/coverage.js --endpoint https://myaccount.app.spacelift.io/graphql
 *   node scripts/coverage.js --show-covered        also list covered operations
 *   node scripts/coverage.js --ignore-deprecated   hide deprecated operations
 *   node scripts/coverage.js --show-advanced       list the advanced operations by category
 *   node scripts/coverage.js --check-baseline      exit 1 if coverage regressed past .coverage-baseline
 *   node scripts/coverage.js --check-deprecated-marks
 *                                                  exit 1 if a deprecated op's .bru file isn't marked deprecated
 *   node scripts/coverage.js --check-advanced-marks
 *                                                  exit 1 if an advanced op's .bru file isn't marked advanced
 */

const { buildClientSchema, getIntrospectionQuery, parse } = require("graphql");
const {
  ADVANCED,
  CATEGORIES,
  ADVANCED_MARKER,
} = require("./advanced-operations");
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_ENDPOINT = "https://demo.app.spacelift.io/graphql";
const COLLECTION_DIR = path.join(__dirname, "../Spacelift");
const BASELINE_FILE = path.join(__dirname, "../.coverage-baseline");

// Deprecated operations are kept, not removed — they stay supported, and the
// collection discourages use by marking them. sync-docs.js writes this marker
// into the docs block from the schema's deprecationReason; the two must agree.
const DEPRECATED_MARKER = "**DEPRECATED**";

const args = process.argv.slice(2);
const endpointFlag = args.indexOf("--endpoint");
const ENDPOINT =
  endpointFlag !== -1 ? args[endpointFlag + 1] : DEFAULT_ENDPOINT;
const SHOW_COVERED = args.includes("--show-covered");
const IGNORE_DEPRECATED = args.includes("--ignore-deprecated");
const SHOW_ADVANCED = args.includes("--show-advanced");
const CHECK_BASELINE = args.includes("--check-baseline");
const CHECK_DEPRECATED_MARKS = args.includes("--check-deprecated-marks");
const CHECK_ADVANCED_MARKS = args.includes("--check-advanced-marks");

function readBaseline() {
  try {
    const raw = fs.readFileSync(BASELINE_FILE, "utf8").trim();
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers (shared with validate-schema.js)
// ---------------------------------------------------------------------------

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
          } catch (e) {
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

function extractGraphQL(content) {
  const marker = "body:graphql {";
  const start = content.indexOf(marker);
  if (start === -1) return null;

  let i = start + marker.length;
  let depth = 1;
  let body = "";

  while (i < content.length && depth > 0) {
    const ch = content[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) break;
    }
    body += ch;
    i++;
  }

  return body.trim() || null;
}

function findBruFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findBruFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".bru")) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Parse a GraphQL operation string and return its root fields, each qualified
 * by operation type: "query { stacks { id } }" → Set { "Query.stacks" }.
 *
 * Qualified because a name can be both a Query and a Mutation field with
 * different metadata — templateVersionParseTemplate is live as a query and
 * deprecated as a mutation — and a file covering one must not be credited with
 * covering the other.
 */
function extractRootFields(gql) {
  let doc;
  try {
    doc = parse(gql);
  } catch {
    return new Set();
  }

  const fields = new Set();
  for (const def of doc.definitions) {
    if (def.kind === "OperationDefinition") {
      for (const sel of def.selectionSet.selections) {
        if (sel.kind === "Field") {
          const kind = def.operation === "mutation" ? "Mutation" : "Query";
          fields.add(`${kind}.${sel.name.value}`);
        }
      }
    }
  }
  return fields;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Files covering a root field, looked up by bare name across both operation
 * types. The advanced list is keyed by bare name, so a lookup there has to try
 * Query and Mutation.
 */
function filesCovering(coveredBy, name) {
  return [
    ...(coveredBy.get(`Query.${name}`) ?? []),
    ...(coveredBy.get(`Mutation.${name}`) ?? []),
  ];
}

async function main() {
  // 1. Fetch schema
  process.stdout.write(`Fetching schema from ${ENDPOINT} ... `);
  let introspectionResult;
  try {
    const res = await post(ENDPOINT, { query: getIntrospectionQuery() });
    if (res.errors)
      throw new Error(res.errors.map((e) => e.message).join(", "));
    introspectionResult = res.data;
    console.log("OK");
  } catch (err) {
    console.error(`FAILED\n  ${err.message}`);
    process.exit(1);
  }

  const schema = buildClientSchema(introspectionResult);

  // 2. Collect all Query and Mutation root fields from schema
  const schemaOps = { Query: new Map(), Mutation: new Map() };

  // The set the baseline check measures against: non-deprecated ops, collected
  // regardless of --ignore-deprecated so the CLI flag can't change what the
  // baseline compares against. Advanced operations are in scope and counted
  // here like any other — they are labelled, not excluded.
  const baselineOps = new Set();

  for (const typeName of ["Query", "Mutation"]) {
    const type = schema.getType(typeName);
    if (!type) continue;
    for (const [name, field] of Object.entries(type.getFields())) {
      if (name.startsWith("__")) continue;
      const deprecated = !!field.deprecationReason;
      if (!deprecated) baselineOps.add(`${typeName}.${name}`);
      if (IGNORE_DEPRECATED && deprecated) continue;
      schemaOps[typeName].set(name, {
        deprecated,
        reason: field.deprecationReason,
        advanced: ADVANCED.has(name),
      });
    }
  }

  // Every deprecated root field, collected before --ignore-deprecated filtering
  // so that "deprecated but still in use" is reported either way.
  const deprecatedOps = new Map();
  for (const typeName of ["Query", "Mutation"]) {
    const type = schema.getType(typeName);
    if (!type) continue;
    for (const [name, field] of Object.entries(type.getFields())) {
      if (name.startsWith("__")) continue;
      if (!field.deprecationReason) continue;
      deprecatedOps.set(name, { typeName, reason: field.deprecationReason });
    }
  }

  const totalOps = schemaOps.Query.size + schemaOps.Mutation.size;

  // Advanced operations present in this schema. The list is maintained by hand,
  // so an entry can outlive the operation it names; counting against the live
  // schema keeps the report honest and surfaces stale entries.
  const advancedInSchema = new Set();
  const advancedStale = [];
  for (const name of ADVANCED.keys()) {
    const inSchema = ["Query", "Mutation"].some((t) =>
      Object.hasOwn(schema.getType(t)?.getFields() ?? {}, name),
    );
    if (inSchema) advancedInSchema.add(name);
    else advancedStale.push(name);
  }

  // 3. Scan .bru files and collect covered root fields
  const bruFiles = findBruFiles(COLLECTION_DIR);
  const covered = new Set();
  const coveredBy = new Map();

  for (const filePath of bruFiles) {
    const content = fs.readFileSync(filePath, "utf8");
    if (!content.includes("body:graphql")) continue;
    const gql = extractGraphQL(content);
    if (!gql) continue;
    for (const field of extractRootFields(gql)) {
      covered.add(field);
      if (!coveredBy.has(field)) coveredBy.set(field, []);
      coveredBy.get(field).push(path.relative(COLLECTION_DIR, filePath));
    }
  }

  // 4. Report
  const coveredCount = [
    ...[...schemaOps.Query.keys()].map((n) => `Query.${n}`),
    ...[...schemaOps.Mutation.keys()].map((n) => `Mutation.${n}`),
  ].filter((key) => covered.has(key)).length;

  const pct = Math.round((coveredCount / totalOps) * 100);
  const filterNote = IGNORE_DEPRECATED ? "  (deprecated hidden)" : "";

  console.log(
    `\nCoverage: ${coveredCount}/${totalOps} operations (${pct}%)${filterNote}`,
  );
  console.log(`Scanned:  ${bruFiles.length} .bru files`);
  console.log(
    `Advanced: ${advancedInSchema.size} operation(s) in ${Object.keys(CATEGORIES).length} categories are in scope but labelled advanced\n`,
  );

  if (advancedStale.length > 0) {
    console.log(
      `⚠ ${advancedStale.length} advanced entries no longer exist in the schema — remove from scripts/advanced-operations.js:`,
    );
    for (const name of advancedStale.sort()) console.log(`     ✗  ${name}`);
    console.log();
  }

  const deprecatedCovered = [...deprecatedOps.entries()]
    .filter(([name, { typeName }]) => coveredBy.has(`${typeName}.${name}`))
    .sort(([a], [b]) => a.localeCompare(b));

  if (deprecatedCovered.length > 0) {
    console.log(
      `── Deprecated operations kept in the collection ${"─".repeat(14)}`,
    );
    console.log(
      `   ${deprecatedCovered.length} covered operation(s) are deprecated in the schema. They are kept on`,
    );
    console.log(
      `   purpose — still supported, marked in their docs block to steer users to the`,
    );
    console.log(
      `   replacement. Informational; a retired operation fails 'npm run validate' instead.\n`,
    );
    for (const [name, { typeName, reason }] of deprecatedCovered) {
      console.log(`   ○  ${typeName}.${name}`);
      console.log(`      ${reason}`);
      for (const file of coveredBy.get(`${typeName}.${name}`)) {
        console.log(`      → ${file}`);
      }
    }
    console.log();
  }

  if (SHOW_ADVANCED) {
    console.log(`── Advanced operations ${"─".repeat(38)}`);
    console.log(
      `   In scope and documented, but not the everyday surface. Each request's docs`,
    );
    console.log(
      `   block carries an ${ADVANCED_MARKER} notice explaining why.\n`,
    );
    for (const [key, { folder, note, operations }] of Object.entries(
      CATEGORIES,
    )) {
      const live = operations.filter((n) => advancedInSchema.has(n));
      if (live.length === 0) continue;
      console.log(`   ${folder}  (${key}, ${live.length})`);
      console.log(`      ${note}`);
      for (const name of live.sort()) {
        const isCovered = filesCovering(coveredBy, name).length > 0;
        console.log(`      ${isCovered ? "✓" : "✗"}  ${name}`);
      }
      console.log();
    }
  }

  for (const typeName of ["Query", "Mutation"]) {
    const ops = schemaOps[typeName];
    const missing = [...ops.entries()].filter(
      ([name]) => !covered.has(`${typeName}.${name}`),
    );
    const present = [...ops.entries()].filter(([name]) =>
      covered.has(`${typeName}.${name}`),
    );

    console.log(`── ${typeName} ─────────────────────────────────────────────`);
    console.log(`   ${present.length} covered, ${missing.length} missing\n`);

    if (missing.length > 0) {
      console.log(`   Missing:`);
      for (const [name, { deprecated, advanced }] of missing.sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        const tag =
          (deprecated ? "  [deprecated]" : "") +
          (advanced ? "  [advanced]" : "");
        console.log(`     ✗  ${name}${tag}`);
      }
      console.log();
    }

    if (SHOW_COVERED && present.length > 0) {
      console.log(`   Covered:`);
      for (const [name, { deprecated, advanced }] of present.sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        const tag =
          (deprecated ? "  [deprecated]" : "") +
          (advanced ? "  [advanced]" : "");
        console.log(`     ✓  ${name}${tag}`);
      }
      console.log();
    }
  }

  if (CHECK_DEPRECATED_MARKS) {
    // Deprecated operations are kept on purpose, so being deprecated is not a
    // failure — going unmarked is. Anything listed here just needs sync-docs.
    const unmarked = [];
    for (const [name] of deprecatedCovered) {
      for (const rel of filesCovering(coveredBy, name)) {
        const content = fs.readFileSync(path.join(COLLECTION_DIR, rel), "utf8");
        if (!content.includes(DEPRECATED_MARKER)) unmarked.push([name, rel]);
      }
    }

    if (unmarked.length > 0) {
      console.log(
        `\n✗ ${unmarked.length} deprecated operation(s) are not marked deprecated in their .bru file:`,
      );
      for (const [name, rel] of unmarked) {
        console.log(`     ✗  ${name}  →  ${rel}`);
      }
      console.log(
        `  Run 'npm run sync-docs' to write the schema's deprecationReason into their docs blocks.`,
      );
      process.exitCode = 1;
    } else {
      console.log(
        `\n✓ All ${deprecatedCovered.length} deprecated-but-covered operation(s) are marked deprecated.`,
      );
    }
  }

  if (CHECK_ADVANCED_MARKS) {
    // Mirrors --check-deprecated-marks. Being advanced is not a failure; an
    // advanced operation whose request does not say so is, because then nothing
    // tells the reader this is off the beaten path. Fix with sync-docs.
    const unmarked = [];
    for (const name of advancedInSchema) {
      for (const rel of filesCovering(coveredBy, name)) {
        const content = fs.readFileSync(path.join(COLLECTION_DIR, rel), "utf8");
        if (!content.includes(ADVANCED_MARKER)) unmarked.push([name, rel]);
      }
    }

    if (unmarked.length > 0) {
      console.log(
        `\n✗ ${unmarked.length} advanced operation(s) are not marked advanced in their .bru file:`,
      );
      for (const [name, rel] of unmarked) {
        console.log(`     ✗  ${name}  →  ${rel}`);
      }
      console.log(
        `  Run 'npm run sync-docs' to write the advanced notice into their docs blocks.`,
      );
      process.exitCode = 1;
    } else {
      const coveredAdvanced = [...advancedInSchema].filter(
        (n) => filesCovering(coveredBy, n).length > 0,
      ).length;
      console.log(
        `\n✓ All ${coveredAdvanced} covered advanced operation(s) are marked advanced.`,
      );
    }
  }

  if (CHECK_BASELINE) {
    const totalMissing = [...baselineOps].filter(
      (name) => !covered.has(name),
    ).length;
    const baseline = readBaseline();
    if (baseline === null) {
      console.log("⚠ No .coverage-baseline found — skipping baseline check.");
    } else if (totalMissing > baseline) {
      console.log(
        `\n✗ Coverage regressed: ${totalMissing} operations missing (baseline: ${baseline}).`,
      );
      console.log(
        `  New schema operations have no .bru file. Run 'npm run coverage -- --ignore-deprecated --show-covered'`,
      );
      console.log(
        `  to see what's new, add .bru files (labelling any niche ones in scripts/advanced-operations.js`,
      );
      console.log(
        `  ones), then update .coverage-baseline to ${totalMissing}.`,
      );
      process.exitCode = 1;
    } else {
      console.log(
        `\n✓ Coverage baseline OK (${totalMissing} missing, baseline ${baseline}).`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
