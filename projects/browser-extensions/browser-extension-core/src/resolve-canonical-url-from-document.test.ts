import type { CanonicalDocument } from "@packages/article-resource-unique-id";
import { resolveCanonicalUrlFromDocument } from "./resolve-canonical-url-from-document";

function fakeDocument(tags: { canonical?: string; ogUrl?: string }): CanonicalDocument {
	return {
		querySelector(selectors: string) {
			if (selectors === 'link[rel~="canonical"]' && tags.canonical !== undefined) {
				return { getAttribute: () => tags.canonical ?? null };
			}
			if (selectors === 'meta[property="og:url"]' && tags.ogUrl !== undefined) {
				return { getAttribute: () => tags.ogUrl ?? null };
			}
			return null;
		},
	};
}

describe("resolveCanonicalUrlFromDocument", () => {
	it("returns the page's declared canonical when it changes identity", () => {
		expect(
			resolveCanonicalUrlFromDocument({
				document: fakeDocument({ canonical: "https://x.com/post" }),
				requestedUrl: "https://x.com/amp/post",
			}),
		).toBe("https://x.com/post");
	});

	it("returns the requested URL when the page declares no canonical", () => {
		expect(
			resolveCanonicalUrlFromDocument({
				document: fakeDocument({}),
				requestedUrl: "https://x.com/a",
			}),
		).toBe("https://x.com/a");
	});
});
