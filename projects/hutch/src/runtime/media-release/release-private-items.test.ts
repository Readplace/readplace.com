import assert from "node:assert/strict";
import { ReaderArticleHashId, calculateReadTime } from "@packages/domain/article";
import { UserIdSchema, type UserId } from "@packages/domain/user";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import { initPrivateItemReleaseSteps, initReleasePrivateItem } from "./private-item-release-steps";
import { initReleasePrivateItems } from "./release-private-items";

const OWN_UPLOAD_ID = "0123456789abcdef0123456789abcdef";
const OWN_PRIVATE_URL = `https://uploads.readplace.invalid/${OWN_UPLOAD_ID}`;
const OTHERS_PRIVATE_URL = "https://uploads.readplace.invalid/fedcba9876543210fedcba9876543210";
const ORDINARY_URL = "https://example.com/an-article";
const ACCOUNT = UserIdSchema.parse("a".repeat(32));
const OTHER = UserIdSchema.parse("b".repeat(32));

async function buildSubject() {
	const store = initInMemoryArticleStore();
	const save = (userId: UserId, url: string) =>
		store.saveArticle({
			userId,
			url,
			metadata: { title: "A saved item", siteName: "example.com", excerpt: "", wordCount: 3 },
			estimatedReadTime: calculateReadTime(3),
			provenance: { kind: "web" },
			savedAt: new Date("2026-09-01T00:00:00.000Z"),
		});
	await save(ACCOUNT, OWN_PRIVATE_URL);
	await store.recordItemOwner({ url: OWN_PRIVATE_URL, ownerUserId: ACCOUNT });
	await save(OTHER, OTHERS_PRIVATE_URL);
	await store.recordItemOwner({ url: OTHERS_PRIVATE_URL, ownerUserId: OTHER });
	await save(ACCOUNT, OTHERS_PRIVATE_URL);
	await save(ACCOUNT, ORDINARY_URL);

	const calls: string[] = [];
	const failures = { contentOnce: false };
	const steps = initPrivateItemReleaseSteps({
		purgeArticleContent: async (url) => {
			if (failures.contentOnce) {
				failures.contentOnce = false;
				throw new Error("simulated purgeArticleContent failure");
			}
			calls.push(`content:${url}`);
		},
		deleteMediaObjects: async (keys) => {
			calls.push(`media:${keys.join(",")}`);
		},
		listMediaKeys: async (prefix) => [`${prefix}cover.png`, `${prefix}figure-1.jpg`],
		deleteArticleRow: async (url) => {
			calls.push(`row:${url}`);
		},
		mediaObjects: {
			unrefAll: async ({ uploadId }) => {
				calls.push(`holdings:${uploadId}`);
			},
		},
		deleteUserArticleLinks: async (url) => {
			calls.push(`links:${url}`);
			await store.deleteArticle(ReaderArticleHashId.from(url), ACCOUNT);
		},
	});
	const releasePrivateItems = initReleasePrivateItems({
		releasePrivateItem: initReleasePrivateItem({ findItemOwner: store.findItemOwner, steps }),
	});
	return { store, calls, failures, releasePrivateItems };
}

const OWN_ITEM_RELEASE = [
	`content:${OWN_PRIVATE_URL}`,
	`media:pending/${OWN_UPLOAD_ID}/original`,
	`media:images/${OWN_UPLOAD_ID}/cover.png,images/${OWN_UPLOAD_ID}/figure-1.jpg`,
	`row:${OWN_PRIVATE_URL}`,
	`holdings:${OWN_UPLOAD_ID}`,
	`links:${OWN_PRIVATE_URL}`,
];

describe("initReleasePrivateItems", () => {
	it("releases the account's own private item and skips ordinary urls and another user's private item", async () => {
		const { store, calls, releasePrivateItems } = await buildSubject();

		await releasePrivateItems({ userId: ACCOUNT, urls: await store.listUserArticleUrls(ACCOUNT) });

		assert.deepEqual(calls, OWN_ITEM_RELEASE);
	});

	it("keeps the private url listed when the content step throws, so a second run releases it", async () => {
		const { store, calls, failures, releasePrivateItems } = await buildSubject();
		failures.contentOnce = true;

		await assert.rejects(releasePrivateItems({ userId: ACCOUNT, urls: await store.listUserArticleUrls(ACCOUNT) }));

		assert.deepEqual(calls, []);
		const relisted = await store.listUserArticleUrls(ACCOUNT);
		assert(relisted.includes(OWN_PRIVATE_URL));

		await releasePrivateItems({ userId: ACCOUNT, urls: relisted });

		assert.deepEqual(calls, OWN_ITEM_RELEASE);
		assert.equal((await store.listUserArticleUrls(ACCOUNT)).includes(OWN_PRIVATE_URL), false);
	});
});
