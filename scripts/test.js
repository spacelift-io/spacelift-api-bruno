#!/usr/bin/env node
/**
 * test.js — Offline tests for the collection's structure and its one script.
 *
 * `npm run validate` asks the Spacelift schema whether each request is
 * well-formed GraphQL. Nothing asked Bruno whether it can read the files at
 * all, or whether the collection still authenticates. Those are different
 * questions, and the second one is not hypothetical: a careless search and
 * replace once put backticks inside a template literal in collection.bru,
 * breaking authentication for every user while validate stayed green.
 *
 * So these tests use Bruno's own parser rather than a reimplementation of it,
 * and exercise the pre-request script the way Bruno runs it — in an async
 * wrapper, with require() limited to the Safe Mode allowlist.
 *
 * No credentials and no network. Runs in a second, on every commit.
 *
 * Usage: npm test
 */

const {
  bruToJsonV2,
  collectionBruToJson,
  bruToEnvJsonV2,
} = require("@usebruno/lang");
const fs = require("fs");
const path = require("path");

const COLLECTION_DIR = path.join(__dirname, "../Spacelift");

// ---------------------------------------------------------------------------
// A very small test harness — the repo has no test framework and this needs no
// more than names, assertions and an exit code.
// ---------------------------------------------------------------------------

let passed = 0;
const failures = [];
let currentSuite = "";

function suite(name) {
  currentSuite = name;
  console.log(`\n${name}`);
}

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok    ${name}`);
  } catch (err) {
    failures.push({ suite: currentSuite, name, message: err.message });
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function equal(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      `${message}\n        expected: ${expected}\n        actual:   ${actual}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function findBruFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findBruFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".bru")) out.push(full);
  }
  return out;
}

const allFiles = findBruFiles(COLLECTION_DIR).sort();
const rel = (p) => path.relative(COLLECTION_DIR, p);

const requestFiles = allFiles.filter(
  (f) =>
    path.basename(f) !== "folder.bru" &&
    path.basename(f) !== "collection.bru" &&
    !rel(f).startsWith("environments"),
);
const folderFiles = allFiles.filter((f) => path.basename(f) === "folder.bru");
const envFiles = allFiles.filter((f) => rel(f).startsWith("environments"));

const collectionBruPath = path.join(COLLECTION_DIR, "collection.bru");
const collection = collectionBruToJson(
  fs.readFileSync(collectionBruPath, "utf8"),
);

// ---------------------------------------------------------------------------
// Bruno can read every file in the collection
// ---------------------------------------------------------------------------

suite("Bruno can parse the collection");

test(`all ${requestFiles.length} request files parse`, () => {
  const bad = [];
  for (const file of requestFiles) {
    try {
      const json = bruToJsonV2(fs.readFileSync(file, "utf8"));
      if (!json.meta?.name) bad.push(`${rel(file)}: no meta.name`);
    } catch (err) {
      bad.push(`${rel(file)}: ${err.message}`);
    }
  }
  assert(
    bad.length === 0,
    `${bad.length} unparseable:\n        ${bad.slice(0, 5).join("\n        ")}`,
  );
});

test(`all ${folderFiles.length} folder files parse and carry docs`, () => {
  const bad = [];
  for (const file of folderFiles) {
    try {
      const json = collectionBruToJson(fs.readFileSync(file, "utf8"));
      if (!json.meta?.name) bad.push(`${rel(file)}: no meta.name`);
      else if (!json.docs) bad.push(`${rel(file)}: no docs block`);
    } catch (err) {
      bad.push(`${rel(file)}: ${err.message}`);
    }
  }
  assert(
    bad.length === 0,
    `${bad.length} bad:\n        ${bad.slice(0, 5).join("\n        ")}`,
  );
});

test("collection.bru parses with auth, script and docs", () => {
  assert(collection.auth, "no auth block");
  assert(collection.script?.req, "no pre-request script");
  assert(collection.docs, "no docs block");
});

// ---------------------------------------------------------------------------
// The environment is safe to have in git
// ---------------------------------------------------------------------------

suite("The shipped environment keeps secrets out of the file");

test("my-account.bru is the only tracked environment", () => {
  const names = envFiles.map((f) => path.basename(f));
  assert(
    names.includes("my-account.bru"),
    `expected my-account.bru, found: ${names.join(", ") || "nothing"}`,
  );
});

