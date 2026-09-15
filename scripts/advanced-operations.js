/**
 * Operations that exist in the schema but are not what a typical API user is
 * looking for — account administration, billing, SSO, in-app UI plumbing and
 * similar.
 *
 * They are NOT hidden. Spacelift staff and advanced users have real reasons to
 * call them, and deciding what is worth exposing is not this collection's job:
 * if it is in the schema, it gets documented. What this list does is label
 * them, so nobody mistakes them for the everyday surface.
 *
 * Two consumers:
 *   sync-docs.js  — writes "ℹ **ADVANCED** — <note>" into the request's docs block
 *   coverage.js   — groups them in its report and checks they carry the marker
 *
 * Keeping the list here rather than in either script is deliberate: the two
 * must agree on both the membership and the note text.
 */

const ADVANCED_MARKER = "**ADVANCED**";

const CATEGORIES = {
  analytics: {
    folder: "Analytics",
    note: "Client-side tracking event, normally emitted by the Spacelift UI rather than called directly.",
    operations: [
      "groupUserEvent",
      "identifyUserEvent",
      "pageUserEvent",
      "trackUserEvent",
    ],
  },
  "user-guide": {
    folder: "User Guide",
    note: "Drives the in-app onboarding wizard.",
    operations: [
      "activeUserGuideProgress",
      "completedUserGuides",
      "userGuide",
      "userGuideAbandon",
      "userGuideChapter",
      "userGuideChapters",
      "userGuideComplete",
      "userGuideGroup",
      "userGuideGroups",
      "userGuideMoveToNextStep",
      "userGuideMoveToPreviousStep",
      "userGuideRestart",
      "userGuideStart",
      "userGuides",
    ],
  },
  "account-scalars": {
    folder: "Account",
    note: "Account-level scalar exposed as a root query field.",
    operations: ["id", "name", "type"],
  },
  oauth: {
    folder: "OAuth",
    note: "Part of a browser-based OAuth redirect flow; cannot be completed with an API key.",
    operations: [
      "oauthRedirect",
      "oauthToken",
      "oauthUser",
      "slackOauthRedirect",
    ],
  },
  suggestions: {
    folder: "Search Suggestions",
    note: "Autocomplete helper that powers search filters in the UI.",
    operations: [
      "searchAnsibleHostsSuggestions",
      "searchAnsibleTasksSuggestions",
      "searchAuditTrailEntriesSuggestions",
      "searchBlueprintVersionedGroupsSuggestions",
      "searchBlueprintsSuggestions",
      "searchContextsSuggestions",
      "searchIntentProjectsSuggestions",
      "searchIntentResourcesOperationsSuggestions",
      "searchIntentResourcesSuggestions",
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
    ],
  },
  notifications: {
    folder: "Notifications",
    note: "Manages the in-app notification inbox.",
    operations: [
      "dismissAllNotifications",
      "dismissNotificationGroup",
      "dismissNotifications",
      "notificationCount",
      "searchNotifications",
    ],
  },
  "ui-state": {
    folder: "UI State",
    note: "Stores in-app UI preferences.",
    operations: ["uiConfigGet", "uiConfigStore"],
  },
  cli: {
    folder: "CLI",
    note: "Part of the spacectl CLI login flow.",
    operations: ["cliConfirmationToken"],
  },
  debug: {
    folder: "Debug",
    note: "Internal diagnostic field.",
    operations: ["debugInfo"],
  },
  "feature-flags": {
    folder: "Feature Flags",
    note: "Internal feature rollout state.",
    operations: ["evaluateFeatureFlags"],
  },
  billing: {
    folder: "Billing",
    note: "Subscription and billing management, normally handled through Spacelift sales.",
    operations: [
      "availableBillingAddons",
      "availableSelfServicePlans",
      "billedExternally",
      "billingSubscription",
      "billingSubscriptionCreate",
      "billingSubscriptionDelete",
      "billingSubscriptionUpdateInfo",
      "billingSubscriptionUpdateTier",
      "billingSubscriptionUpdateV2",
      "onTrialUntil",
      "seats",
      "tier",
      "tierFeatures",
      "usage",
      "usageAspect",
    ],
  },
  "account-settings": {
    folder: "Account Settings",
    note: "Account-wide administrative setting.",
    operations: [
      "acceptedTermsAndConditionsAI",
      "accountCanBeDeleted",
      "accountCanBeDeletedAt",
      "accountConfirmDelete",
      "accountSetOIDCSubjectTemplate",
      "accountToggleAPIKeyManagementFromNonHumans",
      "accountToggleAllowNonRootAdminSpaceCreation",
      "accountToggleDeletionMark",
      "accountToggleEnforcingMFA",
      "accountUpdateAuthorizationScheme",
      "accountUpdateAwarenessSourceSurvey",
      "accountUpdateDefaultWorkerPoolRunnerImages",
      "accountUpdateSecurityEmail",
      "accountUpdateVCSEventTriggeredRunsLimit",
      "allowNonRootAdminSpaceCreation",
      "apiKeysManageableByNonHumans",
      "apiKeysManagedByNonRootAdmins",
      "auditTrailRetentionDays",
      "authorizationScheme",
      "availableAIProviders",
      "awarenessSourceSurvey",
      "enforceMFA",
      "hasAnsibleStacks",
      "hasSSO",
      "latestTermsAndConditionsVersionAI",
      "markedForDeletion",
      "runLogRetentionDays",
      "vcsEventTriggeredRunsLimit",
    ],
  },
  sso: {
    folder: "SSO",
    note: "Account-level SSO, SAML, SCIM or OIDC configuration.",
    operations: [
      "createOauthClientForSCIM",
      "deleteOauthClientForSCIM",
      "oidcCreate",
      "oidcDelete",
      "oidcSettings",
      "oidcSubjectTemplate",
      "oidcUpdate",
      "resetOauthClientForSCIM",
      "samlCreate",
      "samlDelete",
      "samlSettings",
      "samlUpdate",
      "scimSettings",
    ],
  },
  sessions: {
    folder: "Sessions and Security Keys",
    note: "Manages your own sessions and security keys.",
    operations: [
      "securityEmail",
      "securityKeyDelete",
      "securityKeys",
      "sessionDelete",
      "sessionDeleteAll",
      "sessions",
      "userSecurityKeyDeleteAll",
    ],
  },
  slack: {
    folder: "Slack",
    note: "Account-level Slack or GitHub app configuration.",
    operations: [
      "githubAppCreateFromManifest",
      "githubAppGenerateManifest",
      "slackAppConfig",
      "slackAppConfigDelete",
      "slackAppConfigSet",
      "slackAppManifest",
      "slackIntegration",
    ],
  },
  infrastructure: {
    folder: "Infrastructure",
    note: "Internal infrastructure detail.",
    operations: ["installationId", "policyRuntime"],
  },
  forms: {
    folder: "Forms",
    note: "In-app survey and onboarding forms.",
    operations: [
      "completeGenericForm",
      "genericFormsList",
      "isGenericFormCompleted",
    ],
  },
  intent: {
    folder: "Intent",
    note: "Intent and AI chat preview feature.",
    operations: [
      "intentChatConversation",
      "intentChatConversationCreate",
      "intentChatConversationDelete",
      "intentChatConversationUpdate",
      "intentChatConversations",
      "intentProject",
      "intentProjectConfigAdd",
      "intentProjectConfigDelete",
      "intentProjectConfigUpdate",
      "intentProjectCreate",
      "intentProjectDelete",
      "intentProjectDisable",
      "intentProjectEnable",
      "intentProjectUnlock",
      "intentProjectUpdate",
      "intentProjects",
      "intentResourceOperationReview",
      "searchIntentProjects",
      "searchIntentResources",
      "searchIntentResourcesOperations",
      "stackCreateFromIntent",
    ],
  },
  viewer: {
    folder: "Viewer",
    note: "Returns the currently authenticated user.",
    operations: ["viewer"],
  },
};

/** operation name -> { category, folder, note } */
const ADVANCED = new Map();
for (const [category, { folder, note, operations }] of Object.entries(
  CATEGORIES,
)) {
  for (const name of operations) {
    ADVANCED.set(name, { category, folder, note });
  }
}

module.exports = { ADVANCED, CATEGORIES, ADVANCED_MARKER };
