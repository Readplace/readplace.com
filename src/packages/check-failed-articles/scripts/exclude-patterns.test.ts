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

describe("EXCLUDE_PATTERNS — reddit.com entries", () => {
	const cases: ReadonlyArray<{ url: string; excluded: boolean; label: string }> = [
		// `/r/<sub>/comments/` resolves through the proxied crawl, so it must
		// surface: a failure there is a regression, not known-broken noise.
		{ url: "https://www.reddit.com/r/javascript/comments/abc/title/", excluded: false, label: "www.reddit.com /comments/ URL (now crawlable)" },
		{ url: "https://reddit.com/r/javascript/comments/abc", excluded: false, label: "apex /comments/ (now crawlable)" },
		{ url: "https://old.reddit.com/r/javascript/", excluded: true, label: "old.reddit.com subreddit front" },
		{ url: "https://old.reddit.com/r/js/comments/abc", excluded: true, label: "old.reddit.com /comments/" },
		{ url: "https://m.reddit.com/user/jay/", excluded: true, label: "m.reddit.com user page" },
		{ url: "https://www.reddit.com/user/jay/comments/abc/x/", excluded: true, label: "www user page" },
		{ url: "https://np.reddit.com/r/javascript/s/3GQafG3qjy", excluded: true, label: "np.reddit.com /s/ shortlink" },
		{ url: "https://www.reddit.com/r/coding/s/cQA6NT9Bvo", excluded: true, label: "www /s/ shortlink" },
		{ url: "https://notreddit.com/user/foo", excluded: false, label: "prefixed similar host (should NOT match)" },
		{ url: "https://reddit.com.evil.com/user/foo", excluded: false, label: "subdomain trick (should NOT match)" },
		{ url: "https://other.test/reddit.com/user/foo", excluded: false, label: "reddit.com inside a path" },
	];
	for (const { url, excluded, label } of cases) {
		it(`${excluded ? "excludes" : "keeps"}: ${label} — ${url}`, () => {
			assert.equal(isExcluded(url, EXCLUDE_PATTERNS), excluded);
		});
	}
});

describe("EXCLUDE_PATTERNS — stackoverflow.com entry", () => {
	const cases: ReadonlyArray<{ url: string; excluded: boolean; label: string }> = [
		{ url: "https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster-than-processing-an-unsorted-array", excluded: true, label: "apex question URL" },
		{ url: "https://www.stackoverflow.com/questions/11227809", excluded: true, label: "www.stackoverflow.com" },
		{ url: "https://meta.stackoverflow.com/questions/1", excluded: true, label: "meta.stackoverflow.com" },
		{ url: "http://stackoverflow.com/q/11227809", excluded: true, label: "http scheme" },
		{ url: "https://stackoverflow.com:443/q/1", excluded: true, label: "explicit port" },
		{ url: "https://stackoverflow.com?q=1", excluded: true, label: "query immediately after host" },
		{ url: "https://notstackoverflow.com/q/1", excluded: false, label: "prefixed similar host (should NOT match)" },
		{ url: "https://stackoverflow.com.evil.com/q/1", excluded: false, label: "subdomain trick (should NOT match)" },
		{ url: "https://other.test/stackoverflow.com/q/1", excluded: false, label: "stackoverflow.com inside a path" },
		// The wider Stack Exchange network is not uniformly challenged — this host
		// answered 200 to the same client — so its rows must still surface.
		{ url: "https://softwareengineering.stackexchange.com/questions/1", excluded: false, label: "stackexchange.com sibling (should NOT match)" },
	];
	for (const { url, excluded, label } of cases) {
		it(`${excluded ? "excludes" : "keeps"}: ${label} — ${url}`, () => {
			assert.equal(isExcluded(url, EXCLUDE_PATTERNS), excluded);
		});
	}
});

describe("EXCLUDE_PATTERNS — bizjournals.com is no longer excluded", () => {
	// The site-wide Cloudflare challenge that motivated the host-wide entry is
	// answered by the proxied crawl, so these rows must surface again.
	const cases: ReadonlyArray<{ url: string; excluded: boolean; label: string }> = [
		{ url: "https://www.bizjournals.com/tampabay/news/2026/07/22/rays-tampa-ballpark-early-construction.html?rel=plus", excluded: false, label: "stored row shape — www article with ?rel=plus" },
		{ url: "https://bizjournals.com/boston/news/2026/07/17/opinion-what-the-world-cup-taught-massachusetts.html", excluded: false, label: "apex bizjournals.com" },
	];
	for (const { url, excluded, label } of cases) {
		it(`${excluded ? "excludes" : "keeps"}: ${label} — ${url}`, () => {
			assert.equal(isExcluded(url, EXCLUDE_PATTERNS), excluded);
		});
	}
});

