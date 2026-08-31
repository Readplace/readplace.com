import assert from "node:assert/strict";
import { MinutesSchema, ReaderArticleHashId } from "@packages/domain/article";
import type { SavedArticle } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import { buildSharedLinksViewModel } from "./shared-links.view-model";

const NOW = new Date("2026-08-31T12:00:00.000Z");
const USER = "user-a" as UserId;

function sharedArticle(input: {
	url: string;
	title?: string;
	sharedAt?: Date;
	displayUrl?: string;
}): SavedArticle {
	return {
		id: ReaderArticleHashId.from(input.url),
		userId: USER,
		url: input.url,
		displayUrl: input.displayUrl,
		metadata: {
			title: input.title ?? "A title",
			siteName: "example.com",
			excerpt: "An excerpt",
			wordCount: 500,
		},
		estimatedReadTime: MinutesSchema.parse(3),
		status: "unread",
		savedAt: new Date("2026-08-01T00:00:00.000Z"),
		sharedAt: input.sharedAt ?? new Date("2026-08-30T12:00:00.000Z"),
	};
}

describe("buildSharedLinksViewModel", () => {
	it("maps each shared article to a titled /view permalink and a shared-time label", () => {
		const vm = buildSharedLinksViewModel({
			articles: [
				sharedArticle({
					url: "https://example.com/post",
					title: "The Post",
					sharedAt: new Date("2026-08-31T11:00:00.000Z"),
				}),
			],
			now: NOW,
		});

		assert.equal(vm.hasItems, true);
		assert.equal(vm.items.length, 1);
		assert.equal(vm.items[0].title, "The Post");
		assert.equal(vm.items[0].href, "/view/example.com/post");
		assert.deepEqual(vm.items[0].sharedLabel, {
			iso: "2026-08-31T11:00:00.000Z",
			label: "1h ago",
			mode: "relative",
		});
	});

	it("builds the permalink from the identity url, never the redirect destination", () => {
		const vm = buildSharedLinksViewModel({
			articles: [
				sharedArticle({
					url: "https://example.com/canonical",
					displayUrl: "https://tracker.example/redirect",
				}),
			],
			now: NOW,
		});

		assert.equal(vm.items[0].href, "/view/example.com/canonical");
	});

	it("preserves the order the store returned them in", () => {
		const vm = buildSharedLinksViewModel({
			articles: [
				sharedArticle({ url: "https://example.com/a", title: "A" }),
				sharedArticle({ url: "https://example.com/b", title: "B" }),
			],
			now: NOW,
		});

		assert.deepEqual(
			vm.items.map((item) => item.title),
			["A", "B"],
		);
	});

	it("reports an empty list so the template can show the empty state", () => {
		const vm = buildSharedLinksViewModel({ articles: [], now: NOW });

		assert.equal(vm.hasItems, false);
		assert.deepEqual(vm.items, []);
	});
});
