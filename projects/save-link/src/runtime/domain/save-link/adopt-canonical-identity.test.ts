import { noopLogger } from "@packages/hutch-logger";
import type {
	AdoptArticleDestination,
	ReconcileStubMetadata,
} from "@packages/article-store";
import { noExtract, noRecovery, noTransform, skipCrawl, type SiteRules } from "@packages/site-rules";
import { adoptableTerminal, initAdoptCanonicalIdentity, initIsSiteRuleUrl } from "./adopt-canonical-identity";

const never = () => false;

describe("adoptableTerminal", () => {
	const base = {
		url: "https://site.com/page.html",
		finalUrl: "https://site.com/page",
		outcome: { kind: "finalized", wordCount: 400 } as const,
		isSiteRuleUrl: never,
	};
	const crawlFailed = { ...base, outcome: { kind: "crawl-failed" } as const };

	it("returns the terminal when every gate passes", () => {
		expect(adoptableTerminal(base)).toBe("https://site.com/page");
	});

	it("rejects an admin recrawl", () => {
		expect(adoptableTerminal({ ...base, recrawl: true })).toBeUndefined();
	});

	it("rejects a zero-word (bot-wall / JS-shell) finalize", () => {
		expect(adoptableTerminal({ ...base, outcome: { kind: "finalized", wordCount: 0 } })).toBeUndefined();
	});

	it("rejects when no redirect resolved a terminal", () => {
		expect(adoptableTerminal({ ...base, finalUrl: undefined })).toBeUndefined();
	});

	it("rejects when the terminal normalizes to the same identity (no real redirect)", () => {
		expect(
			adoptableTerminal({ ...base, url: "https://site.com/page", finalUrl: "https://site.com/page?utm_source=x" }),
		).toBeUndefined();
	});

	it("adopts a cross-host redirect (the fetch + display pins protect it)", () => {
		expect(adoptableTerminal({ ...base, finalUrl: "https://other.com/page" })).toBe("https://other.com/page");
	});

	it("rejects when the terminal is itself a site-rule URL (keeps its oembed treatment)", () => {
		expect(adoptableTerminal({ ...base, isSiteRuleUrl: () => true })).toBeUndefined();
	});

	it.each([
		["a Wayback timestamp redirect", "https://web.archive.org/web/20180630081250/https://site.com/page"],
		["an archive.today short id", "https://archive.ph/Ab1cD"],
		["a tweet intent wrapping another URL", "https://twitter.com/intent/tweet?url=https%3A%2F%2Fsite.com%2Fpage"],
		["an archive.today mirror capture", "https://archive.li/J7ewH"],
		["an archive.md capture", "https://archive.md/20261002094222/https://site.com/page"],
		["an archive.fo short id", "https://archive.fo/Ab1cD"],
		["an archive.vn short id", "https://archive.vn/Ab1cD"],
		["an alternate Wayback host", "https://wayback.archive.org/web/20180630081250/https://site.com/page"],
		["the Wayback timegate", "https://web.archive.org/web/https://site.com/page"],
	])("rejects %s as a terminal — the article is keyed on the original, never the wrapper", (_label, finalUrl) => {
		expect(adoptableTerminal({ ...base, finalUrl })).toBeUndefined();
		expect(adoptableTerminal({ ...crawlFailed, finalUrl })).toBeUndefined();
	});

	it("adopts a failed crawl's terminal — there is no content to weigh, only the redirect chain", () => {
		expect(adoptableTerminal(crawlFailed)).toBe("https://site.com/page");
	});

	it("rejects a failed crawl on an admin recrawl", () => {
		expect(adoptableTerminal({ ...crawlFailed, recrawl: true })).toBeUndefined();
	});

	it("rejects a failed crawl whose terminal normalizes to the same identity", () => {
		expect(
			adoptableTerminal({ ...crawlFailed, url: "https://site.com/page", finalUrl: "https://site.com/page?utm_source=x" }),
		).toBeUndefined();
	});

	it("rejects a failed crawl whose terminal is itself a site-rule URL", () => {
		expect(adoptableTerminal({ ...crawlFailed, isSiteRuleUrl: () => true })).toBeUndefined();
	});

	it.each([
		["a twitter.com identity fetched from x.com", "https://twitter.com/jack/status/20", "https://x.com/jack/status/20"],
		["an x.com identity whose terminal reads twitter.com", "https://x.com/jack/status/20", "https://twitter.com/jack/status/20"],
	])("finds no redirect in %s", (_label, url, finalUrl) => {
		expect(adoptableTerminal({ ...base, url, finalUrl })).toBeUndefined();
		expect(adoptableTerminal({ ...crawlFailed, url, finalUrl })).toBeUndefined();
	});

	it("still adopts a real redirect between a twitter.com subdomain and x.com", () => {
		expect(
			adoptableTerminal({ ...base, url: "https://mobile.twitter.com/jack/status/20", finalUrl: "https://x.com/jack/status/20" }),
		).toBe("https://x.com/jack/status/20");
	});

	it("still adopts a real redirect to another x.com page", () => {
		expect(
			adoptableTerminal({ ...base, url: "https://twitter.com/jack/status/20", finalUrl: "https://x.com/jack/status/21" }),
		).toBe("https://x.com/jack/status/21");
	});
});