describe("EXCLUDE_PATTERNS — archive.ph entry", () => {
	const cases: ReadonlyArray<{ url: string; excluded: boolean; label: string }> = [
		{ url: "https://archive.ph/moksj", excluded: true, label: "stored row shape — short capture id" },
		{ url: "https://archive.ph/d9pPq", excluded: true, label: "stored row shape — mixed-case capture id" },
		{ url: "https://archive.ph", excluded: true, label: "apex with no path" },
		{ url: "http://archive.ph/7F8rl", excluded: true, label: "http scheme" },
		{ url: "https://archive.ph?q=1", excluded: true, label: "query immediately after host" },
		{ url: "https://archive.md/moksj", excluded: false, label: "archive.md sibling mirror — scoped to the saved host, must still surface" },
		{ url: "https://archive.today/moksj", excluded: false, label: "archive.today sibling mirror — scoped to the saved host, must still surface" },
		{ url: "https://archive.photo/moksj", excluded: false, label: "longer TLD without a host boundary (should NOT match)" },
		{ url: "https://myarchive.ph/moksj", excluded: false, label: "prefixed similar host (should NOT match)" },
		{ url: "https://archive.ph.evil.com/moksj", excluded: false, label: "subdomain trick (should NOT match)" },
		{ url: "https://web.archive.org/web/2020/https://example.org/a", excluded: false, label: "web.archive.org capture — a different service" },
	];
	for (const { url, excluded, label } of cases) {
		it(`${excluded ? "excludes" : "keeps"}: ${label} — ${url}`, () => {
			assert.equal(isExcluded(url, EXCLUDE_PATTERNS), excluded);
		});
	}
});

