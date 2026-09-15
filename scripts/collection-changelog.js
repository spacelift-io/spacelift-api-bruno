#!/usr/bin/env node
/**
 * collection-changelog.js — Maintain this collection's own changelog.
 *
 * Two artifacts, one source of truth:
 *
 *   CHANGELOG.md              the full history, one line per request
 *   Spacelift/collection.bru  the collection's docs block in Bruno — how to
 *                             authenticate, then the newest entries, shown
 *                             where the users already are
 *
 * Entries are derived from git, because the granularity people actually want —
 * "was Trigger Flow added?" — is only sustainable if nobody has to hand-write
 * two hundred lines after a coverage sprint:
 *
 *   a .bru file appears          → Added
 *   a .bru file disappears       → Removed
 *   a .bru file changes in a     → Fixed, reason taken from the commit subject
 *     commit whose subject is a
 *     `fix:`
 *   a docs block gains the       → Deprecated, reason taken from the schema's
 *     DEPRECATED marker            own deprecationReason
 *
 * Everything else — sync-docs runs, chores, refactors — is invisible to the
 * user and is skipped.
 *
 * `--collect` adds entries and re-sorts every section, but never rewrites the
 * text of an entry, so wording polished by hand survives — only line positions
 * move. It is therefore idempotent: running it with nothing new to collect
 * just puts any stray line back in order.
 * `.collection-changelog-commit` records how far it has read.
 *
 * The API's own changelog is a different thing entirely — see
 * api-changelog.js.
 *
 * Usage:
 *   node scripts/collection-changelog.js --collect    write entries for new commits
 *   node scripts/collection-changelog.js --sync       mirror the newest into Bruno
 *   node scripts/collection-changelog.js --check      CI: both are up to date
 *   node scripts/collection-changelog.js --sync --entries 8
 *   node scripts/collection-changelog.js --collect --dry-run
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { parse } = require("graphql");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ROOT = path.join(__dirname, "..");
const COLLECTION_DIR = path.join(ROOT, "Spacelift");
const CHANGELOG_FILE = path.join(ROOT, "CHANGELOG.md");
const COLLECTION_BRU = path.join(COLLECTION_DIR, "collection.bru");
const CHECKPOINT_FILE = path.join(ROOT, ".collection-changelog-commit");

// Links out of the docs pane. Bruno hands http(s) links to the browser and
// silently ignores every other scheme, so these have to be absolute.
const REPO_URL = "https://github.com/spacelift-io/spacelift-api-bruno";
const CHANGELOG_URL = `${REPO_URL}/blob/main/CHANGELOG.md`;
const SETUP_URL = `${REPO_URL}#setup`;

// How many entries the Bruno docs pane shows before truncating. Sized to fit
// the Docs pane without scrolling at a typical window size; the rest of the
// history is one click away in CHANGELOG.md.
const DEFAULT_ENTRIES = 12;

// Written by sync-docs.js. Its arrival in a docs block is how a newly
// deprecated operation announces itself to this script.
const DEPRECATED_MARKER = "**DEPRECATED**";

// The four things that can happen to a request, and how each reads in Bruno.
// The glyphs are deliberately not emoji — they render at text weight in
// Bruno's docs pane instead of dragging the eye down the list.
const KINDS = {
  Added: "✚",
  Fixed: "✎",
  Deprecated: "⚠",
  Removed: "✖",
};

const ENTRY_RE = new RegExp(
  `^- (${Object.keys(KINDS).join("|")}) \\*\\*(.+?)\\*\\*` + // kind, request path
    "(?: \\(`([^`]+)`\\))?" + // root field, optional
    "(?: — (.+))?$", // reason, optional
);

const args = process.argv.slice(2);
const entriesFlag = args.indexOf("--entries");
const requestedEntries =
  entriesFlag !== -1 ? Number(args[entriesFlag + 1]) : DEFAULT_ENTRIES;
// A typo'd --entries would otherwise silently publish an empty What's New.
const ENTRY_LIMIT =
  Number.isInteger(requestedEntries) && requestedEntries > 0
    ? requestedEntries
    : DEFAULT_ENTRIES;
const DRY_RUN = args.includes("--dry-run");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function git(...gitArgs) {
  return execFileSync("git", gitArgs, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    // Capture stderr rather than letting git print over our own diagnostics;
    // every caller either handles the failure or lets it bubble up.
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Turn a repository path into the name a user sees in Bruno's sidebar:
 * Spacelift/Stacks/Scheduled Tasks/Create.bru → Stacks → Scheduled Tasks → Create
 *
 * Returns null for anything that isn't a request — folder metadata, the
 * collection file itself, environments.
 */
