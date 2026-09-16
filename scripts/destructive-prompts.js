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
 * variable, since neither can prompt. That is a useful second effect, but not a
 * guarantee: fourteen destructive operations take no arguments at all, so they
 * have nothing to prompt for and a bulk run would send them. Treat this as
 * making the common mistake hard, not as making the collection safe to run
 * wholesale against an account you care about.
 *
 * Destructiveness is decided by the verb in the request name (DESTRUCTIVE_VERBS
 * below), matched whole-word. That is coarse but predictable, and being wrong
 * in the cautious direction costs one dialog.
 *
 * Usage:
 *   node scripts/destructive-prompts.js            apply
 *   node scripts/destructive-prompts.js --check    exit 1 if any are unprompted
 *   node scripts/destructive-prompts.js --dry-run  show what would change
 */

const fs = require("fs");
const path = require("path");

const COLLECTION_DIR = path.join(__dirname, "../Spacelift");

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

function main() {
  const files = findBruFiles(COLLECTION_DIR).sort();

  let converted = 0;
  let alreadyPrompted = 0;
  let noPlaceholders = 0;
  const stale = [];

  for (const filePath of files) {
    const rel = path.relative(COLLECTION_DIR, filePath);
    const name = path.basename(filePath, ".bru");
    if (!isDestructive(name)) continue;

    const content = fs.readFileSync(filePath, "utf8");
    const span = varsBlockSpan(content);

    // Nothing to prompt for: the operation takes no arguments. Such a request
    // is still destructive and a collection run would send it, so prompt-skip
    // is a safety net rather than a guarantee — see the note above.
    if (!span) {
      noPlaceholders++;
      continue;
    }

    const block = content.slice(span[0], span[1]);
    const placeholders = [...new Set(block.match(/"[A-Z0-9_]*_HERE"/g) ?? [])];

    if (placeholders.length === 0) {
      if (block.includes("{{?")) alreadyPrompted++;
      else noPlaceholders++;
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

  console.log(
    `\n${converted} converted, ${alreadyPrompted} already prompting, ` +
      `${noPlaceholders} with nothing to prompt for`,
  );

  if (stale.length > 0) {
    console.log(
      `\n✖ ${stale.length} destructive request(s) still carry a plain placeholder.` +
        ` Run \`npm run destructive-prompts\`:\n`,
    );
    for (const line of stale) console.log(`  ${line}`);
    process.exit(1);
  }
}

main();