describe("EXCLUDE_PATTERNS — onlinelibrary.wiley.com entry", () => {
	const cases: ReadonlyArray<{ url: string; excluded: boolean; label: string }> = [
		{ url: "https://alz-journals.onlinelibrary.wiley.com/doi/10.1002/dad2.70432", excluded: true, label: "stored row shape — journal subdomain DOI landing page" },
		{ url: "https://onlinelibrary.wiley.com/doi/10.1002/dad2.70432", excluded: true, label: "apex onlinelibrary.wiley.com" },
		{ url: "https://agupubs.onlinelibrary.wiley.com/doi/10.1029/2023GL107070", excluded: true, label: "a different journal subdomain" },
		{ url: "https://onlinelibrary.wiley.com/doi/pdf/10.1002/dad2.70432", excluded: true, label: "publisher PDF path" },
		{ url: "http://onlinelibrary.wiley.com/doi/1", excluded: true, label: "http scheme" },
		{ url: "https://onlinelibrary.wiley.com:443/doi/1", excluded: true, label: "explicit port" },
		{ url: "https://onlinelibrary.wiley.com?q=1", excluded: true, label: "query immediately after host" },
		{ url: "https://notonlinelibrary.wiley.com/doi/1", excluded: false, label: "prefixed similar host (should NOT match)" },
		{ url: "https://onlinelibrary.wiley.com.evil.com/doi/1", excluded: false, label: "subdomain trick (should NOT match)" },
		{ url: "https://other.test/onlinelibrary.wiley.com/doi/1", excluded: false, label: "onlinelibrary.wiley.com inside a path" },
		{ url: "https://www.wiley.com/en-us/education", excluded: false, label: "www.wiley.com answers 200 — must still surface" },
		{ url: "https://link.springer.com/article/10.1007/s11023-020-09548-1", excluded: false, label: "reachable peer publisher — must still surface" },
		{ url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC13452022/", excluded: false, label: "reachable open-access mirror — must still surface" },
	];
	for (const { url, excluded, label } of cases) {
		it(`${excluded ? "excludes" : "keeps"}: ${label} — ${url}`, () => {
			assert.equal(isExcluded(url, EXCLUDE_PATTERNS), excluded);
		});
	}
});

describe("EXCLUDE_PATTERNS — presigned-URL entries", () => {
	const cases: ReadonlyArray<{ url: string; excluded: boolean; label: string }> = [
		{
			url: "https://s3-euw1-ap-pe-df-pch-content-store-p.s3.eu-west-1.amazonaws.com/9781003679479/preview.pdf?AWSAccessKeyId=ASIAQFVOSJ574BGIEP6J&Expires=1785058010&Signature=q%2BxYz%3D",
			excluded: true,
			label: "S3 SigV2 presign in mint order (RCA row shape)",
		},
		{
			url: "https://s3-euw1-ap-pe-df-pch-content-store-p.s3.eu-west-1.amazonaws.com/9781003679479/preview.pdf?Signature=q%2BxYz%3D&x-amz-security-token=FwoGZXIvYXdzEA%3D%3D&Expires=1785058292&AWSAccessKeyId=ASIAQFVOSJ574BGIEP6J",
			excluded: true,
			label: "S3 SigV2 presign with params reordered and an STS token",
		},
		{
			url: "https://bucket.s3.eu-west-1.amazonaws.com/doc.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=300&X-Amz-Signature=deadbeef",
			excluded: true,
			label: "S3 SigV4 presign",
		},
		{
			url: "https://cdn.test/49645891/paper.pdf?Expires=1500000000&Signature=abc&Key-Pair-Id=APKAJLOHF5GGSLRBV4ZA",
			excluded: true,
			label: "CloudFront canned-policy signed URL",
		},
		{
			url: "https://foo.test/article?Expires=123&Signature=abc",
			excluded: false,
			label: "a site's own signed link — no AWS key id, X-Amz- or Key-Pair-Id",
		},
		{
			url: "https://foo.test/article?AWSAccessKeyId=AKIA&Expires=123",
			excluded: false,
			label: "AWS key id and Expires without a Signature",
		},
		{
			url: "https://foo.test/article?myAWSAccessKeyId=a&theSignature=b&preExpires=1",
			excluded: false,
			label: "signature params as param-name substrings, not whole names",
		},
		{
			url: "https://foo.test/article?AWSAccessKeyId=a&Signature=b&Expires=session",
			excluded: false,
			label: "non-numeric Expires — not an epoch deadline",
		},
		{
			url: "https://foo.test/page#?AWSAccessKeyId=a&Signature=b&Expires=1",
			excluded: false,
			label: "signature params only inside the fragment",
		},
	];
	for (const { url, excluded, label } of cases) {
		it(`${excluded ? "excludes" : "keeps"}: ${label} — ${url}`, () => {
			assert.equal(isExcluded(url, EXCLUDE_PATTERNS), excluded);
		});
	}
});

describe("EXCLUDE_PATTERNS — quote-wrapped embedded-scheme entry", () => {
	const cases: ReadonlyArray<{ url: string; excluded: boolean; label: string }> = [
		{
			url: "https://fagnerbrack.com/%22https:/www.linkedin.com/in/fagnerbrack/%22",
			excluded: true,
			label: "issue #522 row — quoted linkedin profile",
		},
		{
			url: "https://fagnerbrack.com/%22https:/reddit.com/u/fagnerbrack%22",
			excluded: true,
			label: "issue #522 row — quoted reddit profile",
		},
		{
			url: "https://fagnerbrack.com/%22https:/github.com/kevinswiber/siren%22",
			excluded: true,
			label: "issue #522 row — quoted github repo",
		},
		{
			url: "https://fagnerbrack.com/%22https:/readplace.com/view/https:/developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Methods%22",
			excluded: true,
			label: "issue #522 row — quoted readplace view of MDN",
		},
		{
			url: "https://fagnerbrack.com/%22https:/readplace.com/view/https:/github.com/collection-json/spec%22",
			excluded: true,
			label: "issue #522 row — quoted readplace view of collection-json",
		},
		{
			url: "https://fagnerbrack.com/%22https:/readplace.com/view/https:/fagnerbrack.com/what-is-a-rest-api-and-why-yours-probably-isnt-one-7e5fb65ece4d",
			excluded: true,
			label: "issue #522 row — quoted readplace view, truncated trailing quote",
		},
		{
			url: "https://fagnerbrack.com/%22https:/readplace.com/view/https:/jsonapi.org/%22",
			excluded: true,
			label: "issue #522 row — quoted readplace view of jsonapi.org",
		},
		{
			url: "https://fagnerbrack.com/%22https:/readplace.com/view/https:/github.com/kevinswiber/siren%22",
			excluded: true,
			label: "issue #522 row — quoted readplace view of siren repo",
		},
		{
			url: "fagnerbrack.com/%22https:/example.org/a%22",
			excluded: true,
			label: "schemeless legacy storage shape",
		},
		{
			url: "https://example.org/%22https://double-slash.test/a%22",
			excluded: true,
			label: "uncollapsed embedded scheme (double slash)",
		},
		{
			url: "https://example.org/%22HTTP:/upper.test%22",
			excluded: true,
			label: "uppercase embedded scheme",
		},
		{
			url: "https://fagnerbrack.com/what-is-a-rest-api-and-why-yours-probably-isnt-one-7e5fb65ece4d",
			excluded: false,
			label: "real post on the same host — should NOT match",
		},
		{
			url: "https://example.org/redirect?next=/%22https://foo.test%22",
			excluded: false,
			label: "quoted URL only inside a query string — page may exist",
		},
		{
			url: "https://example.org/%22quoted%22/page",
			excluded: false,
			label: "quoted path segment without an embedded scheme",
		},
		{
			url: "https://web.archive.org/web/2020/https://example.org/a",
			excluded: false,
			label: "wayback-style path-embedded URL without quotes",
		},
		{
			url: "https://readplace.com/view/https:/github.com/kevinswiber/siren",
			excluded: false,
			label: "readplace canonical /view path without quotes",
		},
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
			url: "https://www.wsj.com/world/china/tightly-choreographed-visit-masks-big-differences-between-u-s-and-china-afa01180",
			excluded: false,
			label: "wsj china piece without the mod query param",
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
		{
			url: "https://jobs-au.pwc.com/experiencedhires/au/en/job/597385WD/Senior-Manager-Finance-Transformation-Global-Business-Services",
			excluded: true,
			label: "PwC delisted job posting exact (HTTP 410 Gone)",
		},
		{
			url: "https://jobs-au.pwc.com/experiencedhires/au/en/job/597385WD/Different-Role",
			excluded: false,
			label: "PwC same job ID different role slug — should NOT match",
		},
		{
			url: "https://fagnerbracj.com/learn-python-the-hard-way-was-right-about-one-thing-9b6ab0b67526",
			excluded: true,
			label: "fagnerbracj typo domain exact (NXDOMAIN)",
		},
		{
			url: "https://fagnerbrack.com/learn-python-the-hard-way-was-right-about-one-thing-9b6ab0b67526",
			excluded: false,
			label: "fagnerbrack correct domain — should NOT match",
		},
	];
	for (const { url, excluded, label } of cases) {
		it(`${excluded ? "excludes" : "keeps"}: ${label} — ${url}`, () => {
			assert.equal(isExcluded(url, EXCLUDE_PATTERNS), excluded);
		});
	}
});

describe("EXCLUDE_PATTERNS — permanently-unreachable saves", () => {
	const cases: ReadonlyArray<{ url: string; excluded: boolean; label: string }> = [
		// (a) Origin removed the page (404).
		{ url: "https://apisyouwonthate.com/blog/rest-and-hypermedia-in-2019/", excluded: true, label: "apisyouwonthate rest-and-hypermedia exact (trailing slash)" },
		{ url: "https://apisyouwonthate.com/blog/rest-and-hypermedia-in-2019", excluded: true, label: "apisyouwonthate rest-and-hypermedia no trailing slash (stored shape)" },
		{ url: "https://apisyouwonthate.com/blog/", excluded: false, label: "apisyouwonthate blog index — should NOT match" },
		{ url: "https://bocoup.com/weblog/es2015-nightmarefile", excluded: true, label: "bocoup apex weblog post" },
		{ url: "https://www.bocoup.com/weblog/es2015-nightmarefile", excluded: true, label: "bocoup www weblog post" },
		{ url: "https://bocoup.com/weblog/", excluded: false, label: "bocoup weblog index — should NOT match" },
		{ url: "https://braziljs.org/conf/2013", excluded: true, label: "braziljs apex conf 2013" },
		{ url: "https://www.braziljs.org/conf/2013", excluded: true, label: "braziljs www conf 2013" },
		{ url: "https://braziljs.org/conf/2014", excluded: false, label: "braziljs different conf year — should NOT match" },
		{ url: "https://dannorth.net/author/tastapod/", excluded: true, label: "dannorth tastapod author archive" },
		{ url: "https://dannorth.net/blog/whatever/", excluded: false, label: "dannorth live post — should NOT match" },
		{ url: "https://www.ctl.io/developers/blog/post/career-path-of-a-programmer/", excluded: true, label: "ctl.io career-path post" },
		{ url: "https://www.ctl.io/developers/blog/", excluded: false, label: "ctl.io blog index — should NOT match" },
		{ url: "https://www.spacejam.com/archive/spacejam/movie/jam.htm", excluded: true, label: "spacejam 1996 archive frameset" },
		{ url: "https://www.warnerbros.com/archive/spacejam/movie/jam.htm", excluded: true, label: "warnerbros spacejam mirror — same frameset, stored shape" },
		{ url: "https://www.spacejam.com/", excluded: false, label: "spacejam 2021 site root — should NOT match" },
		{ url: "https://www.warnerbros.com/", excluded: false, label: "warnerbros root — should NOT match" },
		{
			url: "https://www.se.rit.edu/~tabeec/RIT_441/Resources_files/How%20To%20Write%20Unmaintainable%20Code.pdf",
			excluded: true,
			label: "RIT unmaintainable-code PDF exact (percent-encoded path)",
		},
		{
			url: "https://www.se.rit.edu/~tabeec/RIT_441/Resources_files/Other.pdf",
			excluded: false,
			label: "RIT same directory different file — should NOT match",
		},
		{ url: "https://www.hackerrank.com/request-demo-search", excluded: true, label: "hackerrank request-demo-search slashless" },
		{ url: "https://www.hackerrank.com/request-demo-search/", excluded: true, label: "hackerrank request-demo-search trailing slash" },
		{ url: "https://www.hackerrank.com/dashboard", excluded: false, label: "hackerrank live page — should NOT match" },
		{
			url: "https://rubyonrails.org/doctrine/#optimize-for-programmer-happiness",
			excluded: true,
			label: "rubyonrails doctrine trailing-slash + fragment exact (404)",
		},
		{
			url: "https://rubyonrails.org/doctrine",
			excluded: false,
			label: "rubyonrails doctrine live slashless page — must NOT be hidden",
		},
		{ url: "https://medium.com/u/8de1791147b8", excluded: true, label: "medium deleted-user profile stub" },
		{ url: "https://medium.com/p/some-real-article-abc123", excluded: false, label: "medium real article — should NOT match" },
		{
			url: "https://github.com/torvalds/linux/pull/17#issuecomment-5654674",
			excluded: true,
			label: "torvalds/linux PR permalink (PRs disabled, 404)",
		},
		{ url: "https://github.com/js-cookie/js-cookie", excluded: false, label: "live GitHub repo (health source) — must NOT be hidden" },
		// (b) Domain does not resolve (NXDOMAIN).
		{ url: "https://divshot.com/blog/opinion/angular-2-crazy-like-a-fox/", excluded: true, label: "divshot angular-2 post (NXDOMAIN)" },
		{ url: "https://divshot.com/", excluded: false, label: "divshot root — should NOT match" },
		// (c) Dead hosting platform (terminal 503).
		{ url: "https://jstl.java.net/", excluded: true, label: "jstl.java.net root (retired platform)" },
		{ url: "https://jstl.java.net/foo", excluded: false, label: "jstl.java.net subpath — should NOT match" },
		// (d) Redirects away from the saved content.
		{ url: "https://www.fastcodesign.com/3062292/evidence/brainstorming-is-dumb", excluded: true, label: "fastcodesign brainstorming article (rebranded away)" },
		{ url: "https://www.fastcompany.com/co-design", excluded: false, label: "fastcompany co-design redirect target — must NOT be hidden" },
		{ url: "https://wiki.scratch.mit.edu/wiki/Help:Hard_Refresh", excluded: true, label: "scratch wiki help page (moved away)" },
		{ url: "https://wiki.scratch.mit.edu/wiki/Scratch_Wiki", excluded: false, label: "scratch wiki other page — should NOT match" },
		{ url: "https://mindsetworks.com/index.html", excluded: true, label: "mindsetworks index.html redirect stub" },
		{ url: "https://www.mindsetworks.com/Science/", excluded: true, label: "mindsetworks Science section (capitalised, stored shape)" },
		{ url: "https://www.mindsetworks.com/science/", excluded: true, label: "mindsetworks science section (lowercase, stored shape)" },
		{ url: "https://mindsetworks.com/", excluded: false, label: "mindsetworks homepage — should NOT match" },
		{ url: "https://www.mindsetworks.com/Math/", excluded: false, label: "mindsetworks other section — should NOT match" },
		// (e) Edge firewall / bot-wall blocking datacenter egress.
		{ url: "https://agilealliance.org/glossary/pairing/", excluded: true, label: "agilealliance pairing glossary (202 challenge)" },
		{ url: "https://www.agilealliance.org/glossary/pairing/", excluded: true, label: "agilealliance pairing glossary www variant (stored shape)" },
		{ url: "https://agilealliance.org/glossary/", excluded: false, label: "agilealliance glossary index — should NOT match" },
		{
			url: "https://unsplash.com/@metelevan?utm_source=medium&utm_medium=referral",
			excluded: true,
			label: "unsplash metelevan profile with tracking suffix (401 bot-check)",
		},
		{
			url: "https://unsplash.com/?utm_source=medium&utm_medium=referral",
			excluded: true,
			label: "unsplash gallery landing page with Medium referral suffix (stored shape)",
		},
		{ url: "https://unsplash.com/@metelevan", excluded: false, label: "unsplash profile without tracking suffix — different stored value" },
		{
			url: "https://blogs.oracle.com/ravello/beware-http-requests-automatic-retries",
			excluded: true,
			label: "oracle ravello blog post (403 edge firewall)",
		},
		{ url: "https://blogs.oracle.com/java/some-live-post", excluded: false, label: "other oracle blog — should NOT match" },
		{
			url: "https://kernel-recipes.org/en/2016/talks/patches-carved-into-stone-tablets/",
			excluded: true,
			label: "kernel-recipes 2016 talk (503 to datacenter IPs)",
		},
		{ url: "https://kernel-recipes.org/en/2016/", excluded: false, label: "kernel-recipes 2016 index — should NOT match" },
		{
			url: "https://www.microservices.com/talks/dont-build-a-distributed-monolith/",
			excluded: true,
			label: "microservices.com talk (503 to datacenter IPs)",
		},
		{ url: "https://www.microservices.com/", excluded: false, label: "microservices.com root — should NOT match" },
		{
			url: "https://thcsdaoduytu.edu.vn/gv-ngu-van-truong-thcs-dao-duy-tu-goi-y-mot-dan-chung-thuong-dung-trong-van-nghi-luan-xa-hoi-phan_?zarsrc=30&utm_source=zalo&utm_medium=zalo&utm_campaign=zalo&gidzl=gzlKVx88OtQZnDnxknLbUQF4sNIj4pPtwCJRAVuHRIg_mz8d_XWuAUVFW2Ab6pSfuypVAp8WueuwkWfYV0",
			excluded: false,
			label: "thcsdaoduytu query-string variant (extension-saved, ready) — must NOT be hidden",
		},
		{
			url: "https://thcsdaoduytu.edu.vn/some-other-article",
			excluded: false,
			label: "different thcsdaoduytu article — must NOT be hidden",
		},
		// (f) Login/subscription wall.
		{
			url: "https://www.academia.edu/4749776/Personal_experience_and_the_construction_of_knowledge_in_science",
			excluded: true,
			label: "academia.edu paper exact (login wall)",
		},
		{
			url: "https://www.academia.edu/4749776/",
			excluded: false,
			label: "academia.edu paper id without the slug — should NOT match",
		},
		{
			url: "https://academic.oup.com/qje/article-abstract/101/4/729/1840176?login=false",
			excluded: true,
			label: "oup QJE article-abstract with ?login=false (login wall)",
		},
		{
			url: "https://academic.oup.com/qje/article-abstract/101/4/729/1840176",
			excluded: true,
			label: "oup QJE article-abstract bare URL (stored shape) — login wall",
		},
		{
			url: "https://academic.oup.com/qje/article-abstract/101/4/729/9999999",
			excluded: false,
			label: "oup different article id — should NOT match",
		},
		{
			url: "https://d1wqtxts1xzle7.cloudfront.net/49645891/sce.373067020820161016-1490-16axao2.pdf?1476649331=&Expires=1620401627&Signature=abc&Key-Pair-Id=APKAJLOHF5GGSLRBV4ZA",
			excluded: true,
			label: "academia.edu CloudFront presigned PDF with expired-signature query (stored shape)",
		},
		{
			url: "https://d1wqtxts1xzle7.cloudfront.net/49645891/sce.373067020820161016-1490-16axao2.pdf",
			excluded: true,
			label: "academia.edu CloudFront PDF path without query",
		},
		{
			url: "https://d1wqtxts1xzle7.cloudfront.net/99999999/some-other-doc.pdf",
			excluded: false,
			label: "different CloudFront object — should NOT match",
		},
		// (g) Redirect-variant duplicates of working canonical URLs.
		{
			url: "https://hynek.me/articles/what-to-mock-in-5-mins/",
			excluded: false,
			label: "hynek canonical trailing-slash article — must NOT be hidden",
		},
		{
			url: "https://developer.android.com/reference/android/webkit/WebView",
			excluded: false,
			label: "android canonical no-.html reference — must NOT be hidden",
		},
		{
			url: "https://thehill.com/changing-america/enrichment/arts-culture/578724-5-points-for-anger-1-for-a-like-how-facebooks/",
			excluded: false,
			label: "thehill canonical trailing-slash article — must NOT be hidden",
		},
		{
			url: "https://thehill.com/changing-america/enrichment/arts-culture/999999-some-other-story",
			excluded: false,
			label: "different thehill article — must NOT be hidden",
		},
		// Operator-curated excludes.
		{
			url: "https://npmjs.com/package/react",
			excluded: false,
			label: "different npm package page — must NOT be hidden",
		},
		{
			url: "https://itnext.io/youre-not-praised-for-the-bugs-you-didn-t-create-ef3df6894d5c",
			excluded: true,
			label: "itnext.io Medium-hosted article (datacenter bot-wall)",
		},
		{
			url: "https://itnext.io/some-other-article-0123456789ab",
			excluded: false,
			label: "different itnext article — must NOT be hidden",
		},
		// Operator-curated exclude.
		{
			url: "https://www.castorama.fr/coffre-de-jardin-resine-effet-rotin-tresse-270-l-l-118-x-h-57-x-p-45-cm-marron-keter-emily/7290112634603_CAFR.prd",
			excluded: true,
			label: "castorama Keter box stored row shape (l-l-118)",
		},
		{
			url: "https://www.castorama.fr/coffre-de-jardin-resine-effet-rotin-tresse-270-l-l-18-x-h-57-x-p-45-cm-marron-keter-emily/7290112634603_CAFR.prd",
			excluded: true,
			label: "castorama Keter box one-digit transcription variant (l-l-18)",
		},
		{
			url: "https://www.castorama.fr/coffre-de-jardin-resine-effet-rotin-tresse-270-l-l-118-x-h-57-x-p-45-cm-marron-keter-emily/7290112634603_CAFR.prd?utm=x",
			excluded: false,
			label: "castorama Keter box with a query suffix — anchored exact, should NOT match",
		},
		{
			url: "https://www.castorama.fr/perceuse-visseuse-sans-fil-18v/1234567890123_CAFR.prd",
			excluded: false,
			label: "different castorama product — must NOT be hidden",
		},
		{
			url: "https://www.castorama.fr/",
			excluded: false,
			label: "castorama homepage — should NOT match",
		},
		// (h) TODAY delisted article — 404 at origin for datacenter egress,
		// 403 bot-wall residentially.
		{
			url: "http://www.todayonline.com/singapore/channel-newsasia-opens-bureau-myanmar",
			excluded: true,
			label: "todayonline CNA-Myanmar article stored http shape (origin 404)",
		},
		{
			url: "https://www.todayonline.com/singapore/channel-newsasia-opens-bureau-myanmar",
			excluded: true,
			label: "todayonline CNA-Myanmar article https re-save shape",
		},
		{
			url: "https://www.todayonline.com/singapore/some-other-story",
			excluded: false,
			label: "different todayonline article — must NOT be hidden",
		},
		// (h) Zhihu deleted answer — origin 404s a browser, but Baidu's BLB
		// edge 403s datacenter egress before the 404 can land.
		{
			url: "https://www.zhihu.com/question/2058516301257994660/answer/2058890698460509303",
			excluded: true,
			label: "zhihu deleted answer exact (origin 404 behind edge 403)",
		},
		{
			url: "https://www.zhihu.com/question/undefined/...This",
			excluded: true,
			label: "zhihu malformed extension save (question/undefined + truncated fragment, issue #962)",
		},
		{
			url: "https://www.zhihu.com/question/undefined/answer/2058890698460509303",
			excluded: false,
			label: "extension-saved question/undefined duplicate of the same answer — must NOT be hidden",
		},
		{
			url: "https://www.zhihu.com/question/2058516301257994660",
			excluded: false,
			label: "parent zhihu question page — must NOT be hidden",
		},
		// (i) web.archive.org captures behind datacenter throttling.
		{
			url: "https://web.archive.org/web/20180630105838/https://www.todayonline.com/singapore/channel-newsasia-opens-bureau-myanmar",
			excluded: false,
			label: "the later TODAY capture the 302 lands on — must NOT be hidden",
		},
		{
			url: "https://web.archive.org/web/20180630081250/https://www.abu.org.my/Latest_News-@-CNA_to_launch_satellite_studio_in_Malaysia.aspx",
			excluded: true,
			label: "wayback ABU press-page capture (uncollapsed scheme)",
		},
		{
			url: "https://web.archive.org/web/20180630081250/https:/www.abu.org.my/Latest_News-@-CNA_to_launch_satellite_studio_in_Malaysia.aspx",
			excluded: true,
			label: "wayback ABU press-page capture (collapsed scheme)",
		},
		{
			url: "https://web.archive.org/web/20200101000000/https://www.abu.org.my/Latest_News-@-CNA_to_launch_satellite_studio_in_Malaysia.aspx",
			excluded: false,
			label: "different-timestamp ABU capture — must NOT be hidden",
		},
	];
	for (const { url, excluded, label } of cases) {
		it(`${excluded ? "excludes" : "keeps"}: ${label} — ${url}`, () => {
			assert.equal(isExcluded(url, EXCLUDE_PATTERNS), excluded);
		});
	}
});

describe("EXCLUDE_PATTERNS — news.ycombinator.com/item soft-404", () => {
	const cases: ReadonlyArray<{ url: string; excluded: boolean; label: string }> = [
		{ url: "https://news.ycombinator.com/item", excluded: true, label: "stored row shape — /item with no id query" },
		{ url: "https://news.ycombinator.com/item?id=44567890", excluded: false, label: "a real item with its id — must NOT be hidden" },
		{ url: "https://news.ycombinator.com/item/", excluded: false, label: "trailing slash — different stored value" },
		{ url: "https://news.ycombinator.com/newest", excluded: false, label: "different HN page — must NOT be hidden" },
	];
	for (const { url, excluded, label } of cases) {
		it(`${excluded ? "excludes" : "keeps"}: ${label} — ${url}`, () => {
			assert.equal(isExcluded(url, EXCLUDE_PATTERNS), excluded);
		});
	}
});

describe("EXCLUDE_PATTERNS — javascriptweekly.com link trackers", () => {
	const cases: ReadonlyArray<{ url: string; excluded: boolean; label: string }> = [
		{ url: "https://javascriptweekly.com/link/189106/8babea547d?utm_source=x", excluded: false, label: "tracker 189106 with a query suffix — anchored exact, should NOT match" },
		{ url: "https://javascriptweekly.com/link/189110/8babea547d", excluded: false, label: "adjacent tracker id from the same batch — must NOT be hidden" },
		{ url: "https://javascriptweekly.com/link/188519/8babea547d?utm_source=x", excluded: false, label: "tracker 188519 with a query suffix — anchored exact, should NOT match" },
		{ url: "https://javascriptweekly.com/link/188764/8babea547d?utm_source=x", excluded: false, label: "tracker 188764 with a query suffix — anchored exact, should NOT match" },
		{ url: "https://javascriptweekly.com/link/188482/8babea547d", excluded: false, label: "different tracker id on the same host — must NOT be hidden" },
		{ url: "https://nodeweekly.com/link/188598/4be0b3f821", excluded: false, label: "sibling newsletter tracker — must NOT be hidden" },
	];
	for (const { url, excluded, label } of cases) {
		it(`${excluded ? "excludes" : "keeps"}: ${label} — ${url}`, () => {
			assert.equal(isExcluded(url, EXCLUDE_PATTERNS), excluded);
		});
	}
});

describe("EXCLUDE_PATTERNS — programmingdigest.net link tracker", () => {
	const cases: ReadonlyArray<{ url: string; excluded: boolean; label: string }> = [
		{
			url: "https://programmingdigest.net/links/22961/2554a8ea-e370-42e6-a26f-1c86375ee7a7/email?utm_source=x",
			excluded: false,
			label: "same tracker with a query suffix — anchored exact, should NOT match",
		},
		{
			url: "https://programmingdigest.net/links/22962/2554a8ea-e370-42e6-a26f-1c86375ee7a7/email",
			excluded: false,
			label: "different link id on the same host — must NOT be hidden",
		},
		{
			url: "https://programmingdigest.net/links/22961/2554a8ea-e370-42e6-a26f-1c86375ee7a7/web",
			excluded: false,
			label: "non-email delivery suffix — must NOT be hidden",
		},
		{
			url: "https://karboosx.net/post/5j7jdDM3/how-to-create-your-own-decentralized-messenger-protocol",
			excluded: false,
			label: "the tracker's redirect destination — must NOT be hidden",
		},
	];
	for (const { url, excluded, label } of cases) {
		it(`${excluded ? "excludes" : "keeps"}: ${label} — ${url}`, () => {
			assert.equal(isExcluded(url, EXCLUDE_PATTERNS), excluded);
		});
	}
});

describe("EXCLUDE_PATTERNS — doubled-URL save (issue #594)", () => {
	const cases: ReadonlyArray<{ url: string; excluded: boolean; label: string }> = [
		{
			url: "https://fagnerbrack.com/learn-sql-once-use-it-for-30-years-9aceb0bdee03https:/fagnerbrack.com/learn-sql-once-use-it-for-30-years-9aceb0bdee03",
			excluded: true,
			label: "stored doubled form with collapsed embedded scheme (https:/)",
		},
		{
			url: "https://fagnerbrack.com/learn-sql-once-use-it-for-30-years-9aceb0bdee03https://fagnerbrack.com/learn-sql-once-use-it-for-30-years-9aceb0bdee03",
			excluded: true,
			label: "doubled form with uncollapsed embedded scheme (https://)",
		},
		{
			url: "https://fagnerbrack.com/learn-sql-once-use-it-for-30-years-9aceb0bdee03",
			excluded: false,
			label: "the real single article — must NOT be hidden",
		},
		{
			url: "https://fagnerbrack.com/some-other-article-0123456789ab",
			excluded: false,
			label: "different fagnerbrack article — must NOT be hidden",
		},
	];
	for (const { url, excluded, label } of cases) {
		it(`${excluded ? "excludes" : "keeps"}: ${label} — ${url}`, () => {
			assert.equal(isExcluded(url, EXCLUDE_PATTERNS), excluded);
		});
	}
});

describe("EXCLUDE_PATTERNS — undelegated wowwwman.com root (issue #1067)", () => {
	const cases: ReadonlyArray<{ url: string; excluded: boolean; label: string }> = [
		{
			url: "http://www.wowwwman.com/",
			excluded: true,
			label: "the stored form — http, www, trailing slash",
		},
		{
			url: "https://wowwwman.com",
			excluded: true,
			label: "re-save of the same root — https, apex, no trailing slash",
		},
		{
			url: "https://www.wowwwman.com/some-article",
			excluded: false,
			label: "an article path on the host — must NOT be hidden if the domain returns",
		},
		{
			url: "https://notwowwwman.com/",
			excluded: false,
			label: "a different host ending in the same name — must NOT be hidden",
		},
	];
	for (const { url, excluded, label } of cases) {
		it(`${excluded ? "excludes" : "keeps"}: ${label} — ${url}`, () => {
			assert.equal(isExcluded(url, EXCLUDE_PATTERNS), excluded);
		});
	}
});

describe("EXCLUDE_PATTERNS — never-existed /view-minted paths (issue #1066)", () => {
	const cases: ReadonlyArray<{ url: string; excluded: boolean; label: string }> = [
		{
			url: "https://fagnerbrack.com/x",
			excluded: true,
			label: "bare slug minted by an anonymous /view visit",
		},
		{
			url: "https://fagnerbrack.com/business-success",
			excluded: true,
			label: "prefix-truncated slug minted by an anonymous /view visit",
		},
		{
			url: "https://fagnerbrack.com/business-success-luck-not-merit-51deca80bfaf?postPublishedType=repub",
			excluded: false,
			label: "the real article the truncation came from — must NOT be hidden",
		},
		{
			url: "https://fagnerbrack.com/business-success-luck-not-merit-51deca80bfaf",
			excluded: false,
			label: "the real article without its query string — must NOT be hidden",
		},
		{
			url: "https://fagnerbrack.com/xyz",
			excluded: false,
			label: "a longer slug starting with the excluded one — must NOT be hidden",
		},
	];
	for (const { url, excluded, label } of cases) {
		it(`${excluded ? "excludes" : "keeps"}: ${label} — ${url}`, () => {
			assert.equal(isExcluded(url, EXCLUDE_PATTERNS), excluded);
		});
	}
});