function requestName(file) {
  if (!file.startsWith("Spacelift/") || !file.endsWith(".bru")) return null;
  const parts = file.slice("Spacelift/".length, -".bru".length).split("/");
  const base = parts[parts.length - 1];
  if (base === "folder" || base === "collection") return null;
  if (parts[0] === "environments") return null;
  return parts.join(" → ");
}

/** Read a file as it was at a given commit. Returns null if it wasn't there. */
function fileAt(sha, file) {
  try {
    return git("show", `${sha}:${file}`);
  } catch {
    return null;
  }
}

/**
 * Extract the raw GraphQL from a .bru file's `body:graphql { ... }` block.
 * Brace-depth tracking, same as validate-schema.js and sync-docs.js.
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
 * The bare root field name of a request — `runTrigger`, `stacks`.
 * Unqualified on purpose: the changelog names it so a reader can match an
 * entry against the API docs, not to key a map, so Query/Mutation collisions
 * (see getRootFieldKey in sync-docs.js) don't matter here.
 */
function rootFieldName(content) {
  const gql = content && extractGraphQL(content);
  if (!gql) return null;
  try {
    const def = parse(gql).definitions[0];
    const sel = def?.selectionSet?.selections?.[0];
    return sel?.kind === "Field" ? sel.name.value : null;
  } catch {
    return null;
  }
}

/** The deprecation reason a docs block carries, if any. */
function deprecationReason(content) {
  const line = (content || "")
    .split("\n")
    .find((l) => l.includes(DEPRECATED_MARKER));
  if (!line) return null;
  const reason = line.split("—").slice(1).join("—").trim();
  return reason || null;
}

/**
 * The file with its docs block removed. Two versions that match once the docs
 * are gone differ only in generated documentation — nothing about the request
 * being sent changed, so the user has no reason to hear about it.
 */
function withoutDocs(content) {
  const match = (content || "").match(/^docs \{/m);
  if (!match) return content || "";
  const end = findBlockEnd(content, match.index);
  return content.slice(0, match.index) + content.slice(end);
}

/** Strip the conventional-commit prefix: "fix: correct X" → "correct X". */
function commitReason(subject) {
  return subject.replace(/^\w+(\([^)]*\))?!?:\s*/, "").trim();
}

// ---------------------------------------------------------------------------
// Sidebar order
//
// Entries are listed in the order Bruno draws them, so scanning the changelog
// and scanning the sidebar are the same motion. That order is not alphabetical
// and not file order — it is Bruno's own, reimplemented here from
// sortItemsBySidebarOrder and sortByNameThenSequence in the Bruno source:
//
//   at every level, folders come first, then requests
//   folders sort alphabetically, then each folder carrying a valid seq is
//     spliced in at position seq - 1
//   requests sort by seq
//
// If Bruno ever changes that, this drifts silently — it is cosmetic ordering,
// not correctness, so it is not worth a check that talks to the app.
// ---------------------------------------------------------------------------

/** Read one `key: value` out of a .bru file's meta block. */
function metaValue(content, key) {
  const meta = (content || "").match(/^meta \{/m);
  if (!meta) return null;
  const block = content.slice(meta.index, findBlockEnd(content, meta.index));
  const match = block.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, "m"));
  return match ? match[1].trim() : null;
}

function metaSeq(content) {
  const raw = metaValue(content, "seq");
  const seq = raw === null ? NaN : Number(raw);
  return Number.isInteger(seq) && seq > 0 ? seq : undefined;
}

/**
 * Bruno's folder ordering, ported as-is: alphabetical, then every item with a
 * valid seq removed and spliced back in at index seq - 1, ascending.
 *
 * Bruno additionally groups folders that share a seq; two folders with the
 * same seq end up adjacent here as well, just in the other order. No folder in
 * this collection shares a seq, so the quirk is left unemulated.
 */
