#!/usr/bin/env node
/**
 * introspect.js — Prints the SDL for schema types and root fields.
 *
 * The quickest way to see what a request can select or must pass: a type
 * prints with its fields and descriptions, a root field with its arguments,
 * return type and deprecation.
 *
 * It exists so the weekly sync job's Claude run can introspect with one
 * allowlisted command, instead of `curl | python3`, which would mean allowing
 * arbitrary code in a job that holds an API key.
 *
 * Usage:
 *   node scripts/introspect.js Run StackInput        types
 *   node scripts/introspect.js Mutation.runLogsDelete root fields
 *   node scripts/introspect.js --endpoint <url> Query.stacks
 *
 * No credentials required — uses the public introspection endpoint.
 */

const {
  buildClientSchema,
  getIntrospectionQuery,
  printType,
  print,
  astFromValue,
} = require("graphql");
const https = require("https");
const http = require("http");

const DEFAULT_ENDPOINT = "https://demo.app.spacelift.io/graphql";

const args = process.argv.slice(2);
const endpointFlag = args.indexOf("--endpoint");
const ENDPOINT =
  endpointFlag !== -1 ? args[endpointFlag + 1] : DEFAULT_ENDPOINT;
const names =
  endpointFlag === -1
    ? args
    : args.filter((_, i) => i !== endpointFlag && i !== endpointFlag + 1);

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

function describe(text, indent = "") {
  if (!text) return "";
  return `${indent}"""\n${text
    .split("\n")
    .map((l) => indent + l)
    .join("\n")}\n${indent}"""\n`;
}

/** SDL for one root field, as it would appear inside `type Mutation { }`. */
function printField(root, field) {
  const params = field.args.map((arg) => {
    const def =
      arg.defaultValue !== undefined
        ? ` = ${print(astFromValue(arg.defaultValue, arg.type))}`
        : "";
    return `${describe(arg.description, "  ")}  ${arg.name}: ${arg.type}${def}`;
  });
  const deprecated = field.deprecationReason
    ? ` @deprecated(reason: ${JSON.stringify(field.deprecationReason)})`
    : "";
  const signature = params.length ? `(\n${params.join("\n")}\n)` : "";
  return `# ${root}.${field.name}\n${describe(field.description)}${field.name}${signature}: ${field.type}${deprecated}`;
}

async function main() {
  if (!names.length) {
    console.error(
      "Usage: node scripts/introspect.js <Type | Query.field | Mutation.field> ...",
    );
    process.exit(1);
  }

  const result = await post(ENDPOINT, { query: getIntrospectionQuery() });
  if (result.errors) {
    throw new Error(result.errors.map((e) => e.message).join("\n"));
  }
  const schema = buildClientSchema(result.data);

  let missing = 0;
  const out = [];
  for (const name of names) {
    const [typeName, fieldName] = name.split(".");
    const type = schema.getType(typeName);
    if (!type) {
      console.error(`No type named ${typeName}`);
      missing++;
      continue;
    }
    if (!fieldName) {
      out.push(printType(type));
      continue;
    }
    const field = type.getFields?.()[fieldName];
    if (!field) {
      console.error(`No field ${name}`);
      missing++;
      continue;
    }
    out.push(printField(typeName, field));
  }

  console.log(out.join("\n\n"));
  if (missing) process.exit(1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
