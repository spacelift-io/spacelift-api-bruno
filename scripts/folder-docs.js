/**
 * folder-docs.js — Hand-written documentation for every folder in the collection.
 *
 * Unlike request docs, which sync-docs.js copies from the schema, these cannot
 * be generated: a schema describes one operation at a time and never says which
 * order to send them in, which of two folders supersedes the other, or that an
 * integration attached to nothing does nothing. That is exactly what someone
 * needs before they start clicking through 25 requests.
 *
 * Bruno renders a folder's docs in its Docs pane, the same as a request's, so
 * this is the first thing a reader sees after opening a folder.
 *
 * The map is keyed by folder path relative to `Spacelift/`, with `/` separators.
 * `sync-docs.js` writes each entry into that folder's `folder.bru`, and
 * `sync-docs.js --check` fails when a folder has no entry or its file has
 * fallen behind — so a new folder cannot be added without documenting it.
 *
 * Keep entries short. Three or four sentences that say what the folder is for,
 * what order things happen in, and the one thing that will otherwise trip
 * someone up. Detail about a single operation belongs in the schema, where
 * sync-docs.js will pick it up on its own.
 */

const FOLDER_DOCS = {
  // ---------------------------------------------------------------------
  // Everyday surface
  // ---------------------------------------------------------------------

  Account: `Read-only facts about your Spacelift account, needed when you configure
things around it: the AWS account ID Spacelift assumes roles from, the default
runner images, and the outgoing IP addresses to allowlist on your firewall.`,

  "AI Integrations": `Connections to AI providers backing Spacelift's AI features. One request per
lifecycle step: create, read, update, delete.`,

  Ansible: `Hosts and tasks discovered by Ansible stacks. Read-only — Ansible runs are
triggered through **Runs**, like any other stack.`,

  "API Keys": `Machine credentials for this API, including the one you are using now.

**Create API Key** returns the secret exactly once; store it before you close
the response. **Reset API Key** issues a new secret and invalidates the old one,
which will break anything still using it.

A key starts with no permissions. Grant them under
**Roles → API Key Role Bindings**.`,

  "Audit Trail": `The account's audit log, and the webhook Spacelift delivers audit entries to.

**Search Audit Trail Entries** is the read path. The rest configure delivery —
set the webhook, then add any headers your receiver needs to authenticate it.

The webhook delete and both header requests are in **Danger Zone**.`,

  Auth: `Getting a token by hand.

You normally don't need this. The collection keeps a token for you, minting one
on your first request and replacing it before it expires.

Use **Get Token** when you want a token to use elsewhere — in curl, a script, or
\`spacectl\`. **Logout** invalidates the current session.`,

  "Blob Storage": `Integration that keeps large run artifacts in your own object storage rather
than Spacelift's.

**Update Blob Storage Integration** is in **Danger Zone**.`,

  Blueprints: `Blueprints stamp out stacks from a parameterized definition. **Get Blueprint
Schema** tells you which inputs one expects, **Parse Template** checks a
definition before you save it, and **Create Stack from Blueprint** is the payoff.

⚠ Blueprints are being superseded by **Templates**. Many requests in this folder
and its subfolders are deprecated and name their replacement in their own docs.
New work should start in **Templates**.`,

  "Blueprints/Deployments": `Tracks what a blueprint has deployed, and attaches those deployments to
integrations.

⚠ Deprecated in favor of **Templates → Deployments**.`,

  "Blueprints/Groups": `Blueprints grouped so related definitions stay together.`,

  "Blueprints/Versioned Groups": `Blueprint groups that carry versions.

⚠ Deprecated in favor of **Templates**.`,

  "Blueprints/Versions": `Individual versions of a versioned blueprint, and creating a stack from a
specific one.

⚠ Deprecated in favor of **Templates → Versions**.`,

  "Cloud Integrations": `Credentials Spacelift assumes when your runs talk to a cloud provider, so no
stack has to hold long-lived keys.

The shape is the same for every provider: create the integration once, then
attach it to each stack or intent project that needs it. An integration that
exists but is attached to nothing has no effect.`,

  "Cloud Integrations/AWS": `An IAM role Spacelift assumes for the duration of a run.

Create the integration, then **Attach to Stack** or **Attach to Intent Project** —
creating it is not enough on its own. **Update Attachment** changes an existing
attachment (read vs. write, for instance) without detaching and re-attaching.`,

  "Cloud Integrations/Azure": `A subscription and tenant Spacelift authenticates to for the duration of a run.
Same shape as AWS: create, then attach.`,

  Contexts: `Reusable bundles of environment variables and mounted files, attached to stacks
so configuration is shared rather than copied.

**Add Config** puts one variable or file into a context — set \`config.type\` to
\`ENVIRONMENT_VARIABLE\` or \`FILE_MOUNT\`. **Attach Context** binds the context to a
stack with a \`priority\`; when two contexts set the same key, priority decides
which wins.`,

  "Drift Detection": `Scheduled re-planning that tells you when a stack's real infrastructure has
diverged from its code, and optionally reconciles it.

There is no list request here — a stack's drift detection configuration comes
back with the stack itself.`,

  "External Integrations": `Third-party integrations registered against the account.`,

  Flows: `Spacelift Flows: projects, their running instances, and the role bindings that
decide who may use them.`,

  "GPG Keys": `Keys used to sign and verify artifacts in the private module and provider
registries.`,

  "Managed Users": `Users whose accounts Spacelift owns, as opposed to users arriving through SSO.

Invite, update and remove them here, along with the self-service requests a user
makes on their own behalf. What a user may actually *do* is decided separately,
by role bindings under **Roles**.

**Unlink Identity Federation** is in **Danger Zone**.`,

  "Managed Users/User Groups": `Groups of managed users, and the mapping from an identity provider's groups onto
them.

Bind roles to a group under **Roles → User Group Role Bindings** rather than to
each user individually — it is the difference between one binding and fifty.`,

  Modules: `The private Terraform/OpenTofu module registry.

Create the module here, then push versions under **Versions**. **Share Module**
exposes it to other accounts.`,

  "Modules/Versions": `Publishing and withdrawing module versions.

**Push Version** uploads one and **Trigger Version** builds and tests it.
**Yank Version** withdraws a published version without deleting it, so existing
consumers keep working while new ones are steered away. **Propose Local
Workspace** tests uncommitted local changes before you push anything.`,

  "OpenTofu Migration": `Tooling for moving stacks from Terraform to OpenTofu.

Work in order:

1. **Check OpenTofu Features** and **Search Migratable Stacks** — see what can move
2. **Migrate Stacks** — in **Danger Zone**, since it moves every stack it matches
3. **Search Migration Queue** — follow progress

**Clean Migration Queue** empties the queue and is in **Danger Zone** too.`,

  "Origin Integration": `Settings for the built-in Origin (Cursor) integration. The read returns null
when the Origin app is not installed on the account.

**Delete Origin Integration** is in **Danger Zone**.`,

  "Personal API Keys": `API keys scoped to you rather than to the account, for personal tooling.
Created, then enabled or disabled.

Whether users may create them at all is an account setting: read it with
**Advanced → Account Settings → Personal Api Keys Enabled**. Changing it is
**Account Set Personal Api Keys Enabled**, in **Danger Zone**.`,

  Plugins: `Plugins installed into the account, and their lifecycle.`,

  "Plugins/Templates": `The catalog of templates a plugin can be installed from.`,

  Policies: `Rego policies that decide what Spacelift allows: which runs proceed, who may
approve them, what a plan is permitted to change.

Create the policy, then **Attach Policy** to a stack — or use **Autoattachment for
Labels** to attach it automatically to every stack carrying a label.

**Simulate Policy** evaluates a policy against sample input without attaching it
to anything. That is the safe way to develop one. **List Policy Input Captures**
and **Get Policy Input Capture** give you real inputs to simulate against.`,

  Repos: `Source repositories and their commits as Spacelift sees them, including file
search and commit history. Everything here reads through your VCS integration.

The **Revision** requests are deprecated in favor of the **Repo Commit** ones.`,

  Resources: `Everything Spacelift knows about the infrastructure your stacks manage,
searchable by stack, type or provider. Read-only, derived from run state.`,

  Roles: `Role-based access control.

A **role** is a named set of permissions. A **role binding** grants that role to a
subject — a user, a group, an API key — on a space or a single stack. The
subfolders hold the binding types.

A role on its own does nothing. It takes effect only once bound.`,

  "Roles/API Key Role Bindings": `Grants a role to an API key. **Batch Create** is the efficient path when setting
up several at once.`,

  "Roles/Stack Role Bindings": `Grants a role on one specific stack, for access narrower than a whole space.`,

  "Roles/User Group Role Bindings": `Grants a role to a group. Prefer this to binding each member individually —
group membership then does the work.`,

  "Roles/User Role Bindings": `Grants a role to an individual user.`,

  Runs: `The run lifecycle.

**Trigger Run** starts one. A run that needs approval waits until **Confirm Run**
applies it or **Discard Run** throws it away — and if you omit the run ID, both
act on whichever run is currently blocking the stack.

Three requests end a run, at different stages:

- **Cancel Run** — one that has not started yet
- **Stop Run** — one in progress
- **Kill Run** — a stopped run whose process has not terminated

**Review Run** records an approval decision on a policy-gated run; **Retry Run**
re-runs a failed one.

Most requests here need both a stack ID and a run ID.

**Delete Run Logs** is in **Danger Zone**.`,

  "Saved Filters": `Named, shareable filter sets for the list views in the Spacelift web UI.`,

  Scans: `Security and compliance scans over your infrastructure.

1. **Create Scan** — the scan definition
2. **Trigger Scan Run** — execute it
3. **Get Scan Run** — read the results

**List Scan Provider Schemas** tells you which providers can be scanned and what
each one accepts — anything absent there cannot be scanned.

⚠ \`ScanProviderConfigInput.version\` is typed as a plain \`String\` but only accepts
particular values. Take them from **List Scan Provider Schemas**; anything else is
rejected when the scan runs.`,

  Spaces: `Spaces are the unit of isolation and access control. Every stack, context and
integration lives in exactly one, and spaces inherit from their parent.

The \`… With Access To Space\` requests answer "who can reach this space", across
users, groups, API keys and sessions. **Get Metrics** reports activity within one.`,

  "Spaces/Attachable Resources": `What may legally be attached to a stack in a given space, taking the space's
inheritance into account.

Use these to populate a picker, rather than attempting an attachment and
handling the failure.`,

  Stacks: `The core object: a tracked piece of infrastructure, bound to a repository, a
branch and a project root.

**Create Stack** and **Update Stack** take a large input — running **Get Stack**
against an existing stack is the quickest way to see the shape you need.
**Lock Stack** reserves a stack so nobody else can run against it while you work.
The state requests move Terraform state in and out, including a rollback.

**Migrate Vendor For All Stacks** is in **Danger Zone**.`,

  "Stacks/Dependencies": `Ordering between stacks — run this one only after that one — and the outputs
passed along the edge.

The Dependency requests create and remove the edge itself. The Reference
requests say which output of the upstream stack feeds which input of the
downstream one.`,

  "Stacks/Scheduled Deletes": `Schedules a stack, and optionally the resources it manages, to be destroyed at a
set time. The usual reason is an ephemeral environment that should clean itself
up.`,

  "Stacks/Scheduled Runs": `Runs a stack on a schedule — a nightly plan, a weekly apply.`,

  "Stacks/Scheduled Tasks": `Runs an arbitrary command against a stack's workspace on a schedule.`,

  "Stacks/Webhooks": `Webhooks scoped to one stack, which Spacelift posts that stack's run events to.
Account-wide webhooks live in the top-level **Webhooks** folder.`,

  Templates: `Templates are the successor to **Blueprints**: a parameterized, versioned stack
definition, with deployments recording what came out of it.

New work belongs here. The equivalent Blueprint requests are deprecated and name
these as their replacement.`,

  "Templates/Deployments": `What a template has produced. **Rollback Deployment** returns a deployment to an
earlier version.`,

  "Templates/Versions": `Versions of a template. **Deprecate Version** discourages new use without
breaking deployments already on it.`,

  "Terraform Providers": `The private Terraform provider registry.

Publishing is a sequence, and skipping a step leaves a version nobody can
install:

1. **Create Terraform Provider**
2. **Create Provider Version**
3. **Register Platform** — once per OS/architecture
4. **Upload Version Docs** — optional
5. **Publish Provider Version**

**Revoke Provider Version** withdraws one that should no longer be used.`,

  "Tofu Workspaces": `OpenTofu workspaces inside a stack, with unlock requests for a workspace left
locked by an interrupted run.`,

  "VCS Agent Pools": `Pools of agents that reach a version control system Spacelift cannot connect to
directly — one behind a firewall or on a private network.`,

  "VCS Integrations": `Connections to version control providers.

The requests at this level work across every provider: list, search, test, and
browse repositories and branches. Per-provider setup lives in the subfolders.

**Test VCS Integration** is worth sending after any change — it reports the
connection problem directly, instead of leaving you to infer it from a run that
fails to check out.

The requests that overwrite an integration's host or credentials are in **Danger Zone**.`,

  "VCS Integrations/Azure DevOps": `Setup for Azure DevOps. **Get Webhooks Endpoint** returns the URL to register on
the provider side so Spacelift receives push events.`,

  "VCS Integrations/Bitbucket Cloud": `Setup for Bitbucket Cloud. The **V2** requests are the current ones; the
originals remain for existing integrations. **Get Webhooks Endpoint** returns the
URL to register on the provider side, and **Regenerate Webhook Secret** rotates
the shared secret.`,

  "VCS Integrations/Bitbucket Datacenter": `Setup for self-hosted Bitbucket Data Center. **Get Webhooks Endpoint** returns the
URL to register on the provider side, and **Regenerate Webhook Secret** rotates
the shared secret.`,

  "VCS Integrations/GitHub": `The built-in GitHub App integration. There is no create or delete here — the
integration is established by installing the Spacelift GitHub App, and these
requests read and update what that produced.`,

  "VCS Integrations/GitHub Enterprise": `Setup for self-hosted GitHub Enterprise. **Get Webhooks Endpoint** returns the URL
to register on the provider side, and **Regenerate Webhook Secret** rotates the
shared secret.`,

  "VCS Integrations/GitLab": `Setup for GitLab, hosted or self-managed. **Get Webhooks Endpoint** returns the URL
to register on the provider side, and **Regenerate Webhook Secret** rotates the
shared secret.`,

  "Version Catalog": `Which Terraform, OpenTofu, Terragrunt and kubectl versions Spacelift offers, and
which one a given stack would actually use.

The **Effective Version** requests resolve a version constraint the way a run
would, which is how you check what a stack will get before triggering one.`,

  Webhooks: `Account-wide webhooks Spacelift posts events to, with custom headers for
authenticating to your receiver. Per-stack webhooks live under
**Stacks → Webhooks**.`,

  "Worker Pools": `Private workers that execute runs inside your own network, instead of on
Spacelift's shared workers.

Create the pool here, then run workers against it. **Set Worker Drain** stops a
worker picking up new runs without interrupting the one it is on — the graceful
way to take it out of service. **Cycle Worker Pool** rotates the whole pool, and
**Get Worker Usage** shows how busy it has been.`,

  // ---------------------------------------------------------------------
  // Cookbook — recipes that combine requests, pinned just above Advanced by
  // Cookbook/folder.bru's seq. Each recipe's steps are its own requests, so
  // validate checks them like any other.
  // ---------------------------------------------------------------------

  Cookbook: `Recipes for jobs that take more than one request.

Each folder is one recipe. Its Docs pane lists the steps and which value to carry
from each response into the next, and its requests are those steps, in order.

Nothing is carried over for you. Every ID is a placeholder you fill in from the
step before, so each request does exactly what you see in it.

The steps are copies of requests from the resource folders, trimmed to the fields
the recipe needs.`,

  "Cookbook/Add an Environment Variable to a Context": `Put a variable where every stack the context is attached to will see it.

1. **List Contexts** — copy the context's \`id\`.
2. **Add Config** — paste it into \`context\`, and set \`config.id\` to the variable's
   name and \`config.value\` to its value.

Only stacks the context is attached to see the variable. To attach it, use
**Contexts → Attach Context**.`,

  "Cookbook/Attach a Policy to a Stack": `Make a policy apply to one stack.

1. **List Policies** — copy the policy's \`id\`.
2. **List Stacks** — copy the stack's \`id\`.
3. **Attach Policy** — \`id\` is the policy, \`stack\` is the stack.`,

  "Cookbook/Download Policy Evaluation Samples": `Fetch what a policy actually saw when it was evaluated: the input, the policy
body at the time, and the result.

1. **List Policy Evaluation Records** — paste the policy ID into \`id\`. Each
   \`evaluationRecords\` entry is one sampled evaluation.
2. **Get Policy Evaluation Sample** — send once per sample, with that entry's
   \`key\`, and save the parts of the response you need.

The policy ID is an \`id\` from **Policies → List Policies**.

Only evaluations the policy chose to sample are recorded. A policy samples when
its \`sample\` rule returns true, so a policy without one has nothing here; add
\`sample if true\` to capture every evaluation. Spacelift's docs say it keeps the
100 most recent samples from the past 7 days, and that samples are visible to
account administrators only.

A sample's \`input\` replays in **Policies → Simulate Policy**, which is the way to
test a policy change against real traffic before saving it.`,

  "Cookbook/Download Run Logs": `Download the log of every phase a run went through: initializing, planning,
applying and the rest.

1. **Get Run History** — paste the run ID into \`id\`. Each \`history\` entry with
   \`hasLogs: true\` is a phase with a log.
2. **Get Run Logs Download URL** — send once per phase, with that entry's \`state\`
   and \`stateVersion\`, and open the \`url\` in the response.

The run ID is the last part of the run's URL in Spacelift, or an \`id\` from
**Runs → Search Runs**.

\`expired\` or \`deleted\` means the log is gone: it outlived the account's retention
period, or somebody sent **Danger Zone → Delete Run Logs**. \`ongoing\` means the
run is still in that phase and the log is not complete yet.`,

  "Cookbook/Trigger and Confirm a Run": `Start a deployment, and apply it once you have seen what it will change.

1. **List Stacks** — copy the stack's \`id\`, and check its \`autodeploy\`.
2. **Trigger Run** — paste the stack ID into \`stack\`. The response's \`id\` is the
   run.
3. **Get Run** — paste the run ID into \`id\`, and send it until \`state\` is
   \`UNCONFIRMED\`. \`delta\` counts what will be added, changed and deleted.
4. **Confirm Run** — \`stack\` and \`run\` are those two IDs. The run applies.

⚠ On a stack with \`autodeploy\` set there is nothing to confirm: the run applies
as soon as its plan succeeds, so step 2 alone changes your infrastructure. To see
a plan without that risk, set \`runType\` to \`PROPOSED\` in step 2 and stop at
step 3.`,

  // ---------------------------------------------------------------------
  // Danger Zone — the destructive requests nothing can prompt for, pinned
  // below Advanced by Danger Zone/folder.bru's seq.
  // ---------------------------------------------------------------------

  "Danger Zone": `# ⚠ DANGER ZONE

**Requests you cannot take back.**

Some destroy something outright:

- **Session Delete All** — ends every session in the account
- **Saml Delete** — removes the SSO configuration
- **Account Confirm Delete** — finishes deleting the account
- **Delete Run Logs** — erases a run's logs before retention would

The rest overwrite account-wide settings with whatever is in the request body:

- **Update GitLab Integration** — replaces the host every GitLab stack builds from
- **Slack App Config Set** — replaces secrets Spacelift will not show you again
- **Migrate Vendor For All Stacks** — moves every stack to another vendor
- **Billing Subscription Update Tier** — changes what you are charged
- **Account Set Personal Api Keys Enabled** — can disable every personal key at once

Putting any of them back needs values you may no longer have.

To send one, set \`CONFIRM_DESTRUCTIVE\` in your environment to that request's exact
name. It arms that request and no other, and everything else here stays refused —
including during a run of the whole collection. Clear it when you are done.

Reading is unaffected, and the create and read requests these belong with are
still under **Advanced → SSO**, **VCS Integrations**, **Audit Trail**, **Runs** and the rest.`,

  // ---------------------------------------------------------------------
  // Advanced — administrative and in-app plumbing, pinned to the bottom of
  // the sidebar by Advanced/folder.bru's seq.
  // ---------------------------------------------------------------------

  Advanced: `Administrative and internal corners of the API: billing, SSO, account-wide
settings, and the endpoints that power the Spacelift web UI itself.

Everything here is real and callable — Spacelift staff and advanced users have
good reasons to reach it, and hiding it would only make it harder to find. It is
just not the everyday surface, which is why the folder sits at the bottom of the
sidebar and why each request carries an **ADVANCED** note saying what its
category is for.

Expect less stability here than elsewhere. These endpoints serve the product's
own UI and can change with it.`,

  "Advanced/Account": `The account's own identity — id, name and type.`,

  "Advanced/Account Settings": `Reads and writes for every account-wide setting: MFA enforcement, retention
windows, AI features, and who may manage API keys or create spaces.

Most come in pairs — a query that reads the current value, and an \`account…\`
mutation that sets it. Read before you write; these apply to everyone in the
account.

**Account Confirm Delete** and **Account Set Personal Api Keys Enabled** are in
**Danger Zone**.`,

  "Advanced/Analytics": `Product analytics events the web UI emits. Present for completeness; there is no
reason to call these from your own tooling.`,

  "Advanced/Billing": `Subscription, tier, seats and usage.

The mutations change what you are charged. Read **Billing Subscription** and
**Tier Features** before sending any of them.

The subscription create, tier change and cancellation are in **Danger Zone**.

Usage over time is split by what is billed: **Runs → Run Minutes Usage** for
run minutes, and **Worker Pools → Get Worker Usage** for private workers.`,

  "Advanced/CLI": `The confirmation token behind \`spacectl\`'s browser login flow.`,

  "Advanced/Debug": `Diagnostic information about the installation — the thing to collect when
Spacelift support asks.`,

  "Advanced/Feature Flags": `Evaluates the feature flags in effect for your account. Read-only; the flags
themselves are set by Spacelift.`,

  "Advanced/Forms": `In-app questionnaires the web UI shows, such as onboarding surveys. Not part of
the infrastructure API.`,

  "Advanced/Infrastructure": `Installation-level internals: installation id, message queue depth, policy
runtime version. Mostly of interest to self-hosted operators.`,

  "Advanced/Intent": `Spacelift Intent — managing individual infrastructure resources directly, rather
than through a stack's IaC.

An intent project holds resources and their configuration; the \`Search …\`
requests back the UI's list views, and the chat conversation requests back the
assistant. This is a distinct surface from stacks and runs, with its own
lifecycle.`,

  "Advanced/Notifications": `The in-app notification bell: count, search, and dismissal.`,

  "Advanced/OAuth": `The OAuth endpoints behind Spacelift's own login, plus the Slack redirect. To
authenticate as a machine, use an API key — see **Auth**.`,

  "Advanced/Search Suggestions": `Every list view in the Spacelift UI has a filter bar, and each request here
returns the fields and values available for one of them.

They pair with the matching \`Search …\` request: the suggestion tells you what you
can filter on, the search applies it. Genuinely useful outside the UI — this is
how you discover the valid filter keys for a search instead of guessing.`,

  "Advanced/Sessions and Security Keys": `Active login sessions and WebAuthn security keys for the current user, with
revocation for both. The security email is where Spacelift sends security
notices.

The two bulk revocations are in **Danger Zone**.`,

  "Advanced/Slack": `Slack workspace integration, and the GitHub App manifest flow that lives
alongside it.

**Slack App Config Set** and **Slack App Config Delete** are in **Danger Zone**.`,

  "Advanced/SSO": `SAML, OIDC and SCIM configuration for the account.

⚠ Getting these wrong can lock every user out. Read the current settings before
writing, and keep a working API key to hand — an API key authenticates
independently of SSO and is how you recover.

The updates, deletes and the SCIM reset are in **Danger Zone**.`,

  "Advanced/UI State": `Key/value store the web UI uses to remember layout preferences.`,

  "Advanced/User Guide": `The in-app guided tours and certifications, with progress tracking.`,

  "Advanced/Viewer": `The subject the current token belongs to, and what it is allowed to do.

**Viewer** is the quickest way to check that a token works and to see which
permissions it carries.`,
};

module.exports = { FOLDER_DOCS };
