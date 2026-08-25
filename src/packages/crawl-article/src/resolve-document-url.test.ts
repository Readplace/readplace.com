import { resolveDocumentUrl } from "./resolve-document-url";

describe("resolveDocumentUrl", () => {
	it("resolves to the destination the fetch landed on when the crawl followed a redirect", () => {
		const documentUrl = resolveDocumentUrl({
			requestedUrl: "https://wrapper.example/link/188518/8babea547d",
			finalUrl: "https://dest.example/article",
		});

		expect(documentUrl).toBe("https://dest.example/article");
	});

	it("resolves to the requested URL when no HTTP fetch produced a terminal", () => {
		const documentUrl = resolveDocumentUrl({
			requestedUrl: "https://x.com/user/status/123",
			finalUrl: undefined,
		});

		expect(documentUrl).toBe("https://x.com/user/status/123");
	});
});
