#!/usr/bin/env node
/**
 * destructive-prompts.js — Make destructive requests ask before they fire.
 *
 * A request that deletes something shipped with `"id": "STACK_ID_HERE"` in its
 * variables, the same as every other request. Nothing distinguished "list the
 * stacks" from "delete the stack" until you read the name, and an ID left over
 * from a previous edit would be sent without comment.
 *
 * These requests instead use Bruno's prompt variables:
 *
 *     "id": "{{?Stack ID}}"
 *
 * Bruno opens a dialog at send time asking for each one, and canceling the
 * dialog cancels the request. Deleting something therefore takes a deliberate
 * act — you cannot destroy anything by opening a request and hitting send.
 *
 * Bruno's collection runner and CLI *skip* any request containing a prompt
 * variable, since neither can prompt. That is a useful second effect, but it
 * reaches only the requests that have an ID to prompt for.
 *
 * Fourteen destructive operations name nothing to delete — `sessionDeleteAll`,
 * `samlDelete`, `accountConfirmDelete` and the like. There is no placeholder to
 * convert, so those live in `Spacelift/Danger Zone` and are guarded in the
 * collection's pre-request script instead: it refuses them unless the
 * CONFIRM_DESTRUCTIVE environment variable holds the request's exact name. This
 * script owns that list too, writing it into collection.bru and failing
 * --check when it has drifted, so a newly added one cannot slip through
 * unguarded.
 *
 * Destructiveness is decided by the verb in the request name (DESTRUCTIVE_VERBS
 * below), matched whole-word. That is coarse but predictable, and being wrong
 * in the cautious direction costs one dialog.
 *
 * Usage:
 *   node scripts/destructive-prompts.js            apply
 *   node scripts/destructive-prompts.js --check    exit 1 if any are unprompted
 *                                                  or the guard list is stale
 *   node scripts/destructive-prompts.js --dry-run  show what would change
 */

const fs = require("fs");
const path = require("path");

const COLLECTION_DIR = path.join(__dirname, "../Spacelift");

const COLLECTION_BRU = path.join(COLLECTION_DIR, "collection.bru");

// The array in collection.bru's pre-request script that this file maintains.
const GUARD_LIST_RE = /(const REQUIRES_CONFIRMATION = \[\n)([\s\S]*?)(\n  \];)/;

/**
 * Verbs that mean "this removes or invalidates something", matched whole-word
 * against the request name.
 *
 * Deliberately excludes the run lifecycle — Discard, Cancel, Stop and Kill all
 * end a run, but a run is re-triggerable and treating them as destructive would
 * put a dialog in front of the most common thing anyone does here.
 */
const DESTRUCTIVE_VERBS = [
  "Delete",
  "Destroy",
  "Revoke",
  "Reset",
  "Yank",
  "Unlink",
  "Clean",
  "Purge",
  "Eject",
];

// Tokens that are acronyms rather than words, so a prompt reads "AWS Integration
// ID" and not "Aws Integration Id".
const ACRONYMS = new Set([
  "AI",
  "API",
  "AWS",
  "CLI",
  "GPG",
  "ID",
  "OIDC",
  "SAML",
  "SCIM",
  "SSO",
  "UI",
  "URL",
  "VCS",
]);

const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const DRY_RUN = args.includes("--dry-run");

const VERB_PATTERN = new RegExp(`\\b(${DESTRUCTIVE_VERBS.join("|")})\\b`, "i");

function isDestructive(requestName) {
  return VERB_PATTERN.test(requestName);
}

/**
 * "AWS_INTEGRATION_ID_HERE" -> "AWS Integration ID"
 *
 * A bare "ID_HERE" would become the prompt "ID", which tells the reader
 * nothing about what to paste. In that case the request name supplies the
 * subject instead: "Intent Project Delete" -> "Intent Project ID".
 */
function promptLabel(placeholder, requestName) {
  const label = placeholder
    .replace(/_HERE$/, "")
    .split("_")
    .filter(Boolean)
    .map((token) =>
      ACRONYMS.has(token)
        ? token
        : token.charAt(0) + token.slice(1).toLowerCase(),
    )
    .join(" ");

  if (label !== "ID") return label;

  const subject = requestName
    .replace(VERB_PATTERN, "")
    .replace(/\s+/g, " ")
    .trim();
  return subject ? `${subject} ID` : "ID";
}

function findBruFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "environments") continue;
      results.push(...findBruFiles(full));
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".bru") &&
      entry.name !== "folder.bru" &&
      entry.name !== "collection.bru"
    ) {
      results.push(full);
    }
  }
  return results;
}

