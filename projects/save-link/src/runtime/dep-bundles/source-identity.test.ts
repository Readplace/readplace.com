import { noopLogger } from "@packages/hutch-logger";
import { initSelectionSourceIdentity, initSourceIdentityDepBundle } from "./source-identity";

describe("worker source identity", () => {
	it("resolves the stored original and refuses an unresolved queued article before fetching", async () => {
		const bundle = initSourceIdentityDepBundle({
			findIdentityRow: async (url) => url === "https://example.com/post" ? { kind: "article", url, originalUrl: url } : { kind: "absent" },
			repairWrapperIdentity: async () => { throw new Error("direct original must not repair identity"); },
			crawlFetch: async () => { throw new Error("direct original must not fetch a wrapper"); },
			logger: noopLogger,
		});
		expect(await bundle.resolveOriginalUrl("https://example.com/post")).toBe("https://example.com/post");
		await expect(bundle.resolveOriginalUrl("https://archive.ph/unknown")).rejects.toThrow("candidate original identity is unresolved");
	});

	const APPLE = "https://apple.news/AbxPgQQdpQSy-ERx2g-kQZA?articleList=Aa2vGyZWlSfaFMqEGY0e4xQ,AbxPgQQdpQSy-ERx2g-kQZA&campaign_id=E101";
	const appleBundle = (shell: () => Response) => initSourceIdentityDepBundle({
		findIdentityRow: async (url) => url === APPLE ? { kind: "article", url, originalUrl: url } : { kind: "absent" },
		repairWrapperIdentity: async () => { throw new Error("own original must not repair identity"); },
		crawlFetch: async () => shell(),
		logger: noopLogger,
	});

	it("keeps an Apple News story whose shell names no publisher URL on its own link", async () => {
		const bundle = appleBundle(() => new Response("<html><body><script>redirectToUrl(url)</script></body></html>", { status: 200 }));
		expect(await bundle.resolveOriginalUrl(APPLE)).toBe(APPLE);
		expect(await bundle.prepareArticleIdentity(APPLE)).toEqual({ status: "resolved", url: APPLE, originalUrl: APPLE });
	});

	it("keeps an Apple News story unresolved while its shell is unavailable", async () => {
		await expect(appleBundle(() => new Response(null, { status: 503 })).resolveOriginalUrl(APPLE)).rejects.toThrow("candidate original identity is unresolved");
	});
});

describe("selection source identity", () => {
	const article = "https://example.com/post";
	const { verifyWrapperSource } = initSelectionSourceIdentity({
		findIdentityRow: async (url) => url === article ? { kind: "article", url, originalUrl: url } : { kind: "absent" },
	});

	it("trusts a stored short-link capture on the original its worker recorded", async () => {
		expect(await verifyWrapperSource({ articleUrl: article, sourceUrl: "https://archive.ph/Ab1Cd", claimedOriginalUrl: article }))
			.toEqual({ originalUrl: article, sourceUrl: "https://archive.ph/Ab1Cd" });
	});

	it("refuses a stored short-link capture that records no original", async () => {
		expect(await verifyWrapperSource({ articleUrl: article, sourceUrl: "https://archive.ph/Ab1Cd" })).toBeUndefined();
	});

	it("re-derives an embedded original instead of trusting a recorded claim", async () => {
		expect(await verifyWrapperSource({ articleUrl: article, sourceUrl: "https://web.archive.org/web/20081203/https://attacker.example/post", claimedOriginalUrl: article })).toBeUndefined();
	});
});
