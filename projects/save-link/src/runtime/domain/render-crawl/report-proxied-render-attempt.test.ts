import { noopLogger } from "@packages/logger";
import { SaveAttemptIdSchema } from "@packages/domain/article";
import type { RenderOutcome } from "../../providers/render-page/render-page.types";
import { initReportProxiedRenderAttempt, type ProxiedRenderLeg, type RenderRequestDiagnostics } from "./report-proxied-render-attempt";

const saveAttemptId = SaveAttemptIdSchema.parse("attempt-1");

const proxiedFailure: RenderOutcome = {
	kind: "failed",
	detail: "net::ERR_TIMED_OUT",
	requests: {
		proxiedRequestLimit: 40,
		continued: 3,
		continuedProxied: 3,
		continuedDirect: 0,
		continuedNavigations: 1,
		abortedByBudget: 5,
		abortedByType: 4,
		abortedBy: { type: 4, address: 0, budget: 5 },
		continuedByResourceType: { document: 1, script: 2 },
	},
	resourceHosts: {
		initialSite: "example-news.test",
		finalSite: "example-news.test",
		buckets: [
			{ documentSite: "example-news.test", requestHost: "www.example-news.test", resourceType: "document", navigation: true, route: "proxy", requests: 1, response2xx: 1, responseOther: 0, failed: 0 },
			{ documentSite: "example-news.test", requestHost: "cdn.analytics-vendor.test", resourceType: "script", navigation: false, route: "aborted-budget", requests: 5, response2xx: 0, responseOther: 0, failed: 0 },
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
	const summary = (renderedThrough: ProxiedRenderLeg) => [
		"[RenderCrawlCommand] render attempt summary",
		{
			stream: "render-attempt-summary",
			attemptId: "render-attempt-7",
			saveAttemptId: "attempt-1",
			renderedThrough,
			proxiedRequestLimit: 40,
			outcome: "failed",
			readability: "unreadable",
			documentSite: "example-news.test",
			finalSite: "example-news.test",
			continued: 3,
			continuedProxied: 3,
			continuedDirect: 0,
			continuedNavigations: 1,
			abortedBy: { type: 4, address: 0, budget: 5 },
			resourceHostBuckets: 2,
			resourceHostsOverflowed: 2,
		},
	];

	it.each<ProxiedRenderLeg>(["residential-per-gb", "web-unlocker-render"])("logs one host row per bucket, then the attempt summary, under one render-attempt id, all naming the %s leg", (renderedThrough) => {
		const { info, report } = reporterLogging("hosts");

		report({ outcome: proxiedFailure, readability: "unreadable", saveAttemptId, renderedThrough });

		expect(info.mock.calls).toEqual([
			[
				"[RenderCrawlCommand] render resource hosts",
				{ stream: "render-resource-hosts", attemptId: "render-attempt-7", renderedThrough, documentSite: "example-news.test", requestHost: "www.example-news.test", resourceType: "document", navigation: true, route: "proxy", requests: 1, response2xx: 1, responseOther: 0, failed: 0 },
			],
			[
				"[RenderCrawlCommand] render resource hosts",
				{ stream: "render-resource-hosts", attemptId: "render-attempt-7", renderedThrough, documentSite: "example-news.test", requestHost: "cdn.analytics-vendor.test", resourceType: "script", navigation: false, route: "aborted-budget", requests: 5, response2xx: 0, responseOther: 0, failed: 0 },
			],
			summary(renderedThrough),
		]);
	});

	it("logs only the attempt summary when host diagnostics are off", () => {
		const { info, report } = reporterLogging("off");

		report({ outcome: proxiedFailure, readability: "unreadable", saveAttemptId, renderedThrough: "web-unlocker-render" });

		expect(info.mock.calls).toEqual([summary("web-unlocker-render")]);
	});
});
