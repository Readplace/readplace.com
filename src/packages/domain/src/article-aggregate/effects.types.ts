/**
 * Side effects an Article transition can request after a successful save.
 *
 * Each variant is a typed instruction; the dispatcher translates it to the
 * underlying transport (SQS for commands, EventBridge for facts). The
 * orchestrator fires effects only after the store accepts the new aggregate,
 * so a handler can't return success without persisting AND dispatching.
 */
export type Effect = { kind: "generate-summary"; url: string };
