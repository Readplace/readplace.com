import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EXCLUDE_PATTERNS, isExcluded } from "./exclude-patterns";

describe("isExcluded", () => {
	it("returns false when no patterns are configured", () => {
		assert.equal(isExcluded("https://example.test/a", []), false);
	});

	it("returns true when any configured pattern matches the URL", () => {
		const patterns = [/:\/\/internal\.test/];
		assert.equal(isExcluded("https://internal.test/a", patterns), true);
		assert.equal(isExcluded("https://other.test/a", patterns), false);
	});

	it("returns true when at least one of multiple patterns matches", () => {
		const patterns = [/:\/\/foo\.test/, /:\/\/bar\.test/];
		assert.equal(isExcluded("https://bar.test/a", patterns), true);
	});
});

describe("EXCLUDE_PATTERNS — example.com entry", () => {
	const cases: ReadonlyArray<{ url: string; excluded: boolean; label: string }> = [
		{ url: "example.com/9598a307-2375-4ecc-a63c-e38f4128c7f5", excluded: true, label: "fixture path without scheme" },
		{ url: "https://example.com/foo", excluded: true, label: "https root path" },
		{ url: "http://example.com", excluded: true, label: "http no path" },
		{ url: "https://www.example.com/foo", excluded: true, label: "www subdomain" },
		{ url: "https://api.test.example.com/bar", excluded: true, label: "nested subdomain" },
		{ url: "https://example.com:8080/foo", excluded: true, label: "explicit port" },
		{ url: "https://example.com?q=1", excluded: true, label: "query immediately after host" },
		{ url: "https://notexample.com/foo", excluded: false, label: "prefixed similar host (should NOT match)" },
		{ url: "https://example.com.evil.com/foo", excluded: false, label: "subdomain trick (should NOT match)" },
		{ url: "https://myexample.com/foo", excluded: false, label: "different domain ending in example.com without dot boundary" },
	];
	for (const { url, excluded, label } of cases) {
		it(`${excluded ? "excludes" : "keeps"}: ${label} — ${url}`, () => {
			assert.equal(isExcluded(url, EXCLUDE_PATTERNS), excluded);
		});
	}
});

describe("EXCLUDE_PATTERNS — internal-network hostnames", () => {
	const cases: ReadonlyArray<{ url: string; excluded: boolean; label: string }> = [
		{ url: "https://cd.home.arpa/foo", excluded: true, label: "home.arpa single subdomain" },
		{ url: "https://router.home.arpa", excluded: true, label: "home.arpa no path" },
		{ url: "http://nas.local/share", excluded: true, label: ".local suffix" },
		{ url: "https://printer.lan", excluded: true, label: ".lan suffix" },
		{ url: "https://api.internal/v1", excluded: true, label: ".internal suffix" },
		{ url: "https://foo.bar.internal/x", excluded: true, label: "nested subdomain on .internal" },
		{ url: "https://localhost:3000/foo", excluded: true, label: "localhost with port" },
		{ url: "http://localhost", excluded: true, label: "bare localhost" },
		{ url: "http://ip6-localhost/foo", excluded: true, label: "ip6-localhost" },
		{ url: "http://ip6-loopback", excluded: true, label: "ip6-loopback" },
		{ url: "https://home.arpa.evil.com/foo", excluded: false, label: "suffix trick — home.arpa is a subdomain of evil.com" },
		{ url: "https://notlocalhost.com/foo", excluded: false, label: "prefix similar to localhost" },
		{ url: "https://mylan.com/foo", excluded: false, label: ".lan inside a real TLD path" },
		{ url: "https://example.local-host.com/foo", excluded: false, label: "label contains local but isn't the suffix" },
	];
	for (const { url, excluded, label } of cases) {
		it(`${excluded ? "excludes" : "keeps"}: ${label} — ${url}`, () => {
			assert.equal(isExcluded(url, EXCLUDE_PATTERNS), excluded);
		});
	}
});

describe("EXCLUDE_PATTERNS — browser-internal schemes", () => {
	const cases: ReadonlyArray<{ url: string; excluded: boolean; label: string }> = [
		{ url: "chrome://extensions/", excluded: true, label: "chrome:// with path" },
		{ url: "chrome://newtab", excluded: true, label: "chrome:// newtab" },
		{ url: "CHROME://SETTINGS", excluded: true, label: "chrome:// uppercase" },
		{ url: "about:home", excluded: true, label: "about:home" },
		{ url: "about:newtab", excluded: true, label: "about:newtab" },
		{ url: "about:blank", excluded: true, label: "about:blank" },
		{ url: "ABOUT:HOME", excluded: true, label: "about: uppercase" },
		{ url: "https://example.org/about:home", excluded: false, label: "about: inside a path — should NOT match" },
		{ url: "https://chrome.google.com/webstore", excluded: false, label: "chrome in hostname — should NOT match" },
	];
	for (const { url, excluded, label } of cases) {
		it(`${excluded ? "excludes" : "keeps"}: ${label} — ${url}`, () => {
			assert.equal(isExcluded(url, EXCLUDE_PATTERNS), excluded);
		});
	}
});

