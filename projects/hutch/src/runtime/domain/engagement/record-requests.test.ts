import { UserIdSchema, type UserId } from "@packages/domain/user";
import { MinutesSchema } from "@packages/domain/article";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "@packages/domain/readlist";
import { initInMemoryArticleStore, noArticleTopics } from "@packages/test-fixtures/providers/article-store";
import type { RecordEngagementActivity } from "@packages/provider-contracts/engagement-starter";
import { initRecordPersonalSaves } from "./record-personal-saves";
import { initRecordImportRequest } from "./record-import-request";

const userId = UserIdSchema.parse("reader");
const NOW = new Date("2026-10-10T12:00:00.000Z");
describe("deliberate requests", () => {
	it("records personal saves and imports, while preserving attribution and excluding background seeds and ingestion", async () => {
		const store = initInMemoryArticleStore({ findTopics: noArticleTopics });
		const activity: Parameters<RecordEngagementActivity>[0][] = [];
		const wrapped = initRecordPersonalSaves({
			...store,
			recordEngagementActivity: async (input) => {
				activity.push(input);
			},
			now: () => NOW,
		});
		const params = {
			userId,
			url: "https://publisher.com/article",
			metadata: { title: "Title", siteName: "Site", excerpt: "", wordCount: 200 },
			estimatedReadTime: MinutesSchema.parse(1),
			provenance: { kind: "web" as const },
			savedAt: NOW,
		};
		await wrapped.saveArticle(params);
		await wrapped.saveArticle(params);
		expect(activity).toHaveLength(2);
		const suggestionAttribution = {
			campaignId: "hn-starter-v1",
			snapshotAt: NOW.toISOString(),
			hnItemId: 1,
			rank: 1,
		};
		await wrapped.saveReadlistArticle({
			...params,
			url: "https://publisher.com/personal",
			readlist: ReadlistSlugSchema.parse("work"),
			suggestionAttribution,
		});
		await wrapped.saveArticleKeepingPosition({
			...params,
			url: "https://publisher.com/import",
			provenance: { kind: "import" },
		});
		expect(activity).toHaveLength(4);
		expect(activity[2]).toMatchObject({ kind: "personal-save", campaignId: "hn-starter-v1" });
		for (const provenance of [
			{ kind: "email", senderEmail: "newsletter@sender.com" },
			{ kind: "hn-suggestion", ...suggestionAttribution },
			{ kind: "founder-seed" },
		] as const)
			await wrapped.saveArticle({
				...params,
				url: `https://publisher.com/${provenance.kind}`,
				provenance,
			});
		expect(activity).toHaveLength(4);
	});
	it("records authenticated import requests after success without attributing an anonymous upload", async () => {
		const activity: Parameters<RecordEngagementActivity>[0][] = [];
		const request = initRecordImportRequest({
			request: async (input: { userId: UserId | undefined; value: string }) => input.value,
			recordEngagementActivity: async (input) => {
				activity.push(input);
			},
			now: () => NOW,
		});
		expect(await request({ userId, value: "job" })).toBe("job");
		expect(await request({ userId: undefined, value: "upload" })).toBe("upload");
		expect(activity).toEqual([{ userId, at: NOW, kind: "import-request" }]);
	});
	it("records deliberate filing across All and custom lists while retaining suggestion provenance", async () => {
		const store = initInMemoryArticleStore({ findTopics: noArticleTopics });
		const activity: Parameters<RecordEngagementActivity>[0][] = [];
		const wrapped = initRecordPersonalSaves({
			...store,
			recordEngagementActivity: async (input) => {
				activity.push(input);
			},
			now: () => NOW,
		});
		const work = ReadlistSlugSchema.parse("work");
		const later = ReadlistSlugSchema.parse("later");
		await store.createReadlistDefinition({ userId, slug: work, label: "Work", createdAt: NOW });
		await store.createReadlistDefinition({ userId, slug: later, label: "Later", createdAt: NOW });
		const attribution = {
			campaignId: "hn-starter-v1",
			snapshotAt: NOW.toISOString(),
			hnItemId: 1,
			rank: 1,
		};
		const saved = await store.saveArticle({
			userId,
			url: "https://publisher.com/suggestion",
			metadata: { title: "Title", siteName: "Site", excerpt: "", wordCount: 200 },
			estimatedReadTime: MinutesSchema.parse(1),
			provenance: { kind: "hn-suggestion", ...attribution },
			suggestionAttribution: attribution,
			savedAt: NOW,
		});
		const params = {
			userId,
			url: saved.saved.url,
			from: DEFAULT_READLIST_SLUG,
			readlist: work,
			savedAt: NOW,
		};
		expect(await wrapped.assignSavedArticleToReadlist(params)).toEqual({ assigned: true });
		expect(await wrapped.assignSavedArticleToReadlist(params)).toEqual({ assigned: false });
		expect(
			await wrapped.assignSavedArticleToReadlist({ ...params, from: work, readlist: later }),
		).toEqual({ assigned: true });
		expect(activity).toEqual(
			Array.from({ length: 3 }, () => ({
				userId,
				kind: "personal-save",
				at: NOW,
				articleId: saved.saved.id,
				campaignId: attribution.campaignId,
			})),
		);
		expect(
			await store.findReadlistArticleById({ userId, id: saved.saved.id, readlist: later }),
		).toMatchObject({ provenance: { kind: "hn-suggestion" }, suggestionAttribution: attribution });
		expect((await store.findPersonalLibrary(userId)).personalCount).toBe(0);
		expect(
			await wrapped.assignSavedArticleToReadlist({
				...params,
				url: "https://publisher.com/missing",
			}),
		).toEqual({ assigned: false });
		expect(activity).toHaveLength(3);
		const personal = await store.saveArticle({
			userId,
			url: "https://publisher.com/personal",
			metadata: { title: "Title", siteName: "Site", excerpt: "", wordCount: 200 },
			estimatedReadTime: MinutesSchema.parse(1),
			provenance: { kind: "web" },
			savedAt: NOW,
		});
		await wrapped.assignSavedArticleToReadlist({ ...params, url: personal.saved.url });
		expect(activity.at(-1)).toMatchObject({ articleId: personal.saved.id, campaignId: undefined });
	});
});
