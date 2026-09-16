# Spacelift API Bruno Collection

A [Bruno](https://www.usebruno.com/) collection covering the Spacelift GraphQL API. Use it to explore, test, and script against your Spacelift account.

[<img src="https://fetch.usebruno.com/button.svg" alt="Fetch in Bruno" width="128" height="32">](https://fetch.usebruno.com?url=https://github.com/spacelift-io/spacelift-api-bruno.git "target=_blank rel=noopener noreferrer")

## Prerequisites

- [Bruno](https://www.usebruno.com/downloads) desktop app or the [Bruno VS Code extension](https://marketplace.visualstudio.com/items?itemName=bruno-api-client.bruno)
- A Spacelift account with an API key — [create one under **Settings → API Keys**](https://docs.spacelift.io/integrations/api#spacelift-api-key-token)

## Setup

### 1. Get the Collection

> [!IMPORTANT]
> Options A and B are desktop-only, and both shell out to `git`, so it must be
> installed and on your `PATH`. The VS Code extension has no clone option — use
> option C there.

#### Option A — Fetch in Bruno (recommended)

[<img src="https://fetch.usebruno.com/button.svg" alt="Fetch in Bruno" width="128" height="32">](https://fetch.usebruno.com?url=https://github.com/spacelift-io/spacelift-api-bruno.git "target=_blank rel=noopener noreferrer")

Click the button, choose **Open In Bruno**, and pick where to keep the clone. Bruno lists
the collections it found in the repository — select **Spacelift** and open it.

You get a git checkout, so `git pull` brings down new requests later.

#### Option B — Import from inside Bruno

The same thing, without the button:

1. In the Bruno desktop app, open **Import Collection** (the **+** menu in the sidebar) and pick the **Git Repository** tab.
2. Paste `https://github.com/spacelift-io/spacelift-api-bruno.git` and click **Clone**.
3. Choose a location to clone into, optionally pick a branch, and click **Clone**.
4. Bruno scans the clone and lists the collections it finds. Select **Spacelift** and click **Open**.

The collection lives in the `Spacelift/` subfolder rather than at the repository root; Bruno's clone scans the whole repository, so it finds it either way.

#### Option C — Clone yourself and open the folder

```bash
git clone https://github.com/spacelift-io/spacelift-api-bruno.git
```

Then in Bruno click **Open Collection** and select the `Spacelift/` folder.

### 2. Configure Your Environment

The collection ships with an environment called `my-account`, already selected in the
environment dropdown at the top right. Nothing to copy or create — open it (gear icon →
Environments → my-account) and fill in three values:

| Variable                   | Description                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `SPACELIFT_ENDPOINT`       | Your account's GraphQL endpoint, e.g. `https://myaccount.app.spacelift.io/graphql` |
| `SPACELIFT_API_KEY_ID`     | The ID of your API key (shown after creation)                                      |
| `SPACELIFT_API_KEY_SECRET` | The secret for your API key (shown only once at creation)                          |

Leave `jwt` alone — the collection mints and refreshes it for you.

`SPACELIFT_API_KEY_SECRET` and `jwt` are **secret variables**. Bruno keeps their values in
its own encrypted store and writes only their names into `my-account.bru`, so the file
stays safe to commit and your credentials never reach git.

Working with more than one Spacelift account? Duplicate the environment and name the copies
after your accounts. Only `my-account` is tracked in git; anything else you add is ignored.

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

These run start to finish without copying an ID between requests. Each list request
stores the first result's ID in a variable that the next request already uses, so you
just send them in order.

**Trigger and confirm a run:**

1. **Stacks → List Stacks** — stores `{{stackId}}`
2. **Runs → Trigger Run** — uses `{{stackId}}`, stores `{{runId}}`
3. **Runs → Confirm Run** — uses both

**Attach a policy to a stack:**

1. **Policies → List Policies** — stores `{{policyId}}`
2. **Stacks → List Stacks** — stores `{{stackId}}`
3. **Policies → Attach Policy** — uses both

**Add an environment variable to a context:**

1. **Contexts → List Contexts** — stores `{{contextId}}`
2. **Contexts → Add Config** — uses `{{contextId}}`; set `config.type` to `ENVIRONMENT_VARIABLE`

Working on a specific resource rather than the first one in the list? Replace the
variable in the **Variables** panel with the ID you want. The chaining is a default,
not a constraint.

## Placeholder Values

Outside those workflows, requests that need an ID use an obvious placeholder like
`STACK_ID_HERE`. Replace it in the **Variables** panel before sending.

## Destructive Requests

Requests that delete, revoke, reset or yank something don't carry a placeholder. They
ask:

```
"id": "{{?Stack ID}}"
```

Bruno opens a dialog for each of these when you hit send, and canceling the dialog
cancels the request — so you can't destroy anything by opening a request and sending it
out of curiosity.

This also means Bruno's collection runner and the CLI **skip** these requests entirely,
since neither can show a prompt.

That is a helpful safety net rather than a guarantee, though: a handful of destructive
operations take no ID at all, so they have nothing to prompt for and a bulk run would
send them. Don't run the whole collection against an account you care about.

## Collection Structure

The collection covers all Spacelift API endpoints, organized into folders by resource type.

## What's Changed

[CHANGELOG.md](./CHANGELOG.md) lists every request added, corrected, deprecated or removed, one line each. The newest entries also show up in Bruno itself — open the collection's **Docs** pane — so you can see what moved without leaving the app.

## Contributing

For information about how to contribute, please see our [CONTRIBUTING.md](./CONTRIBUTING.md) file.

## License

This repository is licensed under the [MIT License](./LICENSE).
