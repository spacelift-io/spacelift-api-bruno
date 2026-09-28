#!/usr/bin/env node
/**
 * sync-check-report.js — Writes up what the weekly sync check found, from the
 * logs of the checks that actually failed.
 *
 * Each check writes its output to <logDir>/<id>.log, to <id>.mid.log once
 * the mechanical fixes are applied, and to <id>.after.log once every fix is. Only failed
 * checks appear, each with the part of its output that names what drifted —
 * rather than a list of everything that might have gone wrong.
 *
 * Three uses, all from .github/workflows/sync-check.yml:
 *
 *   - buildDrift: the failed checks, which the Claude run is given to fix
 *   - buildReport with `after`: the pull request description
 *   - buildReport without it: the issue, when there was nothing to fix
 *
 * Runnable on its own to preview a report:
 *
 *   node scripts/sync-check-report.js <logDir> validate=failure coverage=success \
 *     [--after validate=success ...] [--summary <file>]
 */

const fs = require("fs");
const path = require("path");

// Longest excerpt quoted per check. The rest is in the run log, and a pull
// request or issue body is capped at 65536 characters.
const MAX_LINES = 60;

const CHECKS = [
  {
    id: "precommit",
    title: "Pre-commit hooks",
    fix: "A repository check failed. It is not schema drift; the run log has the hook output.",
    excerpt: () => [],
  },
  {
    id: "validate",
    title: "Requests no longer validate against the schema",
    fix: "A field, argument, enum value or input field these requests use was renamed or removed. Fix each listed request (`/sync-schema` walks through it), then run `npm run validate`.",
    excerpt: (lines) => from(lines, (l) => l.startsWith("Failed files:")),
  },
  {
    id: "coverage",
    title: "Coverage",
    fix: "For a missing operation, add a `.bru` file for it (labeling it in `scripts/advanced-operations.js` if it is administrative). For an unmarked deprecated or advanced operation, run `npm run sync-docs`.",
    excerpt: (lines) =>
      lines.filter((l) => l.includes("✗")).map((l) => l.trim()),
  },
  {
    id: "syncdocs",
    title: "Request docs are out of date with the schema",
    fix: "Spacelift reworded these descriptions. Run `npm run sync-docs` and commit the result.",
    excerpt: (lines) => from(lines, (l) => l.startsWith("✖")),
  },
];

/** Lines from the first one matching `test` to the end, or [] if none does. */
function from(lines, test) {
  const i = lines.findIndex(test);
  return i === -1 ? [] : lines.slice(i);
}

function readLog(logDir, name) {
  const file = path.join(logDir, `${name}.log`);
  if (!fs.existsSync(file)) return [];
  // Strip ANSI colors and GitHub's trailing whitespace.
  return fs
    .readFileSync(file, "utf8")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split("\n")
    .map((l) => l.trimEnd());
}

function section(check, lines, { fix }) {
  let excerpt = check.excerpt(lines);
  // A check that failed before printing its usual summary (the schema fetch,
  // say) still says why at the end of its output.
  if (!excerpt.length && lines.length) excerpt = lines.slice(-20);
  // Collapse runs of blank lines and drop trailing ones.
  excerpt = excerpt.filter((l, i, all) => l || (i > 0 && all[i - 1]));
  while (excerpt.length && !excerpt[excerpt.length - 1]) excerpt.pop();

  const out = [`### ${check.title}`];
  if (fix) out.push("", check.fix);
  if (excerpt.length) {
    const shown = excerpt.slice(0, MAX_LINES);
    if (excerpt.length > shown.length) {
      shown.push(
        `… ${excerpt.length - shown.length} more lines in the run log`,
      );
    }
    out.push("", "```", ...shown, "```");
  }
  return out.join("\n");
}

function sections(outcomes, logDir, suffix, opts) {
  return CHECKS.filter((c) => outcomes[c.id] === "failure").map((c) =>
    section(c, readLog(logDir, c.id + suffix), opts),
  );
}

/** The failed checks, for the Claude run to work from. */
function buildDrift({ outcomes, logDir, suffix = "" }) {
  return sections(outcomes, logDir, suffix, { fix: false }).join("\n\n") + "\n";
}

/**
 * @param {object} opts
 * @param {Record<string, string>} opts.before  step id → outcome, as first run
 * @param {Record<string, string>} [opts.after] step id → outcome, after fixes;
 *   omitted when the job had nothing to fix, which makes this an issue body
 * @param {string} opts.logDir
 * @param {string} opts.runUrl
 * @param {string} [opts.summary]  the Claude run's account of what it did
 */
function buildReport({ before, after, logDir, runUrl, summary }) {
  const parts = [];

  if (!after) {
    parts.push(`The weekly sync check failed. **Run:** ${runUrl}`);
    const failed = sections(before, logDir, "", { fix: true });
    parts.push(
      ...(failed.length
        ? failed
        : [
            "None of the checks failed, so the job broke before or around them. The run log has the cause.",
          ]),
    );
    return parts.join("\n\n") + "\n";
  }

  parts.push(
    `The weekly sync check found drift against the Spacelift schema and fixed what it could. **Run:** ${runUrl}`,
    "## What drifted",
    ...sections(before, logDir, "", { fix: false }),
  );

  if (summary && summary.trim()) {
    parts.push("## What Claude changed", summary.trim());
  }

  const still = sections(after, logDir, ".after", { fix: true });
  parts.push(
    ...(still.length
      ? ["## Still failing", ...still]
      : ["## Checks", "Every check passes on this branch."]),
  );

  parts.push(
    "## After merging",
    "The changelog workflow collects the entries for these requests on `main`. Reword any `Fixed` entry it writes to say what was wrong with the request.",
  );

  return parts.join("\n\n") + "\n";
}

module.exports = { buildDrift, buildReport, CHECKS };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const [logDir] = argv;
  if (!logDir) {
    console.error(
      "Usage: node scripts/sync-check-report.js <logDir> <id>=<outcome> ... [--after <id>=<outcome> ...] [--summary <file>]",
    );
    process.exit(1);
  }
  const summaryAt = argv.indexOf("--summary");
  const summary =
    summaryAt === -1 ? "" : fs.readFileSync(argv[summaryAt + 1], "utf8");
  const rest = argv
    .slice(1)
    .filter(
      (_, i) => summaryAt === -1 || (i !== summaryAt - 1 && i !== summaryAt),
    );
  const afterAt = rest.indexOf("--after");
  const pairs = (list) => Object.fromEntries(list.map((p) => p.split("=")));
  const before = pairs(afterAt === -1 ? rest : rest.slice(0, afterAt));
  const after = afterAt === -1 ? undefined : pairs(rest.slice(afterAt + 1));

  process.stdout.write(
    buildReport({ before, after, logDir, runUrl: "(local preview)", summary }),
  );
}