/** Span of the `body:graphql:vars { ... }` block, or null. */
function varsBlockSpan(content) {
  const match = content.match(/^body:graphql:vars \{/m);
  if (!match) return null;

  let i = content.indexOf("{", match.index);
  let depth = 1;
  let j = i + 1;
  while (j < content.length && depth > 0) {
    if (content[j] === "{") depth++;
    else if (content[j] === "}") depth--;
    j++;
  }
  return [match.index, j];
}

const DANGER_ZONE_DIR = path.join(COLLECTION_DIR, "Danger Zone");

/** Request names in Danger Zone, which is what the guard list must hold. */
function dangerZoneNames() {
  return fs
    .readdirSync(DANGER_ZONE_DIR)
    .filter((f) => f.endsWith(".bru") && f !== "folder.bru")
    .map((f) => f.slice(0, -".bru".length))
    .sort();
}

/**
 * The names the pre-request script currently guards, in the order it lists them.
 */
function guardedNames(content) {
  const match = content.match(GUARD_LIST_RE);
  if (!match) return null;
  return [...match[2].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * Keep collection.bru's REQUIRES_CONFIRMATION in step with Danger Zone.
 * Returns a problem string, or null when fine.
 *
 * The folder is the membership list: a request is guarded because it is in
 * Danger Zone, and it is in Danger Zone because sending it by accident is hard
 * or impossible to undo. That is a judgment, so it is made once, by moving the
 * file, rather than twice in two places that can disagree.
 */
function syncGuardList(expected) {
  const content = fs.readFileSync(COLLECTION_BRU, "utf8");
  const current = guardedNames(content);

  if (current === null) {
    return "collection.bru has no REQUIRES_CONFIRMATION list. The pre-request script's guard is gone; restore it before adding requests that cannot prompt.";
  }

  const same =
    current.length === expected.length &&
    current.every((name, i) => name === expected[i]);
  if (same) return null;

  if (CHECK) {
    const missing = expected.filter((n) => !current.includes(n));
    const extra = current.filter((n) => !expected.includes(n));
    const detail = [
      missing.length ? `unguarded: ${missing.join(", ")}` : null,
      extra.length ? `no longer exists: ${extra.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join("; ");
    return `collection.bru's guard list is out of date${detail ? ` (${detail})` : ""}. Run \`npm run destructive-prompts\`.`;
  }

  if (!DRY_RUN) {
    const listing = expected.map((name) => `    "${name}",`).join("\n");
    fs.writeFileSync(
      COLLECTION_BRU,
      content.replace(
        GUARD_LIST_RE,
        (_, open, __, close) => open + listing + close,
      ),
      "utf8",
    );
  }
  console.log(
    `  ${DRY_RUN ? "(dry-run) " : ""}guarded   collection.bru — ${expected.length} request(s)`,
  );
  return null;
}

function main() {
  const files = findBruFiles(COLLECTION_DIR).sort();

  let converted = 0;
  let alreadyPrompted = 0;
  let noPlaceholders = 0;
  const stale = [];
  const cannotPrompt = [];
  const allNames = new Map();

  for (const filePath of files) {
    const rel = path.relative(COLLECTION_DIR, filePath);
    const name = path.basename(filePath, ".bru");
    if (name !== "folder") {
      allNames.set(name, [...(allNames.get(name) ?? []), rel]);
    }
    if (!isDestructive(name)) continue;

    const content = fs.readFileSync(filePath, "utf8");
    const span = varsBlockSpan(content);

    // Nothing to prompt for: the operation takes no arguments. Such a request
    // is still destructive and a collection run would send it, so prompt-skip
    // is a safety net rather than a guarantee — see the note above.
    if (!span) {
      noPlaceholders++;
      cannotPrompt.push(name);
      continue;
    }

    const block = content.slice(span[0], span[1]);
    const placeholders = [...new Set(block.match(/"[A-Z0-9_]*_HERE"/g) ?? [])];

    if (placeholders.length === 0) {
      if (block.includes("{{?")) {
        alreadyPrompted++;
      } else {
        noPlaceholders++;
        cannotPrompt.push(name);
      }
      continue;
    }

    let updated = block;
    for (const quoted of placeholders) {
      const label = promptLabel(quoted.slice(1, -1), name);
      updated = updated.split(quoted).join(`"{{?${label}}}"`);
    }

    if (updated === block) continue;

    if (CHECK) {
      stale.push(`${rel} — still sends ${placeholders.join(", ")}`);
      continue;
    }

    if (!DRY_RUN) {
      fs.writeFileSync(
        filePath,
        content.slice(0, span[0]) + updated + content.slice(span[1]),
        "utf8",
      );
    }
    converted++;
    console.log(`  ${DRY_RUN ? "(dry-run) " : ""}prompted  ${rel}`);
  }

  const dangerZone = dangerZoneNames();
  const problems = [];

  // The guard matches on req.getName(), so a name shared with a request
  // outside the folder would guard that one too.
  const collisions = dangerZone.filter(
    (name) => (allNames.get(name) ?? []).length > 1,
  );
  for (const name of collisions) {
    problems.push(
      `"${name}" is in Danger Zone but the name is also used by ${allNames
        .get(name)
        .filter((f) => !f.startsWith("Danger Zone"))
        .join(
          ", ",
        )}. The guard matches on the name alone, so rename one of them.`,
    );
  }

  // Nothing to prompt for and not in the folder means nothing stops it.
  const unguarded = cannotPrompt.filter((name) => !dangerZone.includes(name));
  for (const name of unguarded) {
    problems.push(
      `"${name}" destroys something and has no ID to prompt for, but is not in Danger Zone. Move it there.`,
    );
  }

  const guardProblem = syncGuardList(dangerZone);

  console.log(
    `\n${converted} converted, ${alreadyPrompted} already prompting, ` +
      `${dangerZone.length} in Danger Zone guarded by CONFIRM_DESTRUCTIVE`,
  );

  if (guardProblem) problems.push(guardProblem);
  stale.push(...problems);

  if (stale.length > 0) {
    console.log(`\n✖ ${stale.length} problem(s):\n`);
    for (const line of stale) console.log(`  ${line}`);
    process.exit(1);
  }
}

main();
