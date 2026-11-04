import type { SaveAttemptId } from "@packages/domain/article";
import type { Logger } from "@packages/logger";
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
	logger: Logger;
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
					renderedThrough,
					...bucket,
				});
			}
		}
		deps.logger.info("[RenderCrawlCommand] render attempt summary", {
			stream: "render-attempt-summary",
			attemptId,
			saveAttemptId,
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