test("the API key secret and the jwt are both secret variables", () => {
  const file = envFiles.find((f) => path.basename(f) === "my-account.bru");
  const env = bruToEnvJsonV2(fs.readFileSync(file, "utf8"));
  // A plain `jwt` would mean every token refresh writes a live credential into
  // a tracked file. This is the assertion that keeps that from regressing.
  for (const name of ["SPACELIFT_API_KEY_SECRET", "jwt"]) {
    const variable = env.variables.find((v) => v.name === name);
    assert(variable, `${name} is missing from the environment`);
    assert(variable.secret, `${name} is not marked secret`);
  }
});

// ---------------------------------------------------------------------------
// Authentication resolves through the collection
// ---------------------------------------------------------------------------

suite("Every request authenticates");

test("all requests inherit bearer auth, except Get Token", () => {
  const bad = [];
  let inherited = 0;
  let none = 0;

  for (const file of requestFiles) {
    const json = bruToJsonV2(fs.readFileSync(file, "utf8"));
    const mode = json.http?.auth;
    if (mode === "none") {
      none++;
      continue;
    }
    if (mode !== "inherit") {
      bad.push(`${rel(file)}: auth is "${mode}"`);
      continue;
    }
    if (json.auth) bad.push(`${rel(file)}: carries its own auth block`);
    else inherited++;
  }

  assert(bad.length === 0, bad.slice(0, 5).join("\n        "));
  equal(
    none,
    1,
    "exactly one request should be unauthenticated (Auth/Get Token)",
  );
  assert(inherited > 600, `only ${inherited} requests inherit auth`);
});

test("the collection supplies a bearer token", () => {
  // Mirrors the bearer branch of Bruno's prepare-request.js setAuthHeaders.
  equal(collection.auth.mode, "bearer", "collection auth mode");
  equal(collection.auth.bearer?.token, "{{jwt}}", "collection bearer token");
});

// ---------------------------------------------------------------------------
// The pre-request script, run the way Bruno runs it
// ---------------------------------------------------------------------------

