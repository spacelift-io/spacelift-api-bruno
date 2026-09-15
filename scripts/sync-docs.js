#!/usr/bin/env node
/**
 * sync-docs.js — Sync schema field descriptions into Bruno request docs blocks.
 *
 * For each .bru file, looks up the root GraphQL field in the live schema and
 * inserts/updates a `docs { ... }` block containing:
 *   - a deprecation warning, if the field has a `deprecationReason`
 *   - the field's description, if it has one
 * Files whose schema field has neither are left untouched.
 *
 * Deprecated operations keep their .bru file — they stay supported, so the
 * collection keeps covering them and marks them instead, to steer users to
 * the replacement named in the schema's deprecationReason.
 *
 * Usage:
 *   node scripts/sync-docs.js
 *   node scripts/sync-docs.js --endpoint https://myaccount.app.spacelift.io/graphql
 *   node scripts/sync-docs.js --dry-run    (show what would change, no writes)
 */

const { buildClientSchema, getIntrospectionQuery, parse } = require("graphql");
const { ADVANCED, ADVANCED_MARKER } = require("./advanced-operations");
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_ENDPOINT = "https://demo.app.spacelift.io/graphql";
const COLLECTION_DIR = path.join(__dirname, "../Spacelift");

// Marker that identifies a deprecation warning inside a docs block.
// coverage.js --check-deprecated-marks greps for this exact substring, so the
// two must stay in sync.
const DEPRECATED_MARKER = "**DEPRECATED**";

// ADVANCED_MARKER and the operation list come from advanced-operations.js,
// which coverage.js --check-advanced-marks reads too, so membership and wording
// cannot drift between writer and checker the way DEPRECATED_MARKER can.

const args = process.argv.slice(2);
const endpointFlag = args.indexOf("--endpoint");
const ENDPOINT =
  endpointFlag !== -1 ? args[endpointFlag + 1] : DEFAULT_ENDPOINT;
const DRY_RUN = args.includes("--dry-run");

// ---------------------------------------------------------------------------
// Helpers (shared with validate-schema.js / coverage.js)
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
 * Extract the raw GraphQL string from a .bru file's `body:graphql { ... }` block.
 * Uses brace-depth tracking to handle nested braces correctly.
 * (Same logic as validate-schema.js)
 */
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

/**
 * Get the root field name from a GraphQL operation string.
 * Handles named operations (query Foo { bar }) and anonymous ({ bar }).
 */
function getRootFieldName(gql) {
  let doc;
  try {
    doc = parse(gql);
  } catch {
    return null;
  }
  const def = doc.definitions[0];
  if (!def || !def.selectionSet) return null;
  const sel = def.selectionSet.selections[0];
  if (!sel || sel.kind !== "Field") return null;
  return sel.name.value;
}

/**
 * Compose the docs text for a field from its schema metadata.
 * A deprecated field leads with a warning naming its replacement, so the
 * notice is the first thing visible in Bruno's Docs pane.
 * Returns null when the field has nothing worth documenting.
 */
function buildDocsText({ description, deprecationReason }, advanced) {
  const parts = [];
  if (deprecationReason) {
    parts.push(`⚠ ${DEPRECATED_MARKER} — ${deprecationReason.trim()}`);
  }
  if (advanced) {
    parts.push(`ℹ ${ADVANCED_MARKER} — ${advanced.note}`);
  }
  if (description) parts.push(description.trim());
  return parts.length ? parts.join("\n\n") : null;
}

/**
 * Build the `docs { ... }` block string for a description.
 * Each line is indented with 2 spaces.
 */
function buildDocsBlock(description) {
  const indented = description
    .split("\n")
    .map((line) => line.trimEnd())
    .map((line) => (line ? "  " + line : ""))
    .join("\n");
  return `docs {\n${indented}\n}`;
}

/**
 * Find the index just past the closing `}` of a block starting at startIdx.
 * startIdx should point to or before the opening `{`.
 */
