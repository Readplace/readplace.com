import { noopLogger } from "@packages/hutch-logger";
import { SaveAttemptIdSchema } from "@packages/domain/article";
import type { RenderOutcome } from "../../providers/render-page/render-page.types";
import { initReportProxiedRenderAttempt, type RenderRequestDiagnostics } from "./report-proxied-render-attempt";

const saveAttemptId = SaveAttemptIdSchema.parse("attempt-1");

const proxiedFailure: RenderOutcome = {
	kind: "failed",
	detail: "net::ERR_TIMED_OUT",
	requests: {
		policy: "same-site-scripts",
		proxiedRequestLimit: 12,
		continued: 3,
		continuedProxied: 3,
		continuedDirect: 0,
		continuedNavigations: 1,
		abortedByBudget: 0,
		abortedByType: 9,
		abortedBy: { type: 4, address: 0, site: 5, budget: 0 },
		continuedByResourceType: { document: 1, script: 2 },
	},
	resourceHosts: {
		initialSite: "example-news.test",
		finalSite: "example-news.test",
		buckets: [
			{ documentSite: "example-news.test", requestHost: "www.example-news.test", resourceType: "document", navigation: true, route: "proxy", requests: 1, response2xx: 1, responseOther: 0, failed: 0 },
			{ documentSite: "example-news.test", requestHost: "cdn.analytics-vendor.test", resourceType: "script", navigation: false, route: "aborted-site", requests: 5, response2xx: 0, responseOther: 0, failed: 0 },
		],
		overflowedRequests: 2,
	},
};

function reporterLogging(diagnostics: RenderRequestDiagnostics) {
	const info = jest.fn();
	const report = initReportProxiedRenderAttempt({ logger: { ...noopLogger, info }, diagnostics, newRenderAttemptId: () => "render-attempt-7" });
	return { info, report };
}

describe("initReportProxiedRenderAttempt", () => {
	const summary = [
		"[RenderCrawlCommand] render attempt summary",
		{
			stream: "render-attempt-summary",
			attemptId: "render-attempt-7",
			saveAttemptId: "attempt-1",
			policy: "same-site-scripts",
			proxiedRequestLimit: 12,
			outcome: "failed",
			readability: "unreadable",
			documentSite: "example-news.test",
			finalSite: "example-news.test",
			continued: 3,
			continuedProxied: 3,
			continuedDirect: 0,
			continuedNavigations: 1,
			abortedBy: { type: 4, address: 0, site: 5, budget: 0 },
			resourceHostBuckets: 2,
			resourceHostsOverflowed: 2,
		},
	];

	it("logs one host row per bucket, then the attempt summary, under one render-attempt id", () => {
		const { info, report } = reporterLogging("hosts");

		report({ outcome: proxiedFailure, readability: "unreadable", saveAttemptId });

		expect(info.mock.calls).toEqual([
			[
				"[RenderCrawlCommand] render resource hosts",
				{ stream: "render-resource-hosts", attemptId: "render-attempt-7", policy: "same-site-scripts", documentSite: "example-news.test", requestHost: "www.example-news.test", resourceType: "document", navigation: true, route: "proxy", requests: 1, response2xx: 1, responseOther: 0, failed: 0 },
			],
			[
				"[RenderCrawlCommand] render resource hosts",
				{ stream: "render-resource-hosts", attemptId: "render-attempt-7", policy: "same-site-scripts", documentSite: "example-news.test", requestHost: "cdn.analytics-vendor.test", resourceType: "script", navigation: false, route: "aborted-site", requests: 5, response2xx: 0, responseOther: 0, failed: 0 },
			],
			summary,
		]);
	});

	it("logs only the attempt summary when host diagnostics are off", () => {
		const { info, report } = reporterLogging("off");

		report({ outcome: proxiedFailure, readability: "unreadable", saveAttemptId });

		expect(info.mock.calls).toEqual([summary]);
	});
});
