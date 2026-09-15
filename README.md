# Spacelift API Bruno Collection

A [Bruno](https://www.usebruno.com/) collection covering the Spacelift GraphQL API. Use it to explore, test, and script against your Spacelift account.

## Prerequisites

- [Bruno](https://www.usebruno.com/downloads) desktop app or the [Bruno VS Code extension](https://marketplace.visualstudio.com/items?itemName=bruno-api-client.bruno)
- A Spacelift account with an API key — [create one under **Settings → API Keys**](https://docs.spacelift.io/integrations/api#spacelift-api-key-token)

## Setup

### 1. Get the Collection

#### Option A — Clone from inside Bruno (recommended)

No terminal, and the collection stays a git checkout you can update later.

1. In the Bruno desktop app, open **Import Collection** (the **+** menu in the sidebar) and pick the **Git Repository** tab.
2. Paste `https://github.com/spacelift-io/spacelift-api-bruno.git` and click **Clone**.
3. Choose a location to clone into, optionally pick a branch, and click **Clone**.
4. Bruno scans the clone and lists the collections it finds. Select **Spacelift** and click **Open**.

Bruno shells out to `git`, so it must be installed and on your `PATH`. This flow is desktop-only. The VS Code extension has no clone option, so use option B there.

The collection lives in the `Spacelift/` subfolder rather than at the repository root; Bruno's clone scans the whole repository, so it finds it either way.

#### Option B — Clone yourself and open the folder

```bash
git clone https://github.com/spacelift-io/spacelift-api-bruno.git
```

Then in Bruno click **Open Collection** and select the `Spacelift/` folder.

### 2. Configure Your Environment

The collection ships with an environment called **My Account**, already selected in the
environment dropdown at the top right. Nothing to copy or create — open it (gear icon →
Environments → My Account) and fill in three values:

| Variable                   | Description                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `SPACELIFT_ENDPOINT`       | Your account's GraphQL endpoint, e.g. `https://myaccount.app.spacelift.io/graphql` |
| `SPACELIFT_API_KEY_ID`     | The ID of your API key (shown after creation)                                      |
| `SPACELIFT_API_KEY_SECRET` | The secret for your API key (shown only once at creation)                          |

Leave `jwt` alone — the collection mints and refreshes it for you.

`SPACELIFT_API_KEY_SECRET` and `jwt` are **secret variables**. Bruno keeps their values in
its own encrypted store and writes only their names into `My Account.bru`, so the file
stays safe to commit and your credentials never reach git. That is why the environment can
ship with the collection at all.

Working with more than one Spacelift account? Duplicate the environment and name the copies
after your accounts. Only `My Account` is tracked in git; anything else you add is ignored.

### 3. Send a Request

That's it — open any request and send it. The collection authenticates itself: a
collection-level pre-request script mints a token the first time you need one and
replaces it a couple of minutes before it expires, so you should never see an
authentication error or have to think about tokens.

**Auth → Get Token** is still there if you want a token explicitly — to copy one out for
use elsewhere, say — but nothing requires you to run it.

If the environment isn't filled in yet, the first request stops with a message naming
exactly which variables are still missing, rather than a bare 401.

## Typical Workflows

**Trigger and confirm a run:**

1. **Stacks → List Stacks** — find your stack's ID
2. **Runs → Trigger Run** — set `stack` to that ID
3. **Runs → Confirm Run** — set `stack` and `run` to confirm it

**Attach a policy to a stack:**

1. **Policies → List Policies** — find the policy ID
2. **Stacks → List Stacks** — find the stack ID
3. **Policies → Attach Policy** — provide both IDs

**Add an environment variable to a context:**

1. **Contexts → List Contexts** — find the context ID
2. **Contexts → Add Config** — set `context` to that ID, set `config.type` to `ENVIRONMENT_VARIABLE`

## Placeholder Values

Requests that require IDs use obvious placeholder strings like `STACK_ID_HERE`. Replace these in the **Variables** panel before sending.

## Collection Structure

The collection covers all Spacelift API endpoints, organized into folders by resource type.

## What's Changed

[CHANGELOG.md](./CHANGELOG.md) lists every request added, corrected, deprecated or removed, one line each. The newest entries also show up in Bruno itself — open the collection's **Docs** pane — so you can see what moved without leaving the app.

## Contributing

For information about how to contribute, please see our [CONTRIBUTING.md](./CONTRIBUTING.md) file.

## License

This repository is licensed under the [MIT License](./LICENSE).
