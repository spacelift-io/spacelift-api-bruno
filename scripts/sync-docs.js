#!/usr/bin/env node
/**
 * sync-docs.js — Sync documentation into the collection's docs blocks.
 *
 * Two sources, because there are two kinds of documentation:
 *
 * 1. Requests take theirs from the live schema. For each .bru file, looks up
 *    the root GraphQL field and inserts/updates a `docs { ... }` block with a
 *    deprecation warning (if the field has a `deprecationReason`), an advanced
 *    note (if it is listed in advanced-operations.js), and the field's
 *    description. Files whose field has none of those are left untouched.
 *
 * 2. Folders take theirs from folder-docs.js, hand-written. A schema describes
 *    one operation at a time and can never say which order to send them in or
 *    which folder supersedes another, which is exactly what a reader needs
 *    before working through a folder of 25 requests.
 *
 * Deprecated operations keep their .bru file — they stay supported, so the
 * collection keeps covering them and marks them instead, to steer users to
 * the replacement named in the schema's deprecationReason.
 *
 * Usage:
 *   node scripts/sync-docs.js
 *   node scripts/sync-docs.js --endpoint https://myaccount.app.spacelift.io/graphql
 *   node scripts/sync-docs.js --dry-run          (show what would change, no writes)
 *   node scripts/sync-docs.js --check            (exit 1 if anything is stale)
 *   node scripts/sync-docs.js --check-folders    (folders only — offline, for PRs)
 */

const { buildClientSchema, getIntrospectionQuery, parse } = require("graphql");
const { ADVANCED, ADVANCED_MARKER } = require("./advanced-operations");
const { FOLDER_DOCS } = require("./folder-docs");
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

// Everything from this line onward in a docs block is hand-written and is
// preserved across syncs; everything above it is regenerated from the schema.
// An HTML comment because Bruno renders these blocks as markdown — the marker
// does its job in the file and stays invisible in the Docs pane.
const NOTES_MARKER = "<!-- notes: hand-written, preserved by sync-docs -->";

const args = process.argv.slice(2);
const endpointFlag = args.indexOf("--endpoint");
const ENDPOINT =
  endpointFlag !== -1 ? args[endpointFlag + 1] : DEFAULT_ENDPOINT;
const DRY_RUN = args.includes("--dry-run");
const CHECK_FOLDERS = args.includes("--check-folders");
// --check-folders is a narrower --check, so it implies the no-write behavior.
const CHECK = args.includes("--check") || CHECK_FOLDERS;

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
 * Get the root field from a GraphQL operation string, qualified by operation
 * type — "Query.stacks", "Mutation.stackCreate".
 *
 * The qualifier matters: a name can exist as both a Query and a Mutation field
 * with different metadata. templateVersionParseTemplate is live as a query and
 * deprecated as a mutation, so keying on the bare name would let one overwrite
 * the other and stamp the wrong notice into the docs block.
 *
 * Handles named operations (query Foo { bar }) and anonymous ({ bar }), which
 * GraphQL defines as queries.
 */
