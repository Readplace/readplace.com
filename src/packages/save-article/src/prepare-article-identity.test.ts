import type { IdentityRow, RepairWrapperIdentity } from "@packages/provider-contracts/article-store";
import type { ResolveWrapperTarget } from "./resolve-wrapper-target";
import { initPrepareArticleIdentity } from "./prepare-article-identity";

const ORIGINAL = "https://site.example/article";
const ARCHIVE = `https://web.archive.org/web/2026/${ORIGINAL}`;
function harness(row: IdentityRow, repaired = true, resolveWrapperTarget: ResolveWrapperTarget = async () => undefined) {
	const repairs: Parameters<RepairWrapperIdentity>[0][] = [];
	const prepare = initPrepareArticleIdentity({
		findIdentityRow: async () => row,
		resolveWrapperTarget,
		repairWrapperIdentity: async (params) => { repairs.push(params); return repaired; },
	});
	return { prepare, repairs };
}
it("repairs only the legacy wrapper row, retaining its key and verified source", async () => {
	const h = harness({ kind: "article" });
	expect(await h.prepare(ARCHIVE)).toEqual({ status: "resolved", url: ARCHIVE, originalUrl: ORIGINAL, contentSourceUrl: ARCHIVE, sourceOriginalUrl: ORIGINAL });
	expect(h.repairs).toEqual([{ articleUrl: ARCHIVE, expectedOriginalUrl: ARCHIVE, originalUrl: ORIGINAL, contentSourceUrl: ARCHIVE }]);
});
it("repairs a legacy tracker row without pinning the tracker, offering its body for this crawl only", async () => {
	const tracker = "https://share.google/abc";
	const h = harness({ kind: "article" }, true, async () => ({ url: ORIGINAL }));
	expect(await h.prepare(tracker)).toEqual({ status: "resolved", url: tracker, originalUrl: ORIGINAL, contentSourceUrl: tracker, sourceOriginalUrl: ORIGINAL });
	expect(h.repairs).toEqual([{ articleUrl: tracker, expectedOriginalUrl: tracker, originalUrl: ORIGINAL, contentSourceUrl: undefined }]);
});
it("repairs an old outbound-wrapper identity without its unrelated parent capture", async () => {
	const url = `https://archive.ph/o/abc/${ORIGINAL}`;
	expect(await harness({ kind: "article", originalUrl: url }).prepare(url)).toEqual({ status: "resolved", url, originalUrl: ORIGINAL });
});
it("leaves an already authoritative row unchanged with its source binding", async () => {
	const h = harness({ kind: "article", originalUrl: ORIGINAL, sourceBinding: { contentSourceUrl: ARCHIVE, sourceOriginalUrl: ORIGINAL } });
	expect(await h.prepare(ARCHIVE)).toEqual({ status: "resolved", url: ARCHIVE, originalUrl: ORIGINAL, contentSourceUrl: ARCHIVE, sourceOriginalUrl: ORIGINAL });
	expect(h.repairs).toEqual([]);
});
it("leaves a plain row without binding unchanged", async () => {
	expect(await harness({ kind: "article" }).prepare(ORIGINAL)).toEqual({ status: "resolved", url: ORIGINAL, originalUrl: ORIGINAL });
});
it.each<IdentityRow>([{ kind: "absent" }, { kind: "alias", targetUrl: ORIGINAL }])("refuses non-article rows %j", async (row) => {
	expect(await harness(row).prepare(ARCHIVE)).toEqual({ status: "unresolved" });
});
it("refuses a persisted unsafe original", async () => {
	expect(await harness({ kind: "article", originalUrl: "http://localhost/a" }).prepare(ARCHIVE)).toEqual({ status: "unresolved" });
});
it.each(["https://archive.ph/abc", "https://web.archive.org/about", "https://apple.news/AbxPgQQdpQSy-ERx2g-kQZA"])("keeps unavailable originals unresolved %s", async (url) => {
	const h = harness({ kind: "article" });
	expect(await h.prepare(url)).toEqual({ status: "unresolved" });
	expect(h.repairs).toEqual([]);
});
const APPLE = "https://apple.news/AbxPgQQdpQSy-ERx2g-kQZA";
it("keeps an Apple News story with no web original on its own link without repairing the row", async () => {
	const h = harness({ kind: "article" }, true, async () => ({ ownOriginal: true }));
	expect(await h.prepare(APPLE)).toEqual({ status: "resolved", url: APPLE, originalUrl: APPLE });
	expect(h.repairs).toEqual([]);
});
it("keeps a tracker row unresolved when its chain ends at an Apple News story with no web original", async () => {
	const h = harness({ kind: "article" }, true, async (url) => url.startsWith("https://apple.news/") ? { ownOriginal: true } : { url: APPLE });
	expect(await h.prepare("https://share.google/abc")).toEqual({ status: "unresolved" });
	expect(h.repairs).toEqual([]);
});
it("rejects a concurrent identity change", async () => {
	expect(await harness({ kind: "article" }, false).prepare(ARCHIVE)).toEqual({ status: "unresolved" });
});
