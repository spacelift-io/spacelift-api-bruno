#!/usr/bin/env node
/**
 * Reports which Spacelift GraphQL operations have no corresponding .bru file.
 *
 * Works in the opposite direction from validate-schema.js:
 *   validate-schema.js  — given files, are they valid?
 *   coverage.js         — given the schema, which operations have no file?
 *
 * No credentials required — uses the public introspection endpoint.
 *
 * Usage:
 *   node scripts/coverage.js
 *   node scripts/coverage.js --endpoint https://myaccount.app.spacelift.io/graphql
 *   node scripts/coverage.js --show-covered        also list covered operations
 *   node scripts/coverage.js --ignore-deprecated   hide deprecated operations
 *   node scripts/coverage.js --show-ignored        show what the ignore list filters out
 */

const { buildClientSchema, getIntrospectionQuery, parse } = require("graphql");
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
const SHOW_COVERED = args.includes("--show-covered");
const IGNORE_DEPRECATED = args.includes("--ignore-deprecated");
const SHOW_IGNORED = args.includes("--show-ignored");

// ---------------------------------------------------------------------------
// Ignore list — operations that exist in the schema but are intentionally
// out of scope for this collection.
// ---------------------------------------------------------------------------

const IGNORED = new Set([
  // Analytics / tracking — client-side events, not API operations
  "trackUserEvent",
  "pageUserEvent",
  "identifyUserEvent",
  "groupUserEvent",

  // User guide — in-app onboarding wizard
  "userGuide",
  "userGuideChapter",
  "userGuideChapters",
  "userGuideGroup",
  "userGuideGroups",
  "userGuides",
  "completedUserGuides",
  "activeUserGuideProgress",
  "userGuideAbandon",
  "userGuideComplete",
  "userGuideMoveToNextStep",
  "userGuideMoveToPreviousStep",
  "userGuideRestart",
  "userGuideStart",

  // Internal account scalars exposed as root Query fields
  "id",
  "name",
  "type",

  // OAuth flows — browser-based, not scriptable via API key
  "oauthRedirect",
  "oauthToken",
  "oauthUser",
  "slackOauthRedirect",

  // *Suggestions — autocomplete helpers, not useful in a request collection
  "searchAnsibleHostsSuggestions",
  "searchAnsibleTasksSuggestions",
  "searchAuditTrailEntriesSuggestions",
  "searchBlueprintsSuggestions",
  "searchBlueprintVersionedGroupsSuggestions",
  "searchContextsSuggestions",
  "searchIntentProjectsSuggestions",
  "searchIntentResourcesSuggestions",
  "searchIntentResourcesOperationsSuggestions",
  "searchManagedEntitiesSuggestions",
  "searchModulesSuggestions",
  "searchNamedWebhooksIntegrationsSuggestions",
  "searchNotificationsSuggestions",
  "searchPoliciesSuggestions",
  "searchPolicyTemplatesSuggestions",
  "searchRepoFilesSuggestions",
  "searchReposSuggestions",
  "searchRevisionsSuggestions",
  "searchStacksSuggestions",
  "searchTofuWorkspacesSuggestions",
  "searchVCSIntegrationsSuggestions",
  "searchWorkerPoolsSuggestions",

  // Notification management — UI concerns
  "searchNotifications",
  "dismissAllNotifications",
  "dismissNotificationGroup",
  "dismissNotifications",
  "notificationCount",

  // In-app UI state
  "uiConfigGet",
  "uiConfigStore",

  // CLI-specific token flow
  "cliConfirmationToken",

  // Internal debug
  "debugInfo",

  // Feature flags — internal feature rollout
  "evaluateFeatureFlags",

  // Billing — managed via Spacelift sales, not API
  "availableBillingAddons",
  "availableSelfServicePlans",
  "billedExternally",
  "billingSubscription",
  "onTrialUntil",
  "tier",
  "tierFeatures",
  "usage",
  "usageAspect",
  "seats",
  "billingSubscriptionCreate",
  "billingSubscriptionDelete",
  "billingSubscriptionUpdateInfo",
  "billingSubscriptionUpdateTier",
  "billingSubscriptionUpdateV2",

  // Account-level admin toggles — not typical API usage
  "accountAcceptTermsAndConditionsVersionForAI",
  "acceptedTermsAndConditionsAI",
  "latestTermsAndConditionsVersionAI",
  "accountCanBeDeleted",
  "accountCanBeDeletedAt",
  "markedForDeletion",
  "accountConfirmDelete",
  "accountToggleDeletionMark",
  "accountToggleEnablingAI",
  "accountToggleEnforcingMFA",
  "accountUpdateAuthorizationScheme",
  "accountUpdateAwarenessSourceSurvey",
  "accountUpdateDefaultWorkerPoolRunnerImages",
  "accountUpdateSecurityEmail",
  "accountUpdateVCSEventTriggeredRunsLimit",
  "accountSetOIDCSubjectTemplate",
  "accountToggleAllowNonRootAdminSpaceCreation",
  "accountToggleAPIKeyManagementFromNonHumans",
  "allowNonRootAdminSpaceCreation",
  "apiKeysManageableByNonHumans",
  "apiKeysManagedByNonRootAdmins",
  "awarenessSourceSurvey",
  "auditTrailRetentionDays",
  "runLogRetentionDays",
  "vcsEventTriggeredRunsLimit",
  "authorizationScheme",
  "enforceMFA",
  "hasSSO",
  "hasAIEnabled",
  "hasAnsibleStacks",
  "llmVendor",
  "changeLLMVendor",
  "availableAIProviders",

  // SSO / SAML / SCIM / OIDC — account-level integrations
  "samlSettings",
  "oidcSettings",
  "oidcSubjectTemplate",
  "scimSettings",
  "samlCreate",
  "samlDelete",
  "samlUpdate",
  "oidcCreate",
  "oidcDelete",
  "oidcUpdate",
  "createOauthClientForSCIM",
  "deleteOauthClientForSCIM",
  "resetOauthClientForSCIM",

  // Session / security key management — personal account
  "sessions",
  "sessionDelete",
  "sessionDeleteAll",
  "securityEmail",
  "securityKeys",
  "securityKeyDelete",
  "userSecurityKeyDeleteAll",

  // Slack integration — account-level app config
  "slackIntegration",
  "slackAppConfig",
  "slackAppManifest",
  "slackAppConfigDelete",
  "slackAppConfigSet",
  "githubAppCreateFromManifest",
  "githubAppGenerateManifest",

  // Internal infra info
  "outgoingIPAddresses",
  "spaceliftAwsAccountId",
  "installationId",
  "defaultPrivateWorkerPoolRunnerImage",
  "defaultPublicWorkerPoolRunnerImage",
  "policyRuntime",

  // Generic forms — in-app survey/onboarding
  "genericFormsList",
  "isGenericFormCompleted",
  "completeGenericForm",

  // Intent / AI chat — preview features
  "intentChatConversation",
  "intentChatConversations",
  "intentProject",
  "intentProjects",
  "searchIntentProjects",
  "searchIntentResources",
  "searchIntentResourcesOperations",
  "intentProjectConfigAdd",
  "intentProjectConfigDelete",
  "intentProjectConfigUpdate",
  "intentProjectCreate",
  "intentProjectDelete",
  "intentProjectDisable",
  "intentProjectEnable",
  "intentProjectUnlock",
  "intentProjectUpdate",
  "intentChatConversationCreate",
  "intentChatConversationDelete",
  "intentChatConversationUpdate",
  "intentResourceOperationReview",
  "stackCreateFromIntent",

  // Viewer — the currently authenticated user
  "viewer",
]);