function getRootFieldKey(gql) {
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
  const kind = def.operation === "mutation" ? "Mutation" : "Query";
  return `${kind}.${sel.name.value}`;
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
 * Everything from NOTES_MARKER onward in an existing docs block, or null.
 *
 * A schema description says what an operation does. It never says where to get
 * the ID the request needs, which request to send first, or which of two
 * spellings of an argument the backend actually accepts — and those are the
 * questions someone has with the request open in front of them. Before this,
 * there was nowhere to write the answer: sync-docs replaced the whole block,
 * so anything hand-written survived until the next sync.
 *
 * Text below the marker is preserved verbatim. Text above it is regenerated
 * from the schema on every run, and edits there are lost — which is why the
 * marker names itself.
 *
 * The marker is an HTML comment because Bruno renders these blocks as
 * markdown: it does its job in the file and is invisible in the Docs pane.
 */
function extractNotes(docsBlockBody) {
  const index = docsBlockBody.indexOf(NOTES_MARKER);
  if (index === -1) return null;
  return docsBlockBody.slice(index).trimEnd();
}

/** The body of a `docs { ... }` block, outdented, or null if there is none. */
function docsBlockBody(content) {
  const match = content.match(/^docs \{/m);
  if (!match) return null;
  const block = content.slice(match.index, findBlockEnd(content, match.index));
  return block
    .replace(/^docs \{\n?/, "")
    .replace(/\n?\}$/, "")
    .split("\n")
    .map((line) => (line.startsWith("  ") ? line.slice(2) : line))
    .join("\n");
}

/**
 * Insert or update the `docs { ... }` block in .bru file content.
 * - If a docs block already exists, replace its content, keeping any
 *   hand-written notes below NOTES_MARKER.
 * - Otherwise insert it immediately after the `meta { ... }` block.
 * Returns the updated content, or the original content if nothing changed.
 */
function upsertDocsBlock(content, description) {
  const existingBody = docsBlockBody(content);
  const notes = existingBody === null ? null : extractNotes(existingBody);
  const newBlock = buildDocsBlock(
    notes ? `${description}\n\n${notes}` : description,
  );

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
// Folder docs
// ---------------------------------------------------------------------------

/** Every folder under Spacelift/, as paths relative to it, `/`-separated. */
function findFolders(dir, prefix = []) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // Environments are not part of the request tree and have no folder.bru.
    if (!entry.isDirectory() || entry.name === "environments") continue;
    out.push([...prefix, entry.name].join("/"));
    out.push(
      ...findFolders(path.join(dir, entry.name), [...prefix, entry.name]),
    );
  }
  return out.sort();
}

/** The `name:` / `seq:` pairs of a folder.bru's meta block, if it has one. */
function readFolderMeta(content) {
  const match = content.match(/^meta \{/m);
  if (!match) return {};
  const block = content.slice(match.index, findBlockEnd(content, match.index));
  const name = block.match(/^\s*name:\s*(.+)$/m);
  const seq = block.match(/^\s*seq:\s*(\d+)\s*$/m);
  return {
    name: name ? name[1].trim() : undefined,
    seq: seq ? seq[1] : undefined,
  };
}

/**
 * The folder.bru content for one folder: a meta block, then the docs block.
 *
 * `seq` is preserved exactly as found and never invented. Bruno orders folders
 * alphabetically and splices only those carrying a seq in at `seq - 1`, so
 * adding one here would silently move a folder, and dropping Advanced's would
 * move 196 administrative requests to the top of the sidebar.
 *
 * `name` likewise defaults to the directory name, because Bruno sorts on the
 * meta name when there is one — a name that differs from the directory would
 * reorder the sidebar just as surely.
 */
function buildFolderBru(folderPath, existing) {
  const dirName = folderPath.split("/").pop();
  const { name = dirName, seq } = existing ? readFolderMeta(existing) : {};

  const meta = ["meta {", `  name: ${name}`];
  if (seq !== undefined) meta.push(`  seq: ${seq}`);
  meta.push("}");

  return `${meta.join("\n")}\n\n${buildDocsBlock(FOLDER_DOCS[folderPath])}\n`;
}

/**
 * Write every folder's docs into its folder.bru.
 *
 * Returns a list of problems: folders with no entry in folder-docs.js, and
 * (under --check) folders whose file has fallen behind it.
 */
function syncFolderDocs() {
  const folders = findFolders(COLLECTION_DIR);
  const problems = [];
  let updated = 0;
  let unchanged = 0;

  for (const folderPath of folders) {
    const file = path.join(COLLECTION_DIR, folderPath, "folder.bru");

    if (!(folderPath in FOLDER_DOCS)) {
      problems.push(
        `${folderPath} — no entry in scripts/folder-docs.js. Add one; a folder ` +
          `with no docs is a folder a reader has to reverse-engineer.`,
      );
      continue;
    }

    const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    const wanted = buildFolderBru(folderPath, existing);

    if (existing === wanted) {
      unchanged++;
      continue;
    }

    if (CHECK) {
      problems.push(
        `${folderPath} — folder.bru is out of date. Run \`npm run sync-docs\`.`,
      );
      continue;
    }

    if (!DRY_RUN) fs.writeFileSync(file, wanted, "utf8");
    updated++;
    console.log(
      `  ${DRY_RUN ? "(dry-run) " : ""}${existing ? "updated" : "created"}  ${folderPath}/folder.bru`,
    );
  }

  // A folder.bru with no folder left under it is dead weight the walk above
  // can never reach, so it has to be looked for separately.
  for (const key of Object.keys(FOLDER_DOCS)) {
    if (!folders.includes(key)) {
      problems.push(
        `${key} — documented in scripts/folder-docs.js, but no such folder exists. ` +
          `Remove the entry, or restore the folder.`,
      );
    }
  }

  return { problems, updated, unchanged, total: folders.length };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // --check-folders is the pull-request check: folder docs are hand-written, so
  // whether every folder has one is a fact about this repository alone. Keeping
  // it offline means a PR cannot fail because Spacelift reworded a description
  // or the demo endpoint was briefly unreachable. Schema drift is the weekly
  // job's business, via --check.
  if (CHECK_FOLDERS) {
    const folders = syncFolderDocs();
    console.log(
      `Folders: ${folders.unchanged} up-to-date of ${folders.total}` +
        (folders.updated ? `, ${folders.updated} stale` : ""),
    );
    if (folders.problems.length > 0) {
      console.log(`\n✖ ${folders.problems.length} folder docs problem(s):\n`);
      for (const problem of folders.problems) console.log(`  ${problem}`);
      process.exit(1);
    }
    console.log("Every folder is documented and up to date.");
    return;
  }

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

  for (const [kind, fields] of [
    ["Query", schema.getQueryType()?.getFields() ?? {}],
    ["Mutation", schema.getMutationType()?.getFields() ?? {}],
  ]) {
    for (const [name, field] of Object.entries(fields)) {
      const text = buildDocsText(field, ADVANCED.get(name));
      if (!text) continue;
      // Qualified by operation type — see getRootFieldKey.
      docsText[`${kind}.${name}`] = text;
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
  const staleRequests = [];

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

    const rootField = getRootFieldKey(gql);
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

    // --check reports rather than writes; it is the CI mode, and a check that
    // fixes what it is checking would always pass.
    if (CHECK) {
      staleRequests.push(rel);
      continue;
    }

    if (!DRY_RUN) {
      fs.writeFileSync(filePath, newContent, "utf8");
    }
    updated++;
    console.log(`  ${DRY_RUN ? "(dry-run) " : ""}updated  ${rel}`);
  }

  // 4. Folder docs — hand-written, so they come from folder-docs.js rather
  //    than the schema, but they land in a docs block just the same.
  console.log(`\nFolder docs:`);
  const folders = syncFolderDocs();

  // 5. Summary
  console.log(`\n${"─".repeat(60)}`);
  if (DRY_RUN) console.log("DRY RUN — no files written");
  console.log(
    `Requests: ${updated} updated, ${unchanged} already up-to-date, ${noDesc} nothing to document, ${skipped} skipped`,
  );
  console.log(
    `Folders:  ${folders.updated} updated, ${folders.unchanged} already up-to-date, of ${folders.total}`,
  );

  if (staleRequests.length > 0) {
    console.log(
      `\n✖ ${staleRequests.length} request docs block(s) out of date with the schema.` +
        ` Run \`npm run sync-docs\`:\n`,
    );
    for (const rel of staleRequests) console.log(`  ${rel}`);
  }

  if (folders.problems.length > 0) {
    console.log(`\n✖ ${folders.problems.length} folder docs problem(s):\n`);
    for (const problem of folders.problems) console.log(`  ${problem}`);
  }

  if (staleRequests.length > 0 || folders.problems.length > 0) {
    process.exit(1);
  }

  if (updated === 0 && folders.updated === 0 && !DRY_RUN) {
    console.log("\nEverything is up to date.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
