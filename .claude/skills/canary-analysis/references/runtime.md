# Runtime controls

Read at startup/resume and whenever telemetry or a role handoff becomes uncertain. This reference describes supported discovery, not tools guaranteed callable in this session.

## Ask and choose a stop rule

Use Claude's native `AskUserQuestion`, or an available Codex `request_user_input` / `request_user_input_async` facility. If no native Ask tool is callable, ask a direct question and **wait for the answer**. Do not fabricate a tool or treat silence as approval.

Ask for the finite ending criterion and, when quota-based, the actual quota bucket(s) and whether the threshold means remaining or used. Confirm semantics in the ledger: 25% remaining equals 75% used. For multiple selected criteria, stop when **any** fires. Establish deadline timezone or duration start; use the main skill's completed-category definition for count limits. No-actionable-categories is also an ending criterion. Do not impose an unrequested default quota limit.

Apply the main skill's stop-latch and already-selected-hypothesis policy. A quota reset does not authorize clearing the latch, starting another run, or switching models.

## Authoritative quota evidence

This section applies **only when the agreed ending trigger includes a quota threshold**. For deadline, category-count or no-actionable rules alone, do not require quota telemetry or impose a quota threshold. Discover accessible supported **read-only** runtime telemetry and its freshness before relying on it:

- Codex documents app-server `account/rateLimits/read` in the [official app-server documentation](https://learn.chatgpt.com/docs/app-server). Discover which account/model buckets the actual response describes and the meaning of its fields. Documentation of an endpoint does not make it a callable session tool.
- Claude documents usage and status-line context in the [official status-line documentation](https://code.claude.com/docs/en/statusline). Use supported usage information actually accessible in the running environment; do not assume every session exposes quota fields.

Prefer a status-line recorder when the machine has one: a status-line command that saves each session's `rate_limits` to a per-session file, and to the active run directory named by a `CURRENT` file beside the run ledgers. Read **your own session's** reading. Sessions on one machine can belong to different accounts, so the newest reading from any session can describe the wrong account. Treat a reading older than five minutes as stale. With no recorder, ask the user for a timestamped reading. Do not install helpers or change global settings unless the user asks. Do not reset quota, switch models without authorization, or hardcode reset times, model IDs or window durations. Context tokens and estimated spend are not account quota. Do not infer a remaining percentage from them.

Record bucket identity, used/remaining semantics, value, observation time, source and freshness. Validate that the source covers the selected bucket(s). Check before costly reasoning, agents, implementation, checks or deployment/verification phases and between categories. A user reading is manual and timestamped: request a new reading at the next required checkpoint, rather than silently reusing it. If an observation is missing, stale or unreliable, ask and pause immediately, even midcategory. Persist verification, deployment, rollback and refresh obligations so another session can resume safely. Never guess a metric.

## Model and role handoffs

Discover actual supported model IDs and available delegation/switch facilities from the active runtime. Labels below describe roles, not guaranteed API identifiers:

| Role | Claude | Codex |
|---|---|---|
| Per-category reasoning, RCA, acceptance design, verification judgment | Prefer Fable, default effort; Opus Max already authorized when Fable is unavailable | Astra |
| Code, tests, fixes and reverts | Opus 5.5, medium effort | Sol |

Both Claude reasoning options above are authorized by this skill; using the allowed alternative needs no repeat approval. Respect any narrower user selection. If no authorized model or required handoff facility is available, ask and wait; no silent fallback. An authorized alternative is not permission to bypass a stop latch or an applicable quota pause.

Each handoff includes the goal and category, stored reasons and traced path, observations and ruled-out hypotheses, frozen cohort/acceptance criteria, minimal implementation scope, ledger location, current commits/deployment, stop rule (and last quota observation only if applicable), pending verification/rollback, and the obligation to check triggers at the main skill's phase, hypothesis-selection and tool/evidence-batch boundaries. Keep sensitive evidence local. The reasoning role owns causal and acceptance judgments; the implementation role follows the evidenced brief. The parent owns full checks and hook-firing commits, one heavy check at a time after checking runner/process availability. Delegates may isolate a test failure already identified by that check, never run a full check or fire the commit hook.
