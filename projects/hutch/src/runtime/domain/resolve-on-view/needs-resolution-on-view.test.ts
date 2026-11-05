import { ANONYMOUS_VIEWER, type GeneratedSummary, type ShownSummary, shownSummary } from "@packages/domain/article";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import { needsResolutionOnView } from "./needs-resolution-on-view";

const URL = "https://example.com/post";

function shown(summary: GeneratedSummary): ShownSummary | undefined {
	return shownSummary({ url: URL, summary, viewer: ANONYMOUS_VIEWER, ownerUserId: undefined });
}

function failed(reason: unknown): ArticleCrawl {
	return { status: "failed", reason: JSON.stringify(reason), outcomeRevision: 1 };
}

function unsupported(reason: unknown): ArticleCrawl {
	return { status: "unsupported", reason: JSON.stringify(reason) };
}

describe("needsResolutionOnView", () => {
	it("asks nothing for a webmail url, whatever its row says", () => {
		expect(
			needsResolutionOnView({
				url: "https://mail.google.com/mail/u/0/",
				crawl: unsupported({ kind: "awaiting-reader", deferredLeg: "comprehensive" }),
				summary: undefined,
				viewerCanCapture: false,
			}),
		).toBe("none");
	});

	it.each([
		{ name: "not-found", crawl: failed({ kind: "not-found", httpStatus: 404 }) },
		{ name: "blocked by robots", crawl: failed({ kind: "blocked", cause: "robots" }) },
		{ name: "content-too-large", crawl: unsupported({ kind: "content-too-large", bytes: 99_000_000 }) },
	])("asks nothing for a $name row", ({ crawl }) => {
		expect(needsResolutionOnView({ url: URL, crawl, summary: undefined, viewerCanCapture: false })).toBe("none");
	});

	it.each(["edge-block", "rate-limited"])("hands a %s row to a capture-capable viewer's device first", (cause) => {
		expect(
			needsResolutionOnView({ url: URL, crawl: failed({ kind: "blocked", cause }), summary: undefined, viewerCanCapture: true }),
		).toBe("device-first");
	});

	it.each(["edge-block", "rate-limited"])("runs the paid legs for a %s row a viewer cannot capture", (cause) => {
		expect(
			needsResolutionOnView({ url: URL, crawl: failed({ kind: "blocked", cause }), summary: undefined, viewerCanCapture: false }),
		).toBe("crawl-and-summary");
	});

	it.each([
		{ name: "spend-capped", reason: { kind: "blocked", cause: "spend-capped" } },
		{ name: "capture-unreadable", reason: { kind: "capture-unreadable", detail: "blank" } },
		{ name: "fetch-failed", reason: { kind: "fetch-failed", httpStatus: 500 } },
		{ name: "parse-error", reason: { kind: "parse-error", detail: "bad" } },
		{ name: "exhausted-retries", reason: { kind: "exhausted-retries", receiveCount: 3 } },
		{ name: "origin-unreachable", reason: { kind: "origin-unreachable", code: "ECONNREFUSED" } },
	])("resolves crawl and summary for a $name failure even for a capture-capable viewer", ({ reason }) => {
		expect(needsResolutionOnView({ url: URL, crawl: failed(reason), summary: undefined, viewerCanCapture: true })).toBe(
			"crawl-and-summary",
		);
	});

	it("resolves crawl and summary for a failure whose legacy reason no longer parses", () => {
		expect(
			needsResolutionOnView({
				url: URL,
				crawl: { status: "failed", reason: "legacy text", outcomeRevision: 1 },
				summary: undefined,
				viewerCanCapture: true,
			}),
		).toBe("crawl-and-summary");
	});

	it.each([
		{ name: "awaiting-reader", crawl: unsupported({ kind: "awaiting-reader", deferredLeg: "render-residential-per-gb" }) },
		{ name: "paywall", crawl: unsupported({ kind: "paywall" }) },
		{ name: "javascript-required", crawl: unsupported({ kind: "javascript-required" }) },
		{ name: "legacy content-type", crawl: { status: "unsupported" as const, reason: "application/zip" } },
	])("resolves crawl and summary for an unsupported $name row", ({ crawl }) => {
		expect(needsResolutionOnView({ url: URL, crawl, summary: undefined, viewerCanCapture: false })).toBe(
			"crawl-and-summary",
		);
	});

	it.each([
		{ name: "failed", summary: shown({ status: "failed", reason: "boom" }) },
		{ name: "skipped awaiting-reader", summary: shown({ status: "skipped", reason: "awaiting-reader" }) },
		{ name: "skipped ai-unavailable", summary: shown({ status: "skipped", reason: "ai-unavailable" }) },
	])("resolves only the summary for a ready crawl whose summary is $name", ({ summary }) => {
		expect(needsResolutionOnView({ url: URL, crawl: { status: "ready" }, summary, viewerCanCapture: false })).toBe("summary");
	});

	it.each([
		{ name: "ready", summary: shown({ status: "ready", summary: "s" }) },
		{ name: "pending", summary: shown({ status: "pending" }) },
		{ name: "skipped content-too-short", summary: shown({ status: "skipped", reason: "content-too-short" }) },
		{ name: "skipped declined", summary: shown({ status: "skipped", reason: "declined" }) },
		{ name: "skipped crawl-failed", summary: shown({ status: "skipped", reason: "crawl-failed" }) },
		{ name: "skipped crawl-unsupported", summary: shown({ status: "skipped", reason: "crawl-unsupported" }) },
		{ name: "withheld from a non-owner", summary: shown({ status: "skipped" }) },
		{ name: "absent", summary: undefined },
	])("asks nothing for a ready crawl whose summary is $name", ({ summary }) => {
		expect(needsResolutionOnView({ url: URL, crawl: { status: "ready" }, summary, viewerCanCapture: false })).toBe("none");
	});

	it.each([
		{ name: "pending", crawl: { status: "pending" as const, startedAt: "2026-11-05T10:00:00.000Z" } },
		{ name: "absent", crawl: undefined },
	])("asks nothing for a $name crawl", ({ crawl }) => {
		expect(
			needsResolutionOnView({ url: URL, crawl, summary: shown({ status: "failed", reason: "boom" }), viewerCanCapture: false }),
		).toBe("none");
	});
});
