import type { SaveAttemptId } from "@packages/domain/article";
import type { HutchLogger } from "@packages/hutch-logger";
import type { RenderOutcome } from "../../providers/render-page/render-page.types";
import type { RenderedThrough } from "./render-ladder";

export type RenderRequestDiagnostics = "off" | "hosts";

export type ProxiedRenderLeg = Exclude<RenderedThrough, "direct-egress">;

export type RenderReadability = "readable" | "unreadable" | "unknown";

export type ReportProxiedRenderAttempt = (attempt: {
	outcome: RenderOutcome;
	readability: RenderReadability;
	saveAttemptId: SaveAttemptId;
	renderedThrough: ProxiedRenderLeg;
}) => void;

export function initReportProxiedRenderAttempt(deps: {
	logger: HutchLogger;
	diagnostics: RenderRequestDiagnostics;
	newRenderAttemptId: () => string;
}): ReportProxiedRenderAttempt {
	return ({ outcome, readability, saveAttemptId, renderedThrough }) => {
		const attemptId = deps.newRenderAttemptId();
		const { requests, resourceHosts } = outcome;
		if (deps.diagnostics === "hosts") {
			for (const bucket of resourceHosts.buckets) {
				deps.logger.info("[RenderCrawlCommand] render resource hosts", {
					stream: "render-resource-hosts",
					attemptId,
					policy: requests.policy,
					renderedThrough,
					...bucket,
				});
			}
		}
		deps.logger.info("[RenderCrawlCommand] render attempt summary", {
			stream: "render-attempt-summary",
			attemptId,
			saveAttemptId,
			policy: requests.policy,
			renderedThrough,
			proxiedRequestLimit: requests.proxiedRequestLimit,
			outcome: outcome.kind,
			readability,
			documentSite: resourceHosts.initialSite,
			finalSite: resourceHosts.finalSite,
			continued: requests.continued,
			continuedProxied: requests.continuedProxied,
			continuedDirect: requests.continuedDirect,
			continuedNavigations: requests.continuedNavigations,
			abortedBy: requests.abortedBy,
			resourceHostBuckets: resourceHosts.buckets.length,
			resourceHostsOverflowed: resourceHosts.overflowedRequests,
		});
	};
}
