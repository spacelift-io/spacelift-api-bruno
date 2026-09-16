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

Each request is one operation, so a task is usually two or three of them in order. The
list request shows you the IDs; copy the one you want into the next request's
**Variables** panel.

**Trigger and confirm a run:**

1. **Stacks → List Stacks** — copy the `id` of the stack you want
2. **Runs → Trigger Run** — paste it into `stack`; the response's `id` is the new run
3. **Runs → Confirm Run** — `stack` and `run` are those two IDs

**Attach a policy to a stack:**

1. **Policies → List Policies** — copy the policy's `id`
2. **Stacks → List Stacks** — copy the stack's `id`
3. **Policies → Attach Policy** — `id` is the policy, `stack` is the stack

**Add an environment variable to a context:**

1. **Contexts → List Contexts** — copy the context's `id`
2. **Contexts → Add Config** — paste it into `context`, and set `config.type` to
   `ENVIRONMENT_VARIABLE`

## Placeholder Values

Requests that need an ID use an obvious placeholder like `STACK_ID_HERE`. Replace it in
the **Variables** panel before sending. Each request's **Docs** pane says which request
lists the IDs it wants.

## Destructive Requests

Requests that delete, revoke, reset or yank something ask for the ID in a dialog when you
hit send, rather than carrying one in the request. Cancel the dialog and nothing is sent,
so you can't destroy anything by opening a request and hitting send out of curiosity.

Bruno's collection runner and the CLI **skip** these requests, since neither can show you
the dialog.

A dialog can't help when the request names nothing to delete, or when what it overwrites
is worse than what it removes. Those are in **Danger Zone**, at the bottom of the
sidebar:

- **Deletes that name nothing.** **Session Delete All** ends every session in the
  account; **Account Confirm Delete** finishes deleting the account. There is no ID to
  ask for.
- **Overwrites you cannot undo.** **Update GitLab Integration** replaces the host every
  GitLab stack builds from, **Slack App Config Set** replaces secrets Spacelift will not
  show you again, **Migrate Vendor For All Stacks** moves every stack to another vendor.
  Putting them back needs values you may no longer have.

The collection refuses all of them unless `CONFIRM_DESTRUCTIVE` in your environment holds
the exact name of the one you are sending:

```
CONFIRM_DESTRUCTIVE = Saml Delete
```

Arming one arms only that one, running the whole collection sends none of them, and
clearing the variable disarms everything. Read the folder's **Docs** pane first.

## Collection Structure

The collection covers all Spacelift API endpoints, organized into folders by resource type.

## What's Changed

[CHANGELOG.md](./CHANGELOG.md) lists every request added, corrected, deprecated or removed, one line each. The newest entries also show up in Bruno itself — open the collection's **Docs** pane — so you can see what moved without leaving the app.

## Contributing

For information about how to contribute, please see our [CONTRIBUTING.md](./CONTRIBUTING.md) file.

## License

This repository is licensed under the [MIT License](./LICENSE).