function sortByNameThenSequence(items) {
  const alphabetical = [...items].sort((a, b) => a.name.localeCompare(b.name));
  const sorted = alphabetical.filter((item) => item.seq === undefined);
  const withSeq = alphabetical
    .filter((item) => item.seq !== undefined)
    .sort((a, b) => a.seq - b.seq);

  for (const item of withSeq) {
    sorted.splice(item.seq - 1, 0, item);
  }

  return sorted;
}

/**
 * Map of request name → its position in the sidebar, top to bottom.
 * Built from the working tree, which is what the reader is looking at. A
 * request that has since been removed is not in here at all.
 */
function buildSidebarOrder() {
  const order = new Map();
  let rank = 0;

  const walk = (dir, prefix) => {
    const dirents = fs.readdirSync(dir, { withFileTypes: true });

    const folders = dirents
      .filter((e) => e.isDirectory() && e.name !== "environments")
      .map((e) => {
        const folderBru = path.join(dir, e.name, "folder.bru");
        const content = fs.existsSync(folderBru)
          ? fs.readFileSync(folderBru, "utf8")
          : null;
        return {
          dir: e.name,
          name: (content && metaValue(content, "name")) || e.name,
          seq: content ? metaSeq(content) : undefined,
        };
      });

    const requests = dirents
      .filter(
        (e) =>
          e.isFile() &&
          e.name.endsWith(".bru") &&
          e.name !== "folder.bru" &&
          e.name !== "collection.bru",
      )
      .map((e) => ({
        label: e.name.slice(0, -".bru".length),
        seq: metaSeq(fs.readFileSync(path.join(dir, e.name), "utf8")),
      }))
      .sort(
        (a, b) => (a.seq ?? 0) - (b.seq ?? 0) || a.label.localeCompare(b.label),
      );

    for (const folder of sortByNameThenSequence(folders)) {
      walk(path.join(dir, folder.dir), [...prefix, folder.dir]);
    }
    for (const request of requests) {
      order.set([...prefix, request.label].join(" → "), rank++);
    }
  };

  walk(COLLECTION_DIR, []);
  return order;
}

// ---------------------------------------------------------------------------
// Reading and writing CHANGELOG.md
// ---------------------------------------------------------------------------

/**
 * Split CHANGELOG.md into its preamble and its dated sections, newest first.
 * Section bodies are kept as raw lines so hand-edited wording round-trips
 * untouched.
 */
