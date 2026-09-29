import { matchingSiteRuleUrl } from "./matching-site-rule-url";
import { noExtract, noRecovery, noTransform, skipCrawl, type SiteRules } from "./site-rules";

function siteMatching(matches: SiteRules["matches"]): SiteRules {
	return { matches, onCrawl: skipCrawl, recoverContent: noRecovery, extract: noExtract, transform: noTransform };
}

const xOnly = siteMatching(({ url }) => /^https:\/\/x\.com\/[^/]+\/status\/\d+/.test(url));
const twitterOnly = siteMatching(({ hostname }) => hostname === "twitter.com");
const bothHosts = siteMatching(({ hostname }) => hostname === "x.com" || hostname === "twitter.com");

describe("matchingSiteRuleUrl", () => {
	it("hands an x.com-only rule the x.com spelling of a twitter.com URL", () => {
		expect(matchingSiteRuleUrl({ site: xOnly, url: "https://twitter.com/jack/status/20?s=20" })).toBe(
			"https://x.com/jack/status/20?s=20",
		);
	});

	it("hands a twitter.com-only rule the twitter.com spelling of an x.com URL", () => {
		expect(matchingSiteRuleUrl({ site: twitterOnly, url: "https://x.com/jack/status/20#top" })).toBe(
			"https://twitter.com/jack/status/20#top",
		);
	});

	it("prefers the x.com spelling when the rule accepts both hosts", () => {
		expect(matchingSiteRuleUrl({ site: bothHosts, url: "https://twitter.com/jack" })).toBe("https://x.com/jack");
		expect(matchingSiteRuleUrl({ site: bothHosts, url: "https://x.com/jack" })).toBe("https://x.com/jack");
	});

	it("keeps the rule's own path restriction on either host", () => {
		expect(matchingSiteRuleUrl({ site: xOnly, url: "https://twitter.com/jack" })).toBeUndefined();
		expect(matchingSiteRuleUrl({ site: xOnly, url: "https://x.com/jack/likes" })).toBeUndefined();
	});

	it("gives the rule the hostname of the URL it is asked about", () => {
		const seen: { url: string; hostname: string }[] = [];
		const recording = siteMatching((params) => {
			seen.push(params);
			return false;
		});

		matchingSiteRuleUrl({ site: recording, url: "https://twitter.com/jack" });

		expect(seen).toEqual([
			{ url: "https://x.com/jack", hostname: "x.com" },
			{ url: "https://twitter.com/jack", hostname: "twitter.com" },
		]);
	});

	it("asks about any other host exactly as given", () => {
		const exampleOnly = siteMatching(({ hostname }) => hostname === "example.org");

		expect(matchingSiteRuleUrl({ site: exampleOnly, url: "https://example.org/a?b=c" })).toBe("https://example.org/a?b=c");
		expect(matchingSiteRuleUrl({ site: exampleOnly, url: "https://mobile.twitter.com/jack" })).toBeUndefined();
		expect(matchingSiteRuleUrl({ site: twitterOnly, url: "https://mobile.twitter.com/jack" })).toBeUndefined();
	});

	it("matches nothing for an unparseable URL without asking the rule", () => {
		let asked = false;
		const site = siteMatching(() => {
			asked = true;
			return true;
		});

		expect(matchingSiteRuleUrl({ site, url: "not a url" })).toBeUndefined();
		expect(asked).toBe(false);
	});

	it("lets a throwing matcher's error reach the caller", () => {
		const throwing = siteMatching(() => {
			throw new Error("matcher broke");
		});

		expect(() => matchingSiteRuleUrl({ site: throwing, url: "https://x.com/jack" })).toThrow("matcher broke");
	});
});
