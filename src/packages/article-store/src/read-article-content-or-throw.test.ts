import type { ContentProvider, FindItemOwner } from "@packages/provider-contracts/article-store";
import { ANONYMOUS_VIEWER, viewerFor } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { initReadArticleContentOrThrow } from "./read-article-content-or-throw";

const PRIVATE_URL = "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef";
const OWNER = UserIdSchema.parse("owner-user");
const noOwnerLookup: FindItemOwner = async () => {
	throw new Error("the owner is read only for a private upload");
};

describe("initReadArticleContentOrThrow", () => {
	it("returns content from the first provider that has it", async () => {
		const s3: ContentProvider = async () => undefined;
		const dynamodb: ContentProvider = async () => "dynamodb content";

		const readArticleContent = initReadArticleContentOrThrow({ findItemOwner: noOwnerLookup, storageProviderQueryOrder: [s3, dynamodb] });

		expect(await readArticleContent({ url: "https://example.com/article", viewer: ANONYMOUS_VIEWER })).toEqual({ kind: "article", body: "dynamodb content" });
	});

	it("reports a missing body when no provider has content", async () => {
		const empty: ContentProvider = async () => "";

		const readArticleContent = initReadArticleContentOrThrow({ findItemOwner: noOwnerLookup, storageProviderQueryOrder: [empty] });

		expect(await readArticleContent({ url: "https://example.com/article", viewer: ANONYMOUS_VIEWER })).toEqual({ kind: "missing" });
	});

	it("rejects with a provider's failure instead of reporting the article as having no content", async () => {
		const s3: ContentProvider = async () => {
			throw new Error("SlowDown");
		};
		const dynamodb: ContentProvider = async () => "dynamodb content";

		const readArticleContent = initReadArticleContentOrThrow({ findItemOwner: noOwnerLookup, storageProviderQueryOrder: [s3, dynamodb] });

		await expect(readArticleContent({ url: "https://example.com/article", viewer: ANONYMOUS_VIEWER })).rejects.toThrow("SlowDown");
	});

	it("reports a webmail page as not an article even when a provider holds its body", async () => {
		const s3: ContentProvider = async () => "<p>Inbox</p>";

		const readArticleContent = initReadArticleContentOrThrow({ findItemOwner: noOwnerLookup, storageProviderQueryOrder: [s3] });

		expect(await readArticleContent({ url: "https://mail.google.com/mail/u/2/", viewer: ANONYMOUS_VIEWER })).toEqual({ kind: "not-an-article" });
	});

	describe("a private upload", () => {
		const stored: ContentProvider = async () => "<p>Chapter</p>";
		const ownerLookups: string[] = [];
		const readArticleContent = initReadArticleContentOrThrow({
			storageProviderQueryOrder: [stored],
			findItemOwner: async (url) => {
				ownerLookups.push(url);
				return OWNER;
			},
		});

		it("gives its owner the body after reading the owner once", async () => {
			ownerLookups.length = 0;
			expect(await readArticleContent({ url: PRIVATE_URL, viewer: viewerFor(OWNER) })).toEqual({
				kind: "article",
				body: "<p>Chapter</p>",
			});
			expect(ownerLookups).toEqual([PRIVATE_URL]);
		});

		it("gives another reader no body", async () => {
			expect(
				await readArticleContent({ url: PRIVATE_URL, viewer: viewerFor(UserIdSchema.parse("other-reader")) }),
			).toEqual({ kind: "not-an-article" });
		});
	});
});
