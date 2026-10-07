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
