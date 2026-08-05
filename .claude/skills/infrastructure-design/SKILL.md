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
| Async worker (Command or Event handler) | `HutchSQSBackedLambda` — pairs a `HutchLambda` with a `HutchSQS` |
| A dead-letter queue shared by several source queues | `HutchSharedDlq` — owns the queue and its single SNS alarm + email subscription; pass it as `sharedDlq` to each `HutchSQS` |
| Failure-state transition driven by DLQ exhaustion | `HutchDLQEventHandler` — Lambda fed by a `deadLetterQueueArn` |

Whichever component owns the DLQ owns its alarm: a `HutchSQS` that mints its own DLQ gets its alarm from `HutchSQSBackedLambda`, and one that takes a `sharedDlq` gets it from `HutchSharedDlq`. A shared DLQ needs one consumer that routes each dead letter back to the failure handler for the queue it came from — `initDeadLetterRouter` from `@packages/dead-letter-routing`.

**Why:** Naked Lambdas drop messages on transient failure and leave no observable trail. The reusable components wire the redrive policy + CloudWatch alarm + SNS email subscription as a single unit, so DLQ arrivals always page the operator.

**Why share a DLQ:** an event source mapping costs ~$5/yr per account before it processes anything (an idle SQS poller issues ~360 empty receives an hour), so a fleet of always-idle per-queue DLQ consumers is pure overhead. Sharing keeps the terminalisation and collapses the pollers.

**How to apply:** Never instantiate `aws.lambda.Function` directly outside the `hutch-infra-components` package — `grep` for it before writing new infra code. Always pair a new `HutchLambda` with `HutchSQSBackedLambda`. When the work source is EventBridge, follow with `eventBus.subscribe(EventOrCommand, lambdaWithSQS)`.

**Allowed exception:** a synchronous request/response Lambda fronted by API Gateway. API Gateway is the queue analogue and 5xx surfaces the failure to the client. Document any new exception inline with a `Why:` comment in the infra file that creates it.

## Presence Is the Condition — No Boolean Beside a Value

When a property answers "does X exist here?", carry X itself (`T | undefined`) and let its presence be the answer; do not add a `boolean` the reader must pair with separate fields. Introducing any new `boolean` field or input in infrastructure components requires explicit human approval.

```typescript
// BAD - flag + fields nothing ties together; an alarm on the wrong queue still compiles
public readonly ownsDlq: boolean;
if (queue.ownsDlq) {
	dimensions: { QueueName: queue.dlqName },  // dlqName may be the shared DLQ
}

// GOOD - the branch narrows to the only value it may use
public readonly ownDlq: DeadLetterQueue | undefined;
const ownDlq = queue.ownDlq;
if (ownDlq) {
	dimensions: { QueueName: ownDlq.name },
}
```

**Why:** a boolean standing in for a value discards the value, so the branch reaches for other fields the flag does not govern — coupling the compiler cannot check (connascence of name is all that holds them together). Carrying the value makes the wrong read non-representable: inside the branch, the only DLQ in scope is the one the flag used to merely promise.

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

## Don't StackReference a Value You Could Put in Config

A consumer that reads a producer stack's output with `StackReference.requireOutput` couples their deploy order, but the CI deploy matrix (`ci.yml`) deploys every project stack **in parallel with no producer→consumer ordering**. The first deploy after a new output is introduced therefore fails with `Required output 'X' does not exist on stack '...'`.

**Why:** `StackReference` reads the producer's **last-persisted checkpoint**, not its in-flight deploy. When a new output and its consumer land together — often squashed through a merge train that cancels the producer's own deploy — the consumer reads a checkpoint that predates the output and `requireOutput` throws. Already-persisted outputs from the same reference keep resolving, so only the brand-new value fails. This broke `blog-site`/`web-embed` (reading hutch `sessionsTableName`/`sessionsTableArn`) and `hutch` (reading save-link `contentMediaCdnBaseUrl`).

**How to avoid, in order of preference:**
1. **If the value is a config constant, read the same config in both stacks instead of cross-referencing it.** A CDN base URL is `https://${config.require("contentMediaCdnDomain")}` — known before either stack deploys — so deriving it in the consumer deletes the edge and deploy order stops mattering. This is how hutch already wires the shared content *bucket* via `contentBucketName` config rather than a StackReference.
2. **If the value is only known at deploy time and must exist before another project deploys, put the producing resource in the `platform` stack.** `deploy-platform` runs before the project matrix (`ci.yml` `needs: [..., deploy-platform]`) precisely so anything every project depends on is already persisted — that is what the platform stack is for.
3. **Only keep a project→project `StackReference` for a genuinely deploy-time value owned by one specific project, and then enforce the order explicitly** (a CI `needs:` edge) — never rely on the parallel matrix.

