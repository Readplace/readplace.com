---
name: infrastructure-design
description: Infrastructure Design
---

# Infrastructure Design

## Data-Driven Over Environment Conditionals

Infrastructure code must not branch on environment names (e.g., `if (stage === "production")`). Instead, express environment differences as configuration values in each environment's YAML file and read them with Pulumi's config API.

**Why:** Environment conditionals scatter knowledge about what differs between environments across the codebase. Config-driven infrastructure keeps that knowledge in the YAML files where it belongs — adding a new environment means adding a YAML file, not editing code.

## When to Use `require` vs `get`

| Method | Use when |
|--------|----------|
| `config.require` / `config.requireBoolean` | The value must be set in every environment |
| `config.getObject` / `config.get` | The value is optional and absence is meaningful (e.g., empty list = feature disabled) |

## No Full Table Scans in DynamoDB

DynamoDB `Scan` operations read every item in the table before applying filters. They are O(n) in table size regardless of result count and consume read capacity proportional to the total data scanned — not the data returned. A scan that returns zero items still reads every row.

**Severity:** High priority. A full table scan on a request path becomes a latency and cost bottleneck as the table grows and must be caught in code review.

**How to avoid:**
- Model access patterns at table design time so every query can use a `Query` on a partition key (table or GSI).
- When a new access pattern requires `begins_with` or equality on a non-key attribute, add a dedicated GSI with that attribute as the partition key. Write the GSI attribute on every item creation path.
- `Select: "COUNT"` does not help — it avoids data transfer but still reads every item.

## Every Lambda Must Be Backed by a Queue with DLQ

Every Lambda must be invoked through an SQS queue redriving to a DLQ. Use the reusable components from `@packages/hutch-infra-components/infra` — discover them with `grep -l "export class Hutch" src/packages/hutch-infra-components/src/infra/`.

| Use case | Component |
|---|---|
| Async worker (Command or Event handler) | `HutchSQSBackedLambda` — pairs a `HutchLambda` with a `HutchSQS` (queue + DLQ + SNS alarm + email subscription) |
| Failure-state transition driven by DLQ exhaustion | `HutchDLQEventHandler` — Lambda fed by an existing `HutchSQS.dlqArn` |

**Why:** Naked Lambdas drop messages on transient failure and leave no observable trail. The reusable components wire the redrive policy + CloudWatch alarm + SNS email subscription as a single unit, so DLQ arrivals always page the operator.

**How to apply:** Never instantiate `aws.lambda.Function` directly outside the `hutch-infra-components` package — `grep` for it before writing new infra code. Always pair a new `HutchLambda` with `HutchSQSBackedLambda`. When the work source is EventBridge, follow with `eventBus.subscribe(EventOrCommand, lambdaWithSQS)`.

**Allowed exception:** a synchronous request/response Lambda fronted by API Gateway. API Gateway is the queue analogue and 5xx surfaces the failure to the client. Document any new exception inline with a `Why:` comment in the infra file that creates it.

## Command → System → Event(s) Pattern

Every non-trivial process must be modelled as **Command → System → Event(s)**, with events flowing over EventBridge. Commands and events are defined as global, shared types in the `@packages/hutch-infra-components` package via `defineEvent` / `defineCommand`. Discover the current catalogue with `grep -E "defineEvent|defineCommand" src/packages/hutch-infra-components/src/`.

| Concept | Naming | Dispatch |
|---|---|---|
| **Command** — preventable request to do work | imperative (`SaveLinkCommand`, `GenerateSummaryCommand`) | `eventBus.subscribe(Command, lambdaWithSQS)` for EventBridge-routed commands, or `initSqsCommandDispatcher(...)` for direct-SQS commands |
| **Event** — irreversible fact already in the past | past tense (`LinkSavedEvent`, `SummaryGeneratedEvent`, `CrawlArticleFailedEvent`) | `eventBus.subscribe(Event, lambdaWithSQS)` |

**Allowed transitions** (sender → receiver, across Lambda boundaries):

| From | To | Allowed? |
|---|---|---|
| Command | Event(s) | ✅ Required — every command handler must end by publishing at least one fact (`...Succeeded`, `...Failed`, `...Executed`, …). The event carries post-processed data the consumer cannot refuse. |
| Event | Command | ✅ Allowed — event handlers may dispatch follow-up commands. |
| Event | Event | ✅ Allowed — an event handler may publish a new event without dispatching a command in between. |
| Command | Command | ❌ Forbidden across Lambda boundaries. Inline in-process function calls within a single handler are fine. |

A single handler may publish **multiple events** in one invocation. One command, many facts is fine. One command directly dispatching another command across a Lambda boundary is not.

**Why:** Commands carry intent and may be rejected, retried, or short-circuited; events carry irreversible facts. Conflating the two erases the boundary that lets you reason about whether work *can* still fail. Routing facts through EventBridge gives independent consumers a single broadcast point and keeps wire formats grep-able from one package.

**How to apply:** Before touching code for a new async behaviour, write the chain in `Command → System → Event(s)` notation. If you cannot name the event(s) the command produces, the system is not yet decomposed correctly.

## Command/Event Changes Require an Architecture Snapshot

Any change that adds, removes, renames, or re-wires a `defineEvent` / `defineCommand` declaration, or alters how a Lambda subscribes to one, must land with a new snapshot under `.architecture/<commit-hash>/`. Read `.architecture/index.md` end-to-end and follow the snapshot-generation prompt at the bottom. The snapshot must:

1. Show the **complete current state** of every flow that touches the changed command(s) or event(s) — not just the diff.
2. **Visually highlight the new change** so a reader can see what shifted from the previous snapshot. Use a distinct `classDef` (e.g. `classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px;`) and apply `:::new` to the changed nodes/edges. Mention the highlight convention in the snapshot's Legend block.
3. Append a row to `.architecture/index.md` with the commit hash, date, branch, subject, and a flow-level (path-free) description.

**Why:** Wire-format changes are deployment contracts that propagate across producer and consumer stacks. The pinned snapshot becomes the historical record of how the system *used to* look so reviewers can reason about migration steps. Skipping the snapshot makes the next "why does this event exist?" archaeology session orders of magnitude more expensive.

**How to apply:** Treat the snapshot as part of the same PR as the wiring change — they belong together so the snapshot pins to the commit that introduced the change.

## Runtime Environment Must Match Infrastructure

When runtime code requires an environment variable, every link in the chain from source to runtime must be wired up. These concerns are spread across multiple files with no compile-time link — nothing enforces consistency automatically.

Two failure modes to guard against:

1. **Production-only `requireEnv`**: runtime code requires the variable only inside `if (persistence === "prod")`. Local dev takes the in-memory path and skips the call entirely, so the app works locally and tests pass. The missing variable only surfaces when the Lambda initialises in the deployed environment, crashing every request with a 500.
2. **Local env hides missing GitHub secret**: `pnpm check-infra` and `pulumi up` pass on your laptop because the variable is set in your shell, but the CI deploy job has no value for it because the GitHub secret was never created. `requireEnv` aborts Pulumi at the start of the deploy step with `AssertionError: Environment variable X is required but not set`.

Env vars come in two flavors. Each has a different chain from source to runtime. Trace an existing var of the same flavor end-to-end and replicate the pattern.

### Flavor A — Config-derived (AWS resource names)

For env vars that name a resource you provision in Pulumi (DynamoDB table, S3 bucket, EventBridge bus, etc.), the chain starts in the Pulumi config YAML files.

**Checklist when adding a `requireEnv` call for a config-derived variable:**
- [ ] Config value added to **every** environment YAML file (`Pulumi.prod.yaml`, `Pulumi.staging.yaml`, etc.)
- [ ] Config read in the infrastructure entry point and passed to the resource class
- [ ] Resource created in the infrastructure resource class
- [ ] IAM policy grants the deployed function access to the new resource's ARN
- [ ] Lambda `environment:` block sets the variable, pointing to `resource.name`
- [ ] Runtime composition root reads the variable via `requireEnv` and passes it to the provider

### Flavor B — External secret (API keys, OAuth client secrets, webhook tokens)

For env vars that carry an external credential with no AWS resource backing it (third-party API key, OAuth client secret, webhook signing secret, etc.), the chain starts in GitHub Actions secrets and flows through the reusable CI deploy workflow.

**Checklist when adding a `requireEnv` call for an external-secret variable:**
- [ ] **GitHub Actions secrets** — `gh secret list --env staging --repo <org>/<repo>` and `gh secret list --env prod --repo <org>/<repo>` both show the variable. Secret values must be set via the GitHub UI — they can't be set from `gh` without a PAT with `secrets:write`. If missing, tell the user explicitly before creating the commit.
- [ ] **CI deploy workflow `env:` block** — `.github/workflows/project-deployment.yaml` (or whichever reusable workflow deploys the project) forwards the secret into **both** `deploy-staging` and `deploy-prod` jobs: `VAR_NAME: ${{ secrets.VAR_NAME }}`. **This is the most commonly missed step** — the GitHub secret can exist and still not reach the job unless the workflow forwards it explicitly.
- [ ] Lambda `environment:` block in `projects/*/src/infra/index.ts` sets `VAR_NAME: requireEnv("VAR_NAME")` so the variable reaches the deployed runtime.
- [ ] Runtime composition root reads the variable via `requireEnv` and wires it into the provider.
- [ ] Local `.env` (gitignored, auto-sourced by `.envrc`) has the variable so local dev and `pnpm check-infra` work.

### Don't collide with existing env var names

Before introducing a new env var name, grep for existing use across `.github/workflows/`, `projects/*/src/infra/`, `projects/*/src/runtime/`, and `projects/*/scripts/`. The same name may already be claimed by another project — for example, the Chrome Web Store publishing workflow holds `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` unrelated to any app-side Google login. Namespace collisions fail silently in some layers and at CI-deploy time in others. Namespace new variables to avoid the trap: prefer `GOOGLE_LOGIN_CLIENT_ID` over `GOOGLE_CLIENT_ID` if the existing name is already claimed elsewhere.

## Moving a Domain Between Redirect and Primary Requires Two Deploys

ACM cert validation DNS records conflict when a domain moves between `redirectDomains` and `domains` in the same deploy because Pulumi creates before it deletes. Remove the domain from its old list first, deploy, then add it to the new list.

## Wire-Format Values Are Deployment Contracts

The `source` and `detailType` strings in event definitions are stored in deployed EventBridge rules. Renaming them requires coordinated redeployment of all stacks that publish or subscribe. Change TypeScript identifiers freely, but treat wire values as immutable unless you coordinate the deployment.