// ---------------------------------------------------------------------------
// Helpers (shared with validate-schema.js)
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
 * Parse a GraphQL operation string and return the set of root field names used.
 * e.g. "query { stacks { id } }" → Set { "stacks" }
 */
function extractRootFields(gql) {
  let doc;
  try {
    doc = parse(gql);
  } catch {
    return new Set();
  }

  const fields = new Set();
  for (const def of doc.definitions) {
    if (def.kind === "OperationDefinition") {
      for (const sel of def.selectionSet.selections) {
        if (sel.kind === "Field") {
          fields.add(sel.name.value);
        }
      }
    }
  }
  return fields;
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

  const schema = buildClientSchema(introspectionResult);

  // 2. Collect all Query and Mutation root fields from schema
  const schemaOps = { Query: new Map(), Mutation: new Map() };

  for (const typeName of ["Query", "Mutation"]) {
    const type = schema.getType(typeName);
    if (!type) continue;
    for (const [name, field] of Object.entries(type.getFields())) {
      if (name.startsWith("__")) continue;
      if (IGNORED.has(name)) continue;
      const deprecated = !!field.deprecationReason;
      if (IGNORE_DEPRECATED && deprecated) continue;
      schemaOps[typeName].set(name, { deprecated });
    }
  }

  const totalOps = schemaOps.Query.size + schemaOps.Mutation.size;

  let ignoredCount = 0;
  for (const typeName of ["Query", "Mutation"]) {
    const type = schema.getType(typeName);
    if (!type) continue;
    for (const name of Object.keys(type.getFields())) {
      if (IGNORED.has(name)) ignoredCount++;
    }
  }

  // 3. Scan .bru files and collect covered root fields
  const bruFiles = findBruFiles(COLLECTION_DIR);
  const covered = new Set();

  for (const filePath of bruFiles) {
    const content = fs.readFileSync(filePath, "utf8");
    if (!content.includes("body:graphql")) continue;
    const gql = extractGraphQL(content);
    if (!gql) continue;
    for (const field of extractRootFields(gql)) {
      covered.add(field);
    }
  }

  // 4. Report
  const coveredCount = [
    ...schemaOps.Query.keys(),
    ...schemaOps.Mutation.keys(),
  ].filter((name) => covered.has(name)).length;

  const pct = Math.round((coveredCount / totalOps) * 100);
  const filters = [];
  if (IGNORE_DEPRECATED) filters.push("deprecated hidden");
  if (ignoredCount > 0) filters.push(`${ignoredCount} out-of-scope ops hidden`);
  const filterNote = filters.length ? `  (${filters.join(", ")})` : "";

  console.log(
    `\nCoverage: ${coveredCount}/${totalOps} operations (${pct}%)${filterNote}`,
  );
  console.log(`Scanned:  ${bruFiles.length} .bru files\n`);

  if (SHOW_IGNORED) {
    console.log(`── Ignored (out of scope) ${"─".repeat(35)}`);
    for (const name of [...IGNORED].sort()) {
      console.log(`   ○  ${name}`);
    }
    console.log();
  }

  for (const typeName of ["Query", "Mutation"]) {
    const ops = schemaOps[typeName];
    const missing = [...ops.entries()].filter(([name]) => !covered.has(name));
    const present = [...ops.entries()].filter(([name]) => covered.has(name));

    console.log(`── ${typeName} ─────────────────────────────────────────────`);
    console.log(`   ${present.length} covered, ${missing.length} missing\n`);

    if (missing.length > 0) {
      console.log(`   Missing:`);
      for (const [name, { deprecated }] of missing.sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        const tag = deprecated ? "  [deprecated]" : "";
        console.log(`     ✗  ${name}${tag}`);
      }
      console.log();
    }

    if (SHOW_COVERED && present.length > 0) {
      console.log(`   Covered:`);
      for (const [name, { deprecated }] of present.sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        const tag = deprecated ? "  [deprecated]" : "";
        console.log(`     ✓  ${name}${tag}`);
      }
      console.log();
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