**Red flag in review:** a `requireOutput` whose value is a domain, bucket name, or any string you could write in `Pulumi.<env>.yaml`. If it can live in config, it belongs in config — not in a cross-stack read.

## What Belongs in the `platform` Stack

**The test: more than one project stack needs the resource to already exist.**

Ownership follows dependency, not origin. A resource written first in `hutch` because that is where the feature started still belongs in `platform` once a second project depends on it — "hutch happens to own it" is not an architecture.

`deploy-platform` runs before the project matrix, so anything `platform` creates is persisted before any consumer deploys. Inspect `projects/platform/src/infra/index.ts` for what it owns today and `.github/workflows/ci.yml` for the ordering.

| Signal | Belongs in `platform` |
|---|---|
| Two or more project stacks `requireOutput` it | Yes — see the StackReference section above |
| Every project gets one implicitly (observability, event bus, registries) | Yes |
| Its name is a fixed string all projects hardcode or derive | Yes — the shared constant is already admitting it is not project-owned |
| One project owns it and one other reads a deploy-time value | Keep it, and add an explicit CI `needs:` edge |
| The value is knowable before any deploy | Neither — put it in config (preferred over both) |

**Two limits to state accurately rather than assume:**

- `deploy-platform` is conditional on `platform-affected`, and the matrix gate tolerates a *skip* (it only blocks on `failure`). "Platform deploys first" is a guarantee about failure, not about a run where platform is unaffected.
- `platform` is infra-only — its `test` script is a no-op and `check` runs lint. **Logic with tests cannot live there.** Put the logic in a coverage-enforced workspace package and let `platform` hold only the wiring. This is why moving a tested module into `platform` is never a one-file change.

**Uplifting an existing resource is not a code move.** Pulumi state has to hand over: `pulumi state delete` from the old stack, `pulumi import` into `platform`, one resource at a time, staging before prod, with both previews reading zero diff before the code merges. Do it out of band and **before** the code lands — never with the `import:` resource option, which hard-fails a fresh environment on the one stack everything else is gated behind. Because `deploy-platform` gates the whole matrix, a botched handover blocks every project's deploy, not just its own.

## Fleet-Wide Observability Cannot Enumerate Its Sources

A dashboard widget that lists the log groups it reads silently stops covering the fleet. Two hard limits force this, both verified against a live account rather than documentation:

| Limit | Value | Consequence |
|---|---|---|
| Log groups per Logs Insights query | 50 | An account with more Lambdas than this cannot be covered by an enumerating widget at all |
| Subscription filters per log group | 2 | One combined filter per group; a second consumer later has nowhere to go |
| `logGroups(namePrefix:)` in a dashboard widget | rejected | Works for the start-query API only — the renderer errors on it |

**So funnel instead of enumerate:** every source group forwards into one destination group, and the widget reads that. Coverage then follows from creating a Lambda rather than from remembering to register one — `HutchLambda` attaches the filter itself.

Two failure modes this arrangement introduces, both of which reached production before being caught:

- **The filter and the classifier are two halves of one decision.** A stream the classifier routes but the filter never delivers is dead code that looks alive. Assert that every line the classifier claims is a line the filter matches.
- **Membership of the destination group *is* the classification.** Re-filtering in the widget applies per-source logic to an already-classified stream, where it can only subtract. A Lambda's `ERROR` tag lives in the log preamble, which is stripped before forwarding, so the obvious re-filter matches nothing.

**Verify a dashboard query against real data, never against its own string.** A test asserting a query *contains* a clause cannot tell you the clause matches anything. Use `aws logs test-metric-filter` for filter patterns and `aws logs start-query` for widget queries — both caught bugs here that a green test suite did not.

## Never `pulumi up` From a Developer Machine

`.envrc` supplies placeholder values for secrets that only CI holds — inspect it for which. A local `pulumi up` therefore writes those placeholders over the deployed values, and the preview shows it as ordinary drift among real changes.

**Why it is worth a rule:** the damage is silent and not a deploy failure. Overwriting an analytics salt re-keys every visitor hash, so returning visitors read as new and any configured hash exclusion list stops matching — a data-quality bug with no error anywhere.

`pulumi preview`, `pulumi state`, and `pulumi import` are safe: they never push config. Only `up` does. CI holds the real secrets; CI deploys.

## Wire-Format Values Are Deployment Contracts

The `source` and `detailType` strings in event definitions are stored in deployed EventBridge rules. Renaming them requires coordinated redeployment of all stacks that publish or subscribe. Change TypeScript identifiers freely, but treat wire values as immutable unless you coordinate the deployment.
