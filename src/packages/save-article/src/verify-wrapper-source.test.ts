import type { IdentityRow } from "@packages/provider-contracts/article-store";
import { initVerifyWrapperSource } from "./verify-wrapper-source";
import type { ResolvedWrapperTarget } from "./resolve-wrapper-target";

const ORIGINAL = "https://site.example/article";
const ARCHIVE = `https://web.archive.org/web/2026/${ORIGINAL}`;
const SHORT = "https://archive.ph/abc";
const TRACKER = "https://javascriptweekly.com/link/1000/rss";

function harness(row: IdentityRow = { kind: "article", originalUrl: ORIGINAL }, target?: ResolvedWrapperTarget) {
	const requests: string[] = [];
	const verify = initVerifyWrapperSource({ findIdentityRow: async () => row, resolveWrapperTarget: async (url) => { requests.push(url); return target; } });
	return { verify, requests };
}

it("verifies syntactic capture identity against the effective original of a legacy owner", async () => {
	expect(await harness().verify({ articleUrl: TRACKER, sourceUrl: ARCHIVE, claimedOriginalUrl: ORIGINAL })).toEqual({ originalUrl: ORIGINAL, sourceUrl: ARCHIVE });
});
it("revalidates an opaque source even when an alias binding was previously stored", async () => {
	const h = harness({ kind: "article", originalUrl: ORIGINAL, sourceBinding: { contentSourceUrl: SHORT, sourceOriginalUrl: ORIGINAL } }, { url: ORIGINAL, contentSourceUrl: SHORT });
	expect(await h.verify({ articleUrl: ORIGINAL, sourceUrl: SHORT })).toEqual({ originalUrl: ORIGINAL, sourceUrl: SHORT });
	expect(h.requests).toEqual([SHORT]);
});
it("keeps a generic wrapper as the verified body source", async () => {
	expect(await harness(undefined, { url: ORIGINAL }).verify({ articleUrl: ORIGINAL, sourceUrl: TRACKER })).toEqual({ originalUrl: ORIGINAL, sourceUrl: TRACKER });
});
it.each([SHORT, ORIGINAL, `https://archive.ph/o/abc/${ORIGINAL}`])("withholds a source without a recoverable wrapper copy %s", async (sourceUrl) => {
	expect(await harness().verify({ articleUrl: ORIGINAL, sourceUrl })).toBeUndefined();
});
it.each<IdentityRow>([{ kind: "absent" }, { kind: "alias", targetUrl: ORIGINAL }, { kind: "article", originalUrl: SHORT }, { kind: "article", originalUrl: TRACKER }, { kind: "article", originalUrl: "https://archive.ph/about/pages" }, { kind: "article", originalUrl: "http://localhost/a" }, { kind: "article", originalUrl: "https://different.example/article" }])("withholds a source whose owner is not the same proven original %j", async (row) => {
	expect(await harness(row).verify({ articleUrl: ORIGINAL, sourceUrl: ARCHIVE })).toBeUndefined();
});
it("withholds a capture of a share intent as a source for the shared original", async () => {
	const sourceUrl = `https://web.archive.org/web/2020/https://x.com/intent/post?url=${encodeURIComponent(ORIGINAL)}`;
	expect(await harness().verify({ articleUrl: ORIGINAL, sourceUrl })).toBeUndefined();
});
it("uses the stored key for a normal row without an adoption pin", async () => {
	expect(await harness({ kind: "article" }).verify({ articleUrl: ORIGINAL, sourceUrl: ARCHIVE })).toEqual({ originalUrl: ORIGINAL, sourceUrl: ARCHIVE });
});
it.each(["http://localhost/a", "https://different.example/article"])("rejects a stale or invalid claimed original %s", async (claimedOriginalUrl) => {
	expect(await harness().verify({ articleUrl: ORIGINAL, sourceUrl: ARCHIVE, claimedOriginalUrl })).toBeUndefined();
});


it("recognizes canonical host equivalence without changing a legacy owner's effective original", async () => {
	const legacy = "https://twitter.com/person/status/1";
	const original = "https://x.com/person/status/1";
	const source = `https://web.archive.org/web/2026/${original}`;
	expect(await harness({ kind: "article", originalUrl: legacy }).verify({ articleUrl: legacy, sourceUrl: source, claimedOriginalUrl: original })).toEqual({ originalUrl: legacy, sourceUrl: source });
});