function readChangelog() {
  if (!fs.existsSync(CHANGELOG_FILE)) return { preamble: "", sections: [] };
  const lines = fs.readFileSync(CHANGELOG_FILE, "utf8").split("\n");

  const preamble = [];
  const sections = [];
  let current = null;

  for (const line of lines) {
    const heading = line.match(/^## (\d{4}-\d{2}-\d{2})\s*$/);
    if (heading) {
      current = { date: heading[1], lines: [] };
      sections.push(current);
      continue;
    }
    if (current) current.lines.push(line);
    else preamble.push(line);
  }

  return { preamble: preamble.join("\n").trimEnd(), sections };
}

function renderChangelog({ preamble, sections }) {
  const body = sections
    .map(({ date, lines }) => {
      const entries = lines.join("\n").trim();
      return `## ${date}\n\n${entries}\n`;
    })
    .join("\n");
  return `${preamble}\n\n${body}`;
}

/** Every entry in the file, newest first, parsed. */
function parseEntries() {
  const { sections } = readChangelog();
  const entries = [];
  for (const section of sections) {
    for (const line of section.lines) {
      const m = line.match(ENTRY_RE);
      if (m) {
        entries.push({
          date: section.date,
          kind: m[1],
          name: m[2],
          field: m[3] || null,
          reason: m[4] || null,
        });
      }
    }
  }
  return entries;
}

function formatEntry({ kind, name, field, reason }) {
  let line = `- ${kind} **${name}**`;
  if (field) line += ` (\`${field}\`)`;
  if (reason) line += ` — ${reason}`;
  return line;
}

// ---------------------------------------------------------------------------
// --collect
// ---------------------------------------------------------------------------

function readCheckpoint() {
  if (!fs.existsSync(CHECKPOINT_FILE)) {
    console.error(
      `No ${path.basename(CHECKPOINT_FILE)} found.\n` +
        "  It records the last commit whose request changes are in CHANGELOG.md.\n" +
        "  Seed it with the commit to start from:\n" +
        `    git rev-parse HEAD > ${path.basename(CHECKPOINT_FILE)}\n` +
        "  Or leave it empty to rebuild the changelog from the first commit.",
    );
    process.exit(1);
  }
  const sha = fs.readFileSync(CHECKPOINT_FILE, "utf8").trim();

  // An empty checkpoint means "from the beginning". A range needs a commit on
  // its left, and the first commit has no parent to name, so bootstrapping a
  // changelog over existing history has no SHA to write here.
  if (!sha) return null;

  // A squash or rebase merge can leave the recorded commit unreachable. Say so
  // plainly — the alternative is a git error the reader has to decode.
  try {
    git("cat-file", "-e", `${sha}^{commit}`);
  } catch {
    console.error(
      `${path.basename(CHECKPOINT_FILE)} points at ${sha.slice(0, 7)}, which is not in this history.\n` +
        "  A squash or rebase merge can do that. Re-point it at the last commit\n" +
        "  whose request changes are already in CHANGELOG.md:\n" +
        `    git rev-parse HEAD > ${path.basename(CHECKPOINT_FILE)}`,
    );
    process.exit(1);
  }

  return sha;
}

/** The request-level changes a single commit made. */
function entriesForCommit({ sha, subject, date }) {
  // --no-renames: a moved request reads as a removal and an addition, which is
  // what it is from the sidebar's point of view.
  const status = git(
    "show",
    "--no-renames",
    "--name-status",
    "--pretty=format:",
    sha,
    "--",
    "Spacelift",
  );

  const entries = [];

  for (const line of status.split("\n")) {
    const [code, file] = line.split("\t");
    if (!code || !file) continue;

    const name = requestName(file);
    if (!name) continue;

    if (code === "A") {
      entries.push({
        date,
        kind: "Added",
        name,
        field: rootFieldName(fileAt(sha, file)),
      });
      continue;
    }

    if (code === "D") {
      entries.push({
        date,
        kind: "Removed",
        name,
        field: rootFieldName(fileAt(`${sha}^`, file)),
      });
      continue;
    }

    if (code !== "M") continue;

    const before = fileAt(`${sha}^`, file);
    const after = fileAt(sha, file);

    // A docs block that has just gained the marker is a newly deprecated
    // operation — worth an entry whatever the commit was called.
    const reason = deprecationReason(after);
    if (reason && !deprecationReason(before)) {
      entries.push({
        date,
        kind: "Deprecated",
        name,
        field: rootFieldName(after),
        reason,
      });
      continue;
    }

    // Otherwise only a fix is user-visible, and only if it reached the request
    // itself: a `fix:` commit that merely resynced a docs block changes
    // nothing for the person sending it.
    if (withoutDocs(before) === withoutDocs(after)) continue;

    if (/^fix(\([^)]*\))?!?:/.test(subject)) {
      entries.push({
        date,
        kind: "Fixed",
        name,
        field: rootFieldName(after),
        reason: commitReason(subject),
      });
    }
  }

  return entries;
}

/**
 * Order a date's entries: by kind, then down the sidebar.
 *
 * Kind first — grouping every removal together and leading with it means a
 * retirement is never buried under two hundred additions, or pushed out of
 * Bruno's pane. Sidebar order within the group so that scanning a day's
 * additions and scanning the sidebar are the same motion.
 *
 * Removed requests are no longer in the sidebar and so have no position;
 * they fall to the end of their group, alphabetically. Lines that aren't
 * entries — a hand-written note at the top of a section — stay where they are.
 */
function sortSection(lines, order) {
  const priority = ["Removed", "Deprecated", "Fixed", "Added"];

  const other = [];
  const entries = [];

  for (const line of lines) {
    const match = line.match(ENTRY_RE);
    if (match) entries.push({ line, kind: match[1], name: match[2] });
    else if (line.trim()) other.push(line);
  }

  entries.sort(
    (a, b) =>
      priority.indexOf(a.kind) - priority.indexOf(b.kind) ||
      (order.get(a.name) ?? Infinity) - (order.get(b.name) ?? Infinity) ||
      a.name.localeCompare(b.name),
  );

  return [...other, ...entries.map((e) => e.line)];
}

