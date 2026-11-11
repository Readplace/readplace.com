import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import type { GeneratedSummary } from "@packages/provider-contracts/article-summary";
import { type ContentState, contentStateOf } from "./content-state";

const ARTICLE_URL = "https://example.com/article";
const PENDING: ArticleCrawl = { status: "pending", startedAt: "2026-11-05T10:00:00.000Z" };
const FAILED: ArticleCrawl = { status: "failed", outcomeRevision: 1, reason: JSON.stringify({ kind: "parse-error", detail: "x" }) };
const UNSUPPORTED: ArticleCrawl = { status: "unsupported", reason: JSON.stringify({ kind: "awaiting-reader" }) };
const READY_SUMMARY: GeneratedSummary = { status: "ready", summary: "A summary." };
const PENDING_SUMMARY: GeneratedSummary = { status: "pending" };

describe("contentStateOf", () => {
	const cases: Array<[string, { url: string; crawl: ArticleCrawl | undefined; summary: GeneratedSummary | undefined }, ContentState]> = [
		["a ready crawl with its summary still pending", { url: ARTICLE_URL, crawl: { status: "ready" }, summary: PENDING_SUMMARY }, "available"],
		["a ready crawl with no summary yet", { url: ARTICLE_URL, crawl: { status: "ready" }, summary: undefined }, "available"],
		["a pending crawl", { url: ARTICLE_URL, crawl: PENDING, summary: undefined }, "processing"],
		["neither pipeline started", { url: ARTICLE_URL, crawl: undefined, summary: undefined }, "processing"],
		["a row from before the crawl state machine, with a summary", { url: ARTICLE_URL, crawl: undefined, summary: READY_SUMMARY }, "available"],
		["a row from before the crawl state machine, with its summary still pending", { url: ARTICLE_URL, crawl: undefined, summary: PENDING_SUMMARY }, "available"],
		["a failed crawl", { url: ARTICLE_URL, crawl: FAILED, summary: undefined }, "unavailable"],
		["an unsupported crawl", { url: ARTICLE_URL, crawl: UNSUPPORTED, summary: { status: "skipped", reason: "awaiting-reader" } }, "unavailable"],
		["a webmail page whose crawl reads ready", { url: "https://mail.google.com/mail/u/0/", crawl: { status: "ready" }, summary: READY_SUMMARY }, "unavailable"],
	];

	it.each(cases)("answers for %s", (_label, input, expected) => {
		expect(contentStateOf(input)).toBe(expected);
	});
});
