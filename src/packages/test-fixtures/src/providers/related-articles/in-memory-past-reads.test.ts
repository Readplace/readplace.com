import assert from "node:assert/strict";
import { MinutesSchema } from "@packages/domain/article";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryArticleStore } from "../article-store/in-memory-article-store";
import { initInMemoryPastReads } from "./in-memory-past-reads";

const USER_ID = UserIdSchema.parse("user_abc");
const URL = "https://example.com/post";
const PAST_URL = "https://example.com/earlier";
const WORK = ReadlistSlugSchema.parse("work");
const AT = new Date("2026-09-12T00:00:00.000Z");

function build() {
	const articleStore = initInMemoryArticleStore();
	const store = initInMemoryPastReads({
		findArticleByUrl: articleStore.findArticleByUrl,
		findArticleById: articleStore.findArticleById,
	});

	async function save(params: { url: string; title: string }) {
		const { saved } = await articleStore.saveArticle({
			userId: USER_ID,
			url: params.url,
			metadata: { title: params.title, siteName: "Example", excerpt: "An excerpt", wordCount: 400 },
			estimatedReadTime: MinutesSchema.parse(2),
			provenance: { kind: "web" },
			savedAt: new Date(),
		});
		return saved;
	}

	return { articleStore, store, save };
}

describe("initInMemoryPastReads", () => {
	it("reports pending until a computation is settled", async () => {
		const { store } = build();

		expect(await store.findPastReads({ userId: USER_ID, url: URL })).toEqual({
			status: "pending",
		});
	});

	it("shows read matches, carrying reading-list context only when one is set", async () => {
		const { articleStore, store, save } = build();
		await save({ url: URL, title: "Target" });
		const inWork = await save({ url: PAST_URL, title: "In a custom list" });
		const inDefault = await save({
			url: "https://example.com/default-read",
			title: "In the default list",
		});
		await articleStore.updateArticleStatus(inWork.id, USER_ID, "read");
		await articleStore.updateArticleStatus(inDefault.id, USER_ID, "read");
		const outcome = await store.markPastReadsReady({
			userId: USER_ID,
			url: URL,
			pastReads: [
				{ url: PAST_URL, reason: "Same subject", readlist: WORK },
				{ url: "https://example.com/default-read", reason: "Also the subject" },
			],
			fingerprint: "fp",
			inputTokens: 1,
			outputTokens: 1,
			at: AT,
		});

		expect(outcome).toBe("stored");
		expect(await store.findPastReads({ userId: USER_ID, url: URL })).toEqual({
			status: "ready",
			items: [
				{
					id: inWork.id,
					title: "In a custom list",
					siteName: "Example",
					reason: "Same subject",
					readAt: expect.any(Date),
					readlist: WORK,
				},
				{
					id: inDefault.id,
					title: "In the default list",
					siteName: "Example",
					reason: "Also the subject",
					readAt: expect.any(Date),
				},
			],
		});
	});

	it("drops a match the reader has not actually read", async () => {
		const { store, save } = build();
		await save({ url: URL, title: "Target" });
		await save({ url: PAST_URL, title: "Still unread" });
		await store.markPastReadsReady({
			userId: USER_ID,
			url: URL,
			pastReads: [{ url: PAST_URL, reason: "Same subject" }],
			fingerprint: "fp",
			inputTokens: 1,
			outputTokens: 1,
			at: AT,
		});

		expect(await store.findPastReads({ userId: USER_ID, url: URL })).toEqual({
			status: "ready",
			items: [],
		});
	});

	it("drops a match whose article was never saved", async () => {
		const { store, save } = build();
		await save({ url: URL, title: "Target" });
		await store.markPastReadsReady({
			userId: USER_ID,
			url: URL,
			pastReads: [{ url: "https://example.com/never-saved", reason: "Same subject" }],
			fingerprint: "fp",
			inputTokens: 1,
			outputTokens: 1,
			at: AT,
		});

		expect(await store.findPastReads({ userId: USER_ID, url: URL })).toEqual({
			status: "ready",
			items: [],
		});
	});

	it("drops a match the reader has since deleted", async () => {
		const { articleStore, store, save } = build();
		await save({ url: URL, title: "Target" });
		const past = await save({ url: PAST_URL, title: "Earlier read" });
		await articleStore.updateArticleStatus(past.id, USER_ID, "read");
		await store.markPastReadsReady({
			userId: USER_ID,
			url: URL,
			pastReads: [{ url: PAST_URL, reason: "Same subject" }],
			fingerprint: "fp",
			inputTokens: 1,
			outputTokens: 1,
			at: AT,
		});
		await articleStore.deleteArticle(past.id, USER_ID);

		expect(await store.findPastReads({ userId: USER_ID, url: URL })).toEqual({
			status: "ready",
			items: [],
		});
	});

	it("lists a repeated past read once at its first copy, keeps a copy of the open article, and lets an unread copy leave a later read one in place", async () => {
		const { articleStore, store, save } = build();
		await save({ url: URL, title: "Postmortem: a package compromise" });
		const openCopy = await save({ url: "https://nodeweekly.com/link/2002/web", title: "Postmortem: a package compromise" });
		await save({ url: "https://example.com/unread-copy", title: "The Risks of Open Source" });
		const firstCopy = await save({ url: "https://medium.com/@writer/open-source-risks", title: "The Risks of Open Source" });
		const secondCopy = await save({ url: "https://example.com/open-source-risks", title: "the risks of  open source" });
		for (const read of [openCopy, firstCopy, secondCopy]) {
			await articleStore.updateArticleStatus(read.id, USER_ID, "read");
		}
		await store.markPastReadsReady({
			userId: USER_ID,
			url: URL,
			pastReads: [
				{ url: "https://nodeweekly.com/link/2002/web", reason: "The open article, read before" },
				{ url: "https://example.com/unread-copy", reason: "Unread copy" },
				{ url: "https://medium.com/@writer/open-source-risks", reason: "First read copy" },
				{ url: "https://example.com/open-source-risks", reason: "Second read copy" },
			],
			fingerprint: "fp",
			inputTokens: 1,
			outputTokens: 1,
			at: AT,
		});

		const result = await store.findPastReads({ userId: USER_ID, url: URL });

		assert(result.status === "ready", "the computation is settled");
		expect(result.items.map((item) => item.reason)).toEqual(["The open article, read before", "First read copy"]);
	});
});