function collect() {
  const from = readCheckpoint();
  const head = git("rev-parse", "HEAD").trim();

  const log = git(
    "log",
    "--reverse",
    "--pretty=format:%H%x00%s%x00%ad",
    "--date=short",
    from ? `${from}..HEAD` : "HEAD",
  ).trim();

  const commits = log
    ? log.split("\n").map((l) => {
        const [sha, subject, date] = l.split("\0");
        return { sha, subject, date };
      })
    : [];

  console.log(
    `Reading ${commits.length} commits ${from ? `since ${from.slice(0, 7)}` : "from the first commit"} ...`,
  );

  // Newest first, matching how the file reads.
  const collected = [];
  for (const commit of commits.reverse()) {
    collected.push(...entriesForCommit(commit));
  }

  if (!collected.length) {
    console.log("  no request changes found");
  }

  const changelog = readChangelog();

  for (const entry of collected) {
    let section = changelog.sections.find((s) => s.date === entry.date);
    if (!section) {
      section = { date: entry.date, lines: [] };
      changelog.sections.push(section);
    }
    section.lines.push(formatEntry(entry));
    console.log(`  ${entry.kind.padEnd(10)} ${entry.name}`);
  }

  // Sort every section, not only the ones just touched: ordering is a property
  // of the file, so a hand-edit that lands a line in the wrong place is fixed
  // by the next collect rather than living there forever. Only line positions
  // move — the text of an entry is never rewritten.
  const order = buildSidebarOrder();
  for (const section of changelog.sections) {
    section.lines = sortSection(section.lines, order);
  }

  changelog.sections.sort((a, b) => b.date.localeCompare(a.date));

  if (DRY_RUN) {
    console.log("\nDRY RUN — no files written");
    return;
  }

  const rendered = renderChangelog(changelog);
  const existing = fs.existsSync(CHANGELOG_FILE)
    ? fs.readFileSync(CHANGELOG_FILE, "utf8")
    : null;

  if (rendered !== existing) fs.writeFileSync(CHANGELOG_FILE, rendered, "utf8");
  fs.writeFileSync(CHECKPOINT_FILE, `${head}\n`, "utf8");

  if (!collected.length && rendered === existing) {
    console.log("\nCHANGELOG.md is up to date.");
    return;
  }

  console.log(
    collected.length
      ? `\n${collected.length} entries added to CHANGELOG.md; checkpoint now ${head.slice(0, 7)}.`
      : "\nNo new entries; reordered CHANGELOG.md.",
  );
  console.log("Reword anything that reads awkwardly, then run --sync.");
}

// ---------------------------------------------------------------------------
// --sync
// ---------------------------------------------------------------------------

/**
 * The docs text shown on the collection in Bruno: what this is, how to
 * authenticate, and what has changed lately.
 *
 * The authentication steps come first and carry their own heading. Every
 * request but one fails until they have been done, which is too important to
 * leave as a sentence in an intro paragraph that the eye slides past.
 */
function buildCollectionDocs() {
  const entries = parseEntries();
  const shown = entries.slice(0, ENTRY_LIMIT);
  const hidden = entries.length - shown.length;

  const out = [
    "# Spacelift API",
    "",
    "Every operation in the Spacelift GraphQL API, one request per operation.",
    "",
    "## Start here",
    "",
    "1. Fill in `SPACELIFT_ENDPOINT`, `SPACELIFT_API_KEY_ID` and `SPACELIFT_API_KEY_SECRET` in the **My Account** environment (top-right dropdown).",
    "2. Send **Auth → Get Token**. It stores the `jwt` that every other request authenticates with.",
    "",
    "Tokens last a few hours — send it again when requests start coming back unauthorized.",
    "",
    `See the [README](${SETUP_URL}) for detailed setup instructions.`,
    "",
    "## What's New",
    "",
    `${KINDS.Added} added · ${KINDS.Fixed} corrected · ${KINDS.Deprecated} deprecated · ${KINDS.Removed} removed`,
  ];

  let lastDate = null;
  for (const entry of shown) {
    if (entry.date !== lastDate) {
      out.push("", `**${entry.date}**`, "");
      lastDate = entry.date;
    }
    let line = `- ${KINDS[entry.kind]} ${entry.name}`;
    if (entry.reason) line += ` — ${entry.reason}`;
    out.push(line);
  }

  out.push("");
  out.push(
    hidden > 0
      ? `_… and ${hidden} earlier ${hidden === 1 ? "change" : "changes"} — see the [full changelog](${CHANGELOG_URL})._`
      : `_See the [full changelog](${CHANGELOG_URL})._`,
  );

  return out.join("\n");
}