describe("initAdoptCanonicalIdentity", () => {
	function build(outcome: "adopted" | "declined" = "adopted") {
		const adoptDestination = jest.fn<ReturnType<AdoptArticleDestination>, Parameters<AdoptArticleDestination>>().mockResolvedValue(outcome);
		const reconcileStubMetadata = jest.fn<ReturnType<ReconcileStubMetadata>, Parameters<ReconcileStubMetadata>>().mockResolvedValue(undefined);
		const logger = { ...noopLogger, warn: jest.fn() };
		const adopt = initAdoptCanonicalIdentity({ adoptDestination, reconcileStubMetadata, isSiteRuleUrl: never, now: () => new Date("2026-07-15T10:00:00.000Z"), logger });
		return { adopt, adoptDestination, reconcileStubMetadata, logger };
	}

	const input = { url: "https://site.com/page.html", finalUrl: "https://site.com/page", outcome: { kind: "finalized" as const, wordCount: 300 } };

	it("atomically adopts and reconciles metadata after an accepted destination claim", async () => {
		const harness = build();
		await harness.adopt(input);
		expect(harness.adoptDestination).toHaveBeenCalledWith({ articleUrl: input.url, destinationUrl: input.finalUrl, now: new Date("2026-07-15T10:00:00.000Z") });
		expect(harness.reconcileStubMetadata).toHaveBeenCalledWith({ articleUrl: input.url, displayUrl: input.finalUrl });
	});

	it("does not reconcile a destination rejected by the source pin transaction", async () => {
		const harness = build("declined");
		await harness.adopt(input);
		expect(harness.adoptDestination).toHaveBeenCalledWith({ articleUrl: input.url, destinationUrl: input.finalUrl, now: new Date("2026-07-15T10:00:00.000Z") });
		expect(harness.reconcileStubMetadata.mock.calls).toEqual([]);
	});

	it("does no storage work when a terminal is not adoptable", async () => {
		const harness = build();
		await harness.adopt({ ...input, recrawl: true });
		expect(harness.adoptDestination.mock.calls).toEqual([]);
	});

	it.each(["adoptDestination", "reconcileStubMetadata"] as const)("logs %s failures without stranding the crawl", async (operation) => {
		const harness = build();
		harness[operation].mockRejectedValue(new Error("storage unavailable"));
		await harness.adopt(input);
		expect(harness.logger.warn).toHaveBeenCalledWith("[adopt-canonical-identity] adoption failed", { url: input.url, error: "Error: storage unavailable" });
	});
});

describe("initIsSiteRuleUrl", () => {
	const matchHost = (host: string): SiteRules => ({
		matches: ({ hostname }) => hostname === host,
		onCrawl: skipCrawl,
		recoverContent: noRecovery,
		extract: noExtract,
		transform: noTransform,
	});

	it("returns true when a rule matches the URL", () => {
		const isSiteRuleUrl = initIsSiteRuleUrl([matchHost("x.com")]);
		expect(isSiteRuleUrl("https://x.com/user/status/1")).toBe(true);
	});

	it("classifies a URL on the host equivalent to the one the rule was written for", () => {
		expect(initIsSiteRuleUrl([matchHost("x.com")])("https://twitter.com/user/status/1")).toBe(true);
		expect(initIsSiteRuleUrl([matchHost("twitter.com")])("https://x.com/user/status/1")).toBe(true);
		expect(initIsSiteRuleUrl([matchHost("x.com")])("https://mobile.twitter.com/user/status/1")).toBe(false);
	});

	it("returns false when no rule matches", () => {
		const isSiteRuleUrl = initIsSiteRuleUrl([matchHost("x.com")]);
		expect(isSiteRuleUrl("https://site.com/page")).toBe(false);
	});

	it("returns false for a malformed URL", () => {
		const isSiteRuleUrl = initIsSiteRuleUrl([matchHost("x.com")]);
		expect(isSiteRuleUrl("not a url")).toBe(false);
	});

	it("treats a throwing rule as a non-match (fails open)", () => {
		const throwing: SiteRules = {
			matches: () => {
				throw new Error("boom");
			},
			onCrawl: skipCrawl,
			recoverContent: noRecovery,
			extract: noExtract,
			transform: noTransform,
		};
		const isSiteRuleUrl = initIsSiteRuleUrl([throwing]);
		expect(isSiteRuleUrl("https://site.com/page")).toBe(false);
	});
});
