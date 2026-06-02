/**
 * Side effects an Article transition can request after a successful save.
 *
 * Each variant is a typed instruction; the dispatcher translates it to the
 * underlying transport (SQS for commands, EventBridge for facts). The
 * orchestrator fires effects only after the store accepts the new aggregate,
 * so a handler can't return success without persisting AND dispatching.
 */
export type Effect =
	| { kind: "generate-summary"; url: string }
	| { kind: "dispatch-generate-summary-retry"; url: string; attempt: number }
	| {
			kind: "dispatch-submit-link";
			url: string;
			userId?: string;
			rawHtml?: string;
	  }
	| {
			kind: "publish-crawl-article-failed";
			url: string;
			reason: string;
			receiveCount: number;
	  }
	| { kind: "publish-recrawl-completed"; url: string }
	| { kind: "publish-crawl-article-completed"; url: string }
	| { kind: "publish-canonical-content-changed"; url: string }
	| { kind: "publish-link-saved"; url: string; userId: string }
	| { kind: "publish-anonymous-link-saved"; url: string }
	| {
			kind: "publish-summary-generated";
			url: string;
			inputTokens: number;
			outputTokens: number;
	  }
	| {
			kind: "publish-summary-generation-failed";
			url: string;
			reason: string;
			receiveCount: number;
	  }
	| {
			kind: "publish-reader-view-loading-succeeded";
			url: string;
			succeededAt: string;
			hasSummary: boolean;
	  };