/** Build a JWT with the given expiry, base64url-encoded like a real one. */
function jwtExpiringIn(seconds) {
  const encode = (obj) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${encode({ alg: "HS256" })}.${encode({
    exp: Math.floor(Date.now() / 1000) + seconds,
  })}.signature`;
}

const CREDENTIALS = {
  SPACELIFT_ENDPOINT: "https://acme.app.spacelift.io/graphql",
  SPACELIFT_API_KEY_ID: "key-id",
  SPACELIFT_API_KEY_SECRET: "key-secret",
};
const TOKEN_RESPONSE = {
  data: { apiKeyUser: { jwt: jwtExpiringIn(3600) } },
};

/**
 * Run the collection's pre-request script the way Bruno does: inside an async
 * wrapper, with require() limited to the modules Safe Mode allows.
 */
async function runPreRequest({ requestName, env, tokenResponse }) {
  const calls = [];
  const sandboxRequire = (name) => {
    if (name === "axios") {
      return {
        post: async (url, data) => {
          calls.push({ url, data });
          return { data: tokenResponse };
        },
      };
    }
    if (name === "atob") return require("atob");
    throw new Error(`module not available in Safe Mode: ${name}`);
  };

  const bru = {
    getEnvVar: (key) => env[key],
    setEnvVar: (key, value) => {
      env[key] = value;
    },
  };

  const fn = new Function(
    "require",
    "bru",
    "req",
    "console",
    `return (async () => { ${collection.script.req} })();`,
  );
  await fn(sandboxRequire, bru, { getName: () => requestName }, { log() {} });

  return { calls, env };
}

// Collected so the async results can be asserted synchronously below.
const scriptResults = {};

async function exerciseScript() {
  scriptResults.noToken = await runPreRequest({
    requestName: "List Stacks",
    env: { ...CREDENTIALS },
    tokenResponse: TOKEN_RESPONSE,
  });

  scriptResults.freshToken = await runPreRequest({
    requestName: "List Stacks",
    env: { ...CREDENTIALS, jwt: jwtExpiringIn(3600) },
    tokenResponse: TOKEN_RESPONSE,
  });

  scriptResults.expiringToken = await runPreRequest({
    requestName: "List Stacks",
    env: { ...CREDENTIALS, jwt: jwtExpiringIn(30) },
    tokenResponse: TOKEN_RESPONSE,
  });

  scriptResults.expiredToken = await runPreRequest({
    requestName: "List Stacks",
    env: { ...CREDENTIALS, jwt: jwtExpiringIn(-100) },
    tokenResponse: TOKEN_RESPONSE,
  });

  scriptResults.garbageToken = await runPreRequest({
    requestName: "List Stacks",
    env: { ...CREDENTIALS, jwt: "not-a-jwt" },
    tokenResponse: TOKEN_RESPONSE,
  });

  scriptResults.getToken = await runPreRequest({
    requestName: "Get Token",
    env: { ...CREDENTIALS },
    tokenResponse: TOKEN_RESPONSE,
  });

  scriptResults.logout = await runPreRequest({
    requestName: "Logout",
    env: { ...CREDENTIALS },
    tokenResponse: TOKEN_RESPONSE,
  });

  try {
    await runPreRequest({
      requestName: "List Stacks",
      env: { SPACELIFT_ENDPOINT: "https://myaccount.app.spacelift.io/graphql" },
      tokenResponse: TOKEN_RESPONSE,
    });
    scriptResults.unconfigured = null;
  } catch (err) {
    scriptResults.unconfigured = err;
  }

  try {
    await runPreRequest({
      requestName: "List Stacks",
      env: { ...CREDENTIALS },
      tokenResponse: { errors: [{ message: "invalid API key" }] },
    });
    scriptResults.badCredentials = null;
  } catch (err) {
    scriptResults.badCredentials = err;
  }
}

function assertScriptBehavior() {
  suite("The token refresh script");

  test("mints a token when the environment has none", () => {
    equal(scriptResults.noToken.calls.length, 1, "token requests made");
    assert(scriptResults.noToken.env.jwt, "no jwt stored");
  });

  test("leaves a token that is still good alone", () => {
    equal(scriptResults.freshToken.calls.length, 0, "token requests made");
  });

  test("replaces a token that is about to expire", () => {
    equal(scriptResults.expiringToken.calls.length, 1, "token requests made");
  });

  test("replaces a token that has already expired", () => {
    equal(scriptResults.expiredToken.calls.length, 1, "token requests made");
  });

  test("replaces a token it cannot read rather than trusting it", () => {
    equal(scriptResults.garbageToken.calls.length, 1, "token requests made");
  });

  test("leaves Get Token and Logout to manage their own token", () => {
    equal(scriptResults.getToken.calls.length, 0, "Get Token requests made");
    equal(scriptResults.logout.calls.length, 0, "Logout requests made");
  });

  test("names every missing variable when the environment is unconfigured", () => {
    const err = scriptResults.unconfigured;
    assert(err, "expected an error, got none");
    for (const name of [
      "SPACELIFT_ENDPOINT",
      "SPACELIFT_API_KEY_ID",
      "SPACELIFT_API_KEY_SECRET",
    ]) {
      assert(
        err.message.includes(name),
        `error does not mention ${name}: ${err.message}`,
      );
    }
  });

  test("surfaces the API's own message when credentials are rejected", () => {
    const err = scriptResults.badCredentials;
    assert(err, "expected an error, got none");
    assert(
      err.message.includes("invalid API key"),
      `error does not quote the API: ${err.message}`,
    );
  });

  test("sends the key id and secret as the mutation's variables", () => {
    const sent = scriptResults.noToken.calls[0].data;
    equal(sent.variables.apiKeyId, "key-id", "apiKeyId sent");
    equal(sent.variables.apiKeySecret, "key-secret", "apiKeySecret sent");
  });
}

// ---------------------------------------------------------------------------
// Response examples
// ---------------------------------------------------------------------------

function assertResponseExamples() {
  suite("Response examples say what they are");

  test("every generated example is labeled illustrative", () => {
    const bad = [];
    let found = 0;

    for (const file of requestFiles) {
      const json = bruToJsonV2(fs.readFileSync(file, "utf8"));
      for (const example of json.examples ?? []) {
        if (example.name !== "Example response") continue; // human-saved
        found++;
        // These are synthesized from the schema, not captured from an account.
        // An example that stopped saying so would be a fabricated response
        // presented as a real one.
        if (!/generated from the schema/i.test(example.description ?? "")) {
          bad.push(`${rel(file)}: example does not say it is generated`);
        }
        // Bru has no numeric type, so a status round-trips as a string.
        if (String(example.response?.status) !== "200") {
          bad.push(
            `${rel(file)}: example status is ${example.response?.status}`,
          );
        }
      }
    }

    assert(found > 0, "no generated examples found");
    assert(bad.length === 0, bad.join("\n        "));
  });
}

// ---------------------------------------------------------------------------

exerciseScript()
  .then(assertScriptBehavior)
  .then(assertResponseExamples)
  .then(() => {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`${passed} passed, ${failures.length} failed`);
    if (failures.length > 0) {
      console.log("");
      for (const f of failures) console.log(`  ${f.suite} › ${f.name}`);
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error(`\nTest run crashed: ${err.stack}`);
    process.exit(1);
  });