describe("EXCLUDE_PATTERNS — nhttps typo'd-scheme entry", () => {
	const cases: ReadonlyArray<{ url: string; excluded: boolean; label: string }> = [
		{ url: "nhttps://example.org/foo", excluded: true, label: "nhttps scheme on a normal host" },
		{ url: "nhttps:/github.com/id-Software/Quake/blob/master/WinQuake/nonintel.c", excluded: true, label: "nhttps with single slash (normalization-collapsed shape)" },
		{ url: "nhttps:/", excluded: true, label: "nhttps with single slash, no host" },
		{ url: "nhttps://", excluded: true, label: "nhttps with no host" },
		{ url: "NHTTPS://CASE.test/foo", excluded: true, label: "uppercase scheme" },
		{ url: "https://example.org/foo", excluded: false, label: "valid https — should NOT match" },
		{ url: "http://example.org/foo?next=nhttps://other", excluded: false, label: "nhttps appearing only inside a query" },
		{ url: "nhttps:foo", excluded: false, label: "nhttps without any slash — not a URL-shaped typo" },
	];
	for (const { url, excluded, label } of cases) {
		it(`${excluded ? "excludes" : "keeps"}: ${label} — ${url}`, () => {
			assert.equal(isExcluded(url, EXCLUDE_PATTERNS), excluded);
		});
	}
});

describe("EXCLUDE_PATTERNS — operator-curated exact-URL entries", () => {
	const cases: ReadonlyArray<{ url: string; excluded: boolean; label: string }> = [
		{ url: "fabiensanglard.net/quake", excluded: true, label: "fabiensanglard quake exact" },
		{ url: "https://fabiensanglard.net/quake", excluded: false, label: "fabiensanglard quake with scheme — different stored value" },
		{ url: "fabiensanglard.net/quake/", excluded: false, label: "fabiensanglard quake with trailing slash" },
		{ url: "fabiensanglard.net/quake2", excluded: false, label: "fabiensanglard quake with extra path char" },
		{ url: "fabiensanglard.net/other", excluded: false, label: "same host different path" },
		{ url: "https://www.theinformation", excluded: true, label: "theinformation truncated exact (no trailing dots)" },
		{ url: "https://www.theinformation....", excluded: true, label: "theinformation truncated with four trailing dots (actual storage shape)" },
		{ url: "https://www.theinformation.", excluded: true, label: "theinformation truncated with one trailing dot" },
		{ url: "https://www.theinformation.....", excluded: false, label: "theinformation with five trailing dots — beyond the bounded run" },
		{ url: "https://www.theinformation.com", excluded: false, label: "theinformation full host — should NOT match the truncated entry" },
		{ url: "https://www.theinformation/foo", excluded: false, label: "theinformation truncated with path" },
		{
			url: "https://web.eecs.umich.edu/~weimerw/2018-481/readings/mythical-man-month.pdf",
			excluded: true,
			label: "mythical-man-month exact",
		},
		{
			url: "https://web.eecs.umich.edu/~weimerw/2018-481/readings/mythical-man-month.pdf?x=1",
			excluded: false,
			label: "mythical-man-month with query suffix",
		},
		{
			url: "https://web.eecs.umich.edu/~weimerw/2018-481/readings/other.pdf",
			excluded: false,
			label: "same directory different file",
		},
		{
			url: "https://www.wsj.com/world/china/tightly-choreographed-visit-masks-big-differences-between-u-s-and-china-afa01180?mod=hp_lead_pos1",
			excluded: true,
			label: "wsj china piece exact",
		},
		{
			url: "https://www.wsj.com/world/china/tightly-choreographed-visit-masks-big-differences-between-u-s-and-china-afa01180",
			excluded: false,
			label: "wsj china piece without the mod query param",
		},
		{
			url: "https://www.nytimes.com/2026/05/06/business/media/bbc-guy-goma-interview.html",
			excluded: true,
			label: "nyt bbc-guy-goma article exact",
		},
		{
			url: "https://www.nytimes.com/2026/05/06/business/media/bbc-guy-goma-interview",
			excluded: false,
			label: "nyt bbc-guy-goma article missing .html",
		},
		{
			url: "https://cutlefish.substack.com/p/tbm-1352-asking-better-questions?utm_source=substack&utm_medium=email",
			excluded: true,
			label: "cutlefish tbm-1352 exact with utm suffix",
		},
		{
			url: "https://cutlefish.substack.com/p/tbm-1352-asking-better-questions",
			excluded: false,
			label: "cutlefish tbm-1352 without utm suffix — different stored value",
		},
		{
			url: "https://cutlefish.substack.com/p/tbm-410-dancing-with-problems?utm_source=post-email-title&publication_id=24711&post_id=190590408&utm_campaign=email-post-title&isFreemail=true&r=5ik6xc&triedRedirect=true&utm_medium=email",
			excluded: true,
			label: "cutlefish tbm-410 exact with full tracking-suffix",
		},
		{
			url: "https://cutlefish.substack.com/p/tbm-410-dancing-with-problems",
			excluded: false,
			label: "cutlefish tbm-410 base path without tracking suffix",
		},
		{
			url: "https://psychologywod.com/2013/08/18/blocked-practice-vs-random-practice-shake-things-up-in-your-training-and-in-your-life/",
			excluded: true,
			label: "psychologywod blocked-practice article exact",
		},
		{
			url: "https://psychologywod.com/2013/08/18/blocked-practice-vs-random-practice-shake-things-up-in-your-training-and-in-your-life",
			excluded: false,
			label: "psychologywod blocked-practice article missing trailing slash",
		},
		{
			url: "https://www.rd.usda.gov/sites/default/files/pdf-sample_0.pdf",
			excluded: true,
			label: "USDA PDF exact (Akamai BotManager IP block)",
		},
		{
			url: "https://www.rd.usda.gov/sites/default/files/other.pdf",
			excluded: false,
			label: "USDA different PDF path — should NOT match",
		},
	];
	for (const { url, excluded, label } of cases) {
		it(`${excluded ? "excludes" : "keeps"}: ${label} — ${url}`, () => {
			assert.equal(isExcluded(url, EXCLUDE_PATTERNS), excluded);
		});
	}
});