function findBlockEnd(content, startIdx) {
  const openBrace = content.indexOf("{", startIdx);
  if (openBrace === -1) return -1;

  let depth = 1;
  let i = openBrace + 1;
  while (i < content.length && depth > 0) {
    if (content[i] === "{") depth++;
    else if (content[i] === "}") depth--;
    i++;
  }
  return i; // just past the closing }
}

/**
 * Insert or update the `docs { ... }` block in .bru file content.
 * - If a docs block already exists, replace its content.
 * - Otherwise insert it immediately after the `meta { ... }` block.
 * Returns the updated content, or the original content if nothing changed.
 */
function upsertDocsBlock(content, description) {
  const newBlock = buildDocsBlock(description);

  // Replace existing docs block (matched at start of a line)
  const docsMatch = content.match(/^docs \{/m);
  if (docsMatch) {
    const docsStart = docsMatch.index;
    const docsEnd = findBlockEnd(content, docsStart);
    const existing = content.slice(docsStart, docsEnd);
    if (existing === newBlock) return content; // already up to date
    return content.slice(0, docsStart) + newBlock + content.slice(docsEnd);
  }

  // Insert after meta block
  const metaMatch = content.match(/^meta \{/m);
  if (!metaMatch) return content; // no meta block — unexpected, skip

  const metaEnd = findBlockEnd(content, metaMatch.index);
  // Move past the newline that follows the closing }
  let insertAt = metaEnd;
  if (content[insertAt] === "\n") insertAt++;

  return (
    content.slice(0, insertAt) +
    "\n" +
    newBlock +
    "\n" +
    content.slice(insertAt)
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

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

  // 2. Build docs-text map for all root Query + Mutation fields
  const schema = buildClientSchema(introspectionResult);
  const docsText = {};
  let deprecatedCount = 0;
  let advancedCount = 0;

  for (const fields of [
    schema.getQueryType()?.getFields() ?? {},
    schema.getMutationType()?.getFields() ?? {},
  ]) {
    for (const [name, field] of Object.entries(fields)) {
      const text = buildDocsText(field, ADVANCED.get(name));
      if (!text) continue;
      docsText[name] = text;
      if (field.deprecationReason) deprecatedCount++;
      if (ADVANCED.has(name)) advancedCount++;
    }
  }

  console.log(
    `  ${Object.keys(docsText).length} operations have docs (${deprecatedCount} deprecated, ${advancedCount} advanced)`,
  );

  // 3. Process all .bru files
  const files = findBruFiles(COLLECTION_DIR);
  console.log(`  ${files.length} .bru files found\n`);

  let updated = 0;
  let unchanged = 0;
  let noDesc = 0;
  let skipped = 0;

  for (const filePath of files.sort()) {
    const rel = path.relative(process.cwd(), filePath);
    const content = fs.readFileSync(filePath, "utf8");

    if (!content.includes("body:graphql")) {
      skipped++;
      continue;
    }

    const gql = extractGraphQL(content);
    if (!gql) {
      skipped++;
      continue;
    }

    const rootField = getRootFieldName(gql);
    if (!rootField) {
      skipped++;
      continue;
    }

    const desc = docsText[rootField];
    if (!desc) {
      noDesc++;
      continue;
    }

    const newContent = upsertDocsBlock(content, desc);
    if (newContent === content) {
      unchanged++;
      continue;
    }

    if (!DRY_RUN) {
      fs.writeFileSync(filePath, newContent, "utf8");
    }
    updated++;
    console.log(`  ${DRY_RUN ? "(dry-run) " : ""}updated  ${rel}`);
  }

  // 4. Summary
  console.log(`\n${"─".repeat(60)}`);
  if (DRY_RUN) console.log("DRY RUN — no files written");
  console.log(
    `${updated} updated, ${unchanged} already up-to-date, ${noDesc} nothing to document, ${skipped} skipped`,
  );

  if (updated === 0 && !DRY_RUN) {
    console.log("All docs blocks are up to date.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
