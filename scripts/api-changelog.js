#!/usr/bin/env node
/**
 * api-changelog.js — Prints entries from Spacelift's own product
 * changelog that are newer than a given date.
 *
 * The changelog is free-form prose with no feed and no topic tags, so this
 * script does no matching — it just narrows the page down to what has not
 * been reviewed yet and leaves the judgement to a human (or to /sync-schema).
 *
 * Entries are delimited by `<h2 id="YYYY-MM-DD">` headings.
 *
 * Usage:
 *   node scripts/api-changelog.js                 since .api-changelog-checkpoint
 *   node scripts/api-changelog.js --since 2026-05-11
 *   node scripts/api-changelog.js --url <url>
 *   node scripts/api-changelog.js --list-dates    just the dates, no bodies
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

const DEFAULT_URL = "https://docs.spacelift.io/product/changelog";
const CHECKPOINT_FILE = path.join(__dirname, "../.api-changelog-checkpoint");

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
};

const URL = flag("--url") || DEFAULT_URL;
const LIST_DATES = args.includes("--list-dates");

function readCheckpoint() {
  try {
    const raw = fs.readFileSync(CHECKPOINT_FILE, "utf8");
    const line = raw
      .split("\n")
      .map((l) => l.trim())
      .find((l) => /^\d{4}-\d{2}-\d{2}$/.test(l));
    return line;
  } catch {
    return undefined;
  }
}

const SINCE = flag("--since") || readCheckpoint();

function get(url, depth = 0) {
  if (depth > 5) return Promise.reject(new Error("too many redirects"));
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "user-agent": "spacelift-api-bruno" } }, (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          resolve(get(next, depth + 1));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve(body));
      })
      .on("error", reject);
  });
}

/** Strip tags and decode the handful of entities the page actually uses. */
function toText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<li[^>]*>/g, "\n  - ")
    .replace(/<\/(p|h[1-6]|div|tr)>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#3[49];|&apos;/g, "'")
    .replace(/»/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trim();
}

/** Split the page into { date, html } entries on <h2 id="YYYY-MM-DD">. */
function splitEntries(html) {
  const re = /<h2[^>]*\sid="(\d{4}-\d{2}-\d{2})"[^>]*>/g;
  const marks = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    marks.push({ date: m[1], start: m.index, headEnd: re.lastIndex });
  }
  return marks.map((mark, i) => ({
    date: mark.date,
    html: html.slice(mark.headEnd, marks[i + 1]?.start ?? html.length),
  }));
}

async function main() {
  const html = await get(URL);
  const entries = splitEntries(html);

  if (entries.length === 0) {
    console.error(
      "No dated entries found — the changelog markup may have changed.",
    );
    process.exitCode = 1;
    return;
  }

  const fresh = SINCE ? entries.filter((e) => e.date > SINCE) : entries;

  if (LIST_DATES) {
    for (const e of fresh) console.log(e.date);
    return;
  }

  const scope = SINCE ? `after ${SINCE}` : "all dates";
  console.log(`Changelog: ${URL}`);
  console.log(
    `${fresh.length} of ${entries.length} entries ${scope}` +
      (fresh.length ? `, newest ${fresh[0].date}\n` : "\n"),
  );

  if (fresh.length === 0) {
    console.log("Nothing new since the checkpoint.");
    return;
  }

  for (const e of fresh) {
    console.log(`── ${e.date} ${"─".repeat(48)}`);
    console.log(toText(e.html));
    console.log();
  }

  console.log(
    `Once reviewed, set .api-changelog-checkpoint to ${fresh[0].date}.`,
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
