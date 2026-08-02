import { noopLogger } from "@packages/hutch-logger";
import type { ClaimCanonicalAlias, SetArticleDisplayUrl } from "@packages/article-store";
import { noExtract, noTransform, skipCrawl, type SiteRules } from "@packages/site-rules";
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
});

describe("initAdoptCanonicalIdentity", () => {
	const noopSetDisplayUrl: SetArticleDisplayUrl = async () => {};

	function build(
		claimAlias: ClaimCanonicalAlias,
		opts: { isSiteRuleUrl?: (url: string) => boolean; setDisplayUrl?: SetArticleDisplayUrl } = {},
	) {
		const now = () => new Date("2026-07-15T10:00:00.000Z");
		return initAdoptCanonicalIdentity({
			claimAlias,
			setDisplayUrl: opts.setDisplayUrl ?? noopSetDisplayUrl,
			isSiteRuleUrl: opts.isSiteRuleUrl ?? never,
			now,
			logger: noopLogger,
		});
	}

	it("claims id(terminal) → url and records the destination as the display URL when the gates pass", async () => {
		const claimAlias = jest.fn<ReturnType<ClaimCanonicalAlias>, Parameters<ClaimCanonicalAlias>>(async () => "claimed");
		const setDisplayUrl = jest.fn<ReturnType<SetArticleDisplayUrl>, Parameters<SetArticleDisplayUrl>>(async () => {});
		const adopt = build(claimAlias, { setDisplayUrl });

		await adopt({
			url: "https://site.com/page.html",
			finalUrl: "https://site.com/page",
			outcome: { kind: "finalized", wordCount: 300 },
		});

		expect(claimAlias).toHaveBeenCalledWith({
			aliasUrl: "https://site.com/page",
			targetOriginalUrl: "https://site.com/page.html",
			now: new Date("2026-07-15T10:00:00.000Z"),
		});
		expect(setDisplayUrl).toHaveBeenCalledWith({
			articleUrl: "https://site.com/page.html",
			displayUrl: "https://site.com/page",
		});
	});

	it("does not claim or record a display URL when a gate rejects the terminal", async () => {
		const claimAlias = jest.fn<ReturnType<ClaimCanonicalAlias>, Parameters<ClaimCanonicalAlias>>(async () => "claimed");
		const setDisplayUrl = jest.fn<ReturnType<SetArticleDisplayUrl>, Parameters<SetArticleDisplayUrl>>(async () => {});
		const adopt = build(claimAlias, { setDisplayUrl });

		await adopt({
			url: "https://site.com/page.html",
			finalUrl: "https://site.com/page",
			outcome: { kind: "finalized", wordCount: 0 },
		});

		expect(claimAlias).not.toHaveBeenCalled();
		expect(setDisplayUrl).not.toHaveBeenCalled();
	});

	it("claims id(destination) → url and records it as the display URL when the crawl failed at the destination", async () => {
		const claimAlias = jest.fn<ReturnType<ClaimCanonicalAlias>, Parameters<ClaimCanonicalAlias>>(async () => "claimed");
		const setDisplayUrl = jest.fn<ReturnType<SetArticleDisplayUrl>, Parameters<SetArticleDisplayUrl>>(async () => {});
		const adopt = build(claimAlias, { setDisplayUrl });

		await adopt({
			url: "https://wrapper.example/link/188518",
			finalUrl: "https://dest.example/article",
			outcome: { kind: "crawl-failed" },
		});

		expect(claimAlias).toHaveBeenCalledWith({
			aliasUrl: "https://dest.example/article",
			targetOriginalUrl: "https://wrapper.example/link/188518",
			now: new Date("2026-07-15T10:00:00.000Z"),
		});
		expect(setDisplayUrl).toHaveBeenCalledWith({
			articleUrl: "https://wrapper.example/link/188518",
			displayUrl: "https://dest.example/article",
		});
	});

	it("still records the display URL when the alias is already occupied (fan-in origin)", async () => {
		const claimAlias = jest.fn<ReturnType<ClaimCanonicalAlias>, Parameters<ClaimCanonicalAlias>>(async () => "occupied");
		const setDisplayUrl = jest.fn<ReturnType<SetArticleDisplayUrl>, Parameters<SetArticleDisplayUrl>>(async () => {});
		const adopt = build(claimAlias, { setDisplayUrl });

		await expect(
			adopt({
				url: "https://site.com/page.html",
				finalUrl: "https://site.com/page",
				outcome: { kind: "finalized", wordCount: 300 },
			}),
		).resolves.toBeUndefined();
		expect(claimAlias).toHaveBeenCalled();
		expect(setDisplayUrl).toHaveBeenCalledWith({
			articleUrl: "https://site.com/page.html",
			displayUrl: "https://site.com/page",
		});
	});

	it("never throws when the alias write fails (crawl must not be stranded)", async () => {
		const claimAlias: ClaimCanonicalAlias = async () => {
			throw new Error("DDB unavailable");
		};
		const adopt = build(claimAlias);

		await expect(
			adopt({
				url: "https://site.com/page.html",
				finalUrl: "https://site.com/page",
				outcome: { kind: "finalized", wordCount: 300 },
			}),
		).resolves.toBeUndefined();
	});
});

describe("initIsSiteRuleUrl", () => {
	const matchHost = (host: string): SiteRules => ({
		matches: ({ hostname }) => hostname === host,
		onCrawl: skipCrawl,
		extract: noExtract,
		transform: noTransform,
	});

	it("returns true when a rule matches the URL", () => {
		const isSiteRuleUrl = initIsSiteRuleUrl([matchHost("x.com")]);
		expect(isSiteRuleUrl("https://x.com/user/status/1")).toBe(true);
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
			extract: noExtract,
			transform: noTransform,
		};
		const isSiteRuleUrl = initIsSiteRuleUrl([throwing]);
		expect(isSiteRuleUrl("https://site.com/page")).toBe(false);
	});
});