function buildDocsBlock(text) {
  const indented = text
    .split("\n")
    .map((line) => line.trimEnd())
    .map((line) => (line ? "  " + line : ""))
    .join("\n");
  return `docs {\n${indented}\n}`;
}

/** Index just past the closing brace of the block starting at startIdx. */
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
  return i;
}

/**
 * Replace the docs block in collection.bru, leaving anything else in the file
 * alone — auth, headers and vars set through Bruno's collection settings live
 * here too.
 */
function upsertCollectionDocs(text) {
  const block = buildDocsBlock(text);

  if (!fs.existsSync(COLLECTION_BRU)) return `${block}\n`;

  const content = fs.readFileSync(COLLECTION_BRU, "utf8");
  const docsMatch = content.match(/^docs \{/m);

  if (!docsMatch) {
    return `${content.trimEnd()}\n\n${block}\n`;
  }

  const start = docsMatch.index;
  const end = findBlockEnd(content, start);
  return content.slice(0, start) + block + content.slice(end);
}

function sync() {
  const entries = parseEntries();
  if (!entries.length) {
    console.error(
      "No entries found in CHANGELOG.md — run --collect first, or check the entry format.",
    );
    process.exit(1);
  }

  const updated = upsertCollectionDocs(buildCollectionDocs());
  const existing = fs.existsSync(COLLECTION_BRU)
    ? fs.readFileSync(COLLECTION_BRU, "utf8")
    : null;

  const shown = Math.min(ENTRY_LIMIT, entries.length);
  console.log(
    `${entries.length} entries in CHANGELOG.md; showing the newest ${shown} in Bruno.`,
  );

  if (updated === existing) {
    console.log("Spacelift/collection.bru is already up to date.");
    return;
  }

  if (DRY_RUN) {
    console.log("\nDRY RUN — would rewrite Spacelift/collection.bru:\n");
    console.log(buildCollectionDocs());
    return;
  }

  fs.writeFileSync(COLLECTION_BRU, updated, "utf8");
  console.log("Spacelift/collection.bru updated.");
}

// ---------------------------------------------------------------------------
// --check
// ---------------------------------------------------------------------------

function check() {
  const problems = [];

  // 1. Commits that changed requests without a changelog entry.
  const from = readCheckpoint();
  const pending = git(
    "log",
    "--no-renames",
    "--name-status",
    "--pretty=format:%H%x00%s",
    from ? `${from}..HEAD` : "HEAD",
    "--",
    "Spacelift",
  )
    .split("\n")
    .filter((line) => {
      const [code, file] = line.split("\t");
      return code && file && requestName(file);
    });

  if (pending.length) {
    problems.push(
      `${pending.length} request changes are not in CHANGELOG.md. Run: npm run collection-changelog:collect`,
    );
  }

  // 2. Bruno's docs pane lagging the file.
  const existing = fs.existsSync(COLLECTION_BRU)
    ? fs.readFileSync(COLLECTION_BRU, "utf8")
    : null;
  if (
    parseEntries().length &&
    upsertCollectionDocs(buildCollectionDocs()) !== existing
  ) {
    problems.push(
      "Spacelift/collection.bru does not match CHANGELOG.md. Run: npm run collection-changelog:sync",
    );
  }

  if (problems.length) {
    console.error("Changelog check FAILED\n");
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    process.exit(1);
  }

  console.log("Changelog check passed.");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

if (args.includes("--collect")) collect();
else if (args.includes("--sync")) sync();
else if (args.includes("--check")) check();
else {
  console.error(
    "Usage: node scripts/collection-changelog.js --collect | --sync | --check [--entries N] [--dry-run]",
  );
  process.exit(1);
}
