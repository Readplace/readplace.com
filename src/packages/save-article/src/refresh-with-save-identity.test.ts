import { initRefreshWithSaveIdentity } from "./refresh-with-save-identity";

describe("initRefreshWithSaveIdentity", () => {
	it("returns 'unresolved' without refreshing when the save identity cannot be resolved", async () => {
		const refreshArticleIfStale = jest.fn();
		const { refreshArticleIfStale: refresh } = initRefreshWithSaveIdentity({
			resolveSaveIdentity: async () => ({ status: "unresolved" }),
			refreshArticleIfStale,
		});

		const freshness = await refresh({ url: "https://web.archive.org/web/2020/https://example.com/post" });

		expect(freshness).toEqual({ action: "unresolved", identity: { status: "unresolved" } });
		expect(refreshArticleIfStale).not.toHaveBeenCalled();
	});

	it("passes through an 'unresolved' verdict from the inner refresh", async () => {
		const { refreshArticleIfStale: refresh } = initRefreshWithSaveIdentity({
			resolveSaveIdentity: async (url) => ({ status: "resolved", url, originalUrl: url }),
			refreshArticleIfStale: async () => ({ action: "unresolved", identity: { status: "unresolved" } }),
		});

		const freshness = await refresh({ url: "https://example.com/post" });

		expect(freshness).toEqual({ action: "unresolved", identity: { status: "unresolved" } });
	});

	it("attaches the resolved save identity to the inner refresh verdict", async () => {
		const { refreshArticleIfStale: refresh } = initRefreshWithSaveIdentity({
			resolveSaveIdentity: async () => ({ status: "resolved", url: "https://example.com/post", originalUrl: "https://example.com/post" }),
			refreshArticleIfStale: async () => ({ action: "skip", identity: { status: "resolved", url: "https://other.example/x", originalUrl: "https://other.example/x" } }),
		});

		const freshness = await refresh({ url: "https://web.archive.org/web/2020/https://example.com/post" });

		expect(freshness).toEqual({
			action: "skip",
			identity: { status: "resolved", url: "https://example.com/post", originalUrl: "https://example.com/post" },
		});
	});
});
