# Spacelift API Bruno Collection

A [Bruno](https://www.usebruno.com/) collection covering the Spacelift GraphQL API. Use it to explore, test, and script against your Spacelift account.

## Prerequisites

- [Bruno](https://www.usebruno.com/downloads) desktop app or the [Bruno VS Code extension](https://marketplace.visualstudio.com/items?itemName=bruno-api-client.bruno)
- A Spacelift account with an API key — [create one under **Settings → API Keys**](https://docs.spacelift.io/integrations/api#spacelift-api-key-token)

## Setup

### 1. Open the Collection

In Bruno, click **Open Collection** and select the `Spacelift/` folder from this repository.

### 2. Configure Your Environment

Copy the example environment file and fill in your credentials:

```bash
cp Spacelift/environments/local.bru.example Spacelift/environments/local.bru
```

Open the **local** environment in Bruno (gear icon → Environments → local) and fill in:

| Variable                   | Description                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `SPACELIFT_ENDPOINT`       | Your account's GraphQL endpoint, e.g. `https://myaccount.app.spacelift.io/graphql`      |
| `SPACELIFT_API_KEY_ID`     | The ID of your API key (shown after creation)                                           |
| `SPACELIFT_API_KEY_SECRET` | The secret for your API key (shown only once at creation) — stored as a secret variable |

Leave `jwt` blank — it is filled in automatically in the next step.

### 3. Get a Token

Run **Auth → Get Token**. Bruno will store the token and use it for all subsequent requests. Tokens expire after a few hours — just re-run this request if you start getting authentication errors.

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

The collection covers all non-deprecated Spacelift API endpoints, organized into folders by resource type.

## Contributing

For information about how to contribute, please see our [CONTRIBUTING.md](./CONTRIBUTING.md) file.

## License

This repository is licensed under the [MIT License](./LICENSE).
