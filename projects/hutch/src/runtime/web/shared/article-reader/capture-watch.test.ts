import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import { MAX_CAPTURE_POLLS } from "@packages/web-shell";
import {
	type CaptureWatch,
	captureWatchQuery,
	NO_CAPTURE_WATCH,
	parseCaptureWatch,
	resolveCaptureWatch,
} from "./capture-watch";

function queryOf(watch: CaptureWatch): Record<string, string> {
	return Object.fromEntries(new URLSearchParams(captureWatchQuery(watch)));
}

describe("capture watch query", () => {
	it.each<CaptureWatch>([
		NO_CAPTURE_WATCH,
		{ kind: "started", noticeRevision: 0, trigger: "manual" },
		{ kind: "started", noticeRevision: 4, trigger: "automatic" },
		{ kind: "watching", since: 7, trigger: "manual" },
		{ kind: "watching", since: 7, trigger: "automatic" },
		{ kind: "device-gave-up", since: 7, trigger: "manual" },
		{ kind: "device-gave-up", since: 7, trigger: "automatic" },
	])("reads back a $kind watch from the query it writes", (watch) => {
		expect(parseCaptureWatch(queryOf(watch))).toEqual(watch);
	});

	it("writes nothing for no watch, so a page without a capture carries no trigger", () => {
		expect(captureWatchQuery(NO_CAPTURE_WATCH)).toBe("");
	});

	it("reads a tab's legacy capturing flag as a tapped watch from revision zero", () => {
		expect(parseCaptureWatch({ capturing: "1" })).toEqual({ kind: "watching", since: 0, trigger: "manual" });
	});

	it.each([
		{ captureTrigger: undefined, label: "no trigger" },
		{ captureTrigger: "auto", label: "an unknown trigger" },
		{ captureTrigger: ["automatic", "automatic"], label: "a repeated trigger" },
	])("reads $label as a tapped capture", ({ captureTrigger }) => {
		expect(parseCaptureWatch({ captureNotice: "2", captureTrigger })).toEqual({
			kind: "started",
			noticeRevision: 2,
			trigger: "manual",
		});
	});

	it.each([
		{ query: {}, label: "no capture parameters" },
		{ query: { captureTrigger: "automatic" }, label: "a trigger without a revision" },
		{ query: { captureSince: "" }, label: "an empty revision" },
		{ query: { captureSince: "-1" }, label: "a negative revision" },
		{ query: { captureNotice: "2.5" }, label: "a fractional revision" },
		{ query: { captureSince: ["1", "2"] }, label: "a repeated revision" },
		{ query: { capturing: "true" }, label: "a legacy flag that is not 1" },
	])("reads $label as no watch", ({ query }) => {
		expect(parseCaptureWatch(query)).toEqual(NO_CAPTURE_WATCH);
	});

	it("reads a give-up flag that is not 1 as a watch still in progress", () => {
		expect(parseCaptureWatch({ captureSince: "3", captureGaveUp: "yes" })).toEqual({
			kind: "watching",
			since: 3,
			trigger: "manual",
		});
	});
});

describe("resolving a capture watch against the stored crawl", () => {
	const FAILED: ArticleCrawl = {
		status: "failed",
		reason: JSON.stringify({ kind: "blocked", cause: "edge-block" }),
		outcomeRevision: 2,
	};

	it.each([
		{ when: "the device gave up", watch: { kind: "device-gave-up", since: 2, trigger: "manual" } as const, pollCount: 4 },
		{ when: "the budget is spent", watch: { kind: "watching", since: 2, trigger: "manual" } as const, pollCount: MAX_CAPTURE_POLLS },
	])("reports a tapped copy as missing when $when and nothing was judged", ({ watch, pollCount }) => {
		expect(resolveCaptureWatch({ watch, crawl: FAILED, pollCount })).toEqual({ kind: "missing" });
	});

	it.each([
		{ when: "the device gave up", watch: { kind: "device-gave-up", since: 2, trigger: "automatic" } as const, pollCount: 4 },
		{ when: "the budget is spent", watch: { kind: "watching", since: 2, trigger: "automatic" } as const, pollCount: MAX_CAPTURE_POLLS },
	])("ends an automatic capture with no notice of its own when $when, leaving the stored state to speak", ({ watch, pollCount }) => {
		expect(resolveCaptureWatch({ watch, crawl: FAILED, pollCount })).toEqual({ kind: "none" });
	});

	it.each(["manual", "automatic"] as const)("keeps a %s capture's trigger while copying", (trigger) => {
		expect(
			resolveCaptureWatch({ watch: { kind: "started", noticeRevision: 2, trigger }, crawl: FAILED, pollCount: 1 }),
		).toEqual({ kind: "copying", since: 2, trigger });
	});

	it.each(["manual", "automatic"] as const)("carries a %s capture's trigger over a row with no outcome yet", (trigger) => {
		expect(
			resolveCaptureWatch({
				watch: { kind: "started", noticeRevision: 1, trigger },
				crawl: { status: "pending" },
				pollCount: 1,
			}),
		).toEqual({ kind: "carry", watch: { kind: "watching", since: 1, trigger } });
	});
});
