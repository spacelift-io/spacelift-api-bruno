#!/usr/bin/env node
/**
 * Validates all Bruno GraphQL requests against the live Spacelift schema.
 *
 * No credentials required — uses the public introspection endpoint.
 * Catches: renamed mutations/queries, removed/renamed fields, wrong argument types.
 *
 * Usage:
 *   node scripts/validate-schema.js
 *   node scripts/validate-schema.js --endpoint https://myaccount.app.spacelift.io/graphql
 */

const {
  buildClientSchema,
  parse,
  validate,
  getIntrospectionQuery,
} = require("graphql");
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_ENDPOINT = "https://demo.app.spacelift.io/graphql";
const COLLECTION_DIR = path.join(__dirname, "../Spacelift");

const args = process.argv.slice(2);
const endpointFlag = args.indexOf("--endpoint");
const ENDPOINT =
  endpointFlag !== -1 ? args[endpointFlag + 1] : DEFAULT_ENDPOINT;

// ---------------------------------------------------------------------------
// Helpers
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

/**
 * Extract the raw GraphQL string from a .bru file's `body:graphql { ... }` block.
 * Uses brace-depth tracking to handle nested braces correctly.
 */
function extractGraphQL(content) {
  const marker = "body:graphql {";
  const start = content.indexOf(marker);
  if (start === -1) return null;

  // Skip past the opening `{`
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

  // Skip `body:graphql:vars` blocks — only return the operation
  const trimmed = body.trim();
  return trimmed || null;
}

/** Walk a directory recursively, returning all .bru file paths. */
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // 1. Fetch schema via introspection
  process.stdout.write(`Fetching schema from ${ENDPOINT} ... `);
  let introspectionResult;
  try {
    const res = await post(ENDPOINT, { query: getIntrospectionQuery() });
    if (res.errors) {
      throw new Error(res.errors.map((e) => e.message).join(", "));
    }
    introspectionResult = res.data;
    console.log("OK");
  } catch (err) {
    console.error(`FAILED\n  ${err.message}`);
    process.exit(1);
  }

  const schema = buildClientSchema(introspectionResult);

  // 2. Find all .bru files
  const bruFiles = findBruFiles(COLLECTION_DIR);
  console.log(`Found ${bruFiles.length} .bru files\n`);

  // 3. Validate each file
  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const filePath of bruFiles.sort()) {
    const relativePath = path.relative(process.cwd(), filePath);
    const content = fs.readFileSync(filePath, "utf8");

    // Skip non-GraphQL requests (e.g. the environment file)
    if (!content.includes("body:graphql")) {
      continue;
    }

    const gql = extractGraphQL(content);
    if (!gql) {
      console.log(`  SKIP  ${relativePath}  (no graphql body found)`);
      continue;
    }

    let doc;
    try {
      doc = parse(gql);
    } catch (err) {
      failed++;
      failures.push({
        file: relativePath,
        errors: [`Parse error: ${err.message}`],
      });
      console.log(`  FAIL  ${relativePath}`);
      console.log(`        Parse error: ${err.message}`);
      continue;
    }

    const errors = validate(schema, doc);
    if (errors.length === 0) {
      passed++;
      console.log(`  PASS  ${relativePath}`);
    } else {
      failed++;
      const msgs = errors.map((e) => e.message);
      failures.push({ file: relativePath, errors: msgs });
      console.log(`  FAIL  ${relativePath}`);
      for (const msg of msgs) {
        console.log(`        ${msg}`);
      }
    }
  }

  // 4. Summary
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failures.length > 0) {
    console.log(`\nFailed files:`);
    for (const { file, errors } of failures) {
      console.log(`\n  ${file}`);
      for (const msg of errors) {
        console.log(`    - ${msg}`);
      }
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
