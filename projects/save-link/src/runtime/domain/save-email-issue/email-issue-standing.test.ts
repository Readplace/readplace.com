import assert from "node:assert/strict";
import { MinutesSchema } from "@packages/domain/article";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import { initFindEmailIssueStanding } from "./email-issue-standing";

const READER = UserIdSchema.parse("00000000000000000000000000000001");
const ISSUE_URL = "email://inbox/00000000000000000000000000000001/2026-06-24T09%3A00%3A00.000Z%23%3Cm%40x%3E";
const INBOX_PAGE = "https://readplace.com/inbox/2026-06-24T09%3A00%3A00.000Z%23%3Cm%40x%3E";
const WORK = ReadlistSlugSchema.parse("work");
const HOME = ReadlistSlugSchema.parse("home");

function harness() {
	const store = initInMemoryArticleStore();
	const findStanding = initFindEmailIssueStanding({
		findStoredDisplayUrl: store.findAdoptedFetchUrl,
		listUserSavesForUrl: store.listUserSavesForUrl,
	});
	const article = {
		userId: READER,
		url: ISSUE_URL,
		metadata: { title: "Issue", siteName: "TLDR", excerpt: "", wordCount: 10 },
		estimatedReadTime: MinutesSchema.parse(1),
		provenance: { kind: "email", senderEmail: "dan@tldr.tech" } as const,
		savedAt: new Date(),
	};
	return {
		store,
		standing: () => findStanding({ userId: READER, url: ISSUE_URL }),
		saveToAll: () => store.saveArticle(article),
		fileInto: (readlist: typeof WORK) => store.saveReadlistArticle({ ...article, readlist }),
		setDisplayUrl: () => store.setDisplayUrl({ url: ISSUE_URL, displayUrl: INBOX_PAGE }),
		removeFromAll: async () => {
			const row = await store.findArticleByUrl(ISSUE_URL);
			assert(row);
			await store.deleteArticle(row.id, READER);
		},
	};
}

describe("initFindEmailIssueStanding", () => {
	it("reports an issue nobody has saved as not removed", async () => {
		const h = harness();

		assert.equal((await h.standing()).removedByReader, false);
	});

	it("reports a saved issue with a display URL as not removed", async () => {
		const h = harness();
		await h.saveToAll();
		await h.setDisplayUrl();

		assert.equal((await h.standing()).removedByReader, false);
	});

	it("reports an issue with a display URL and no All save as removed by the reader", async () => {
		const h = harness();
		await h.saveToAll();
		await h.setDisplayUrl();
		await h.removeFromAll();

		assert.deepEqual(await h.standing(), { removedByReader: true, savedToAll: false, filedInto: [] });
	});

	it("reports a saved issue with no display URL as not removed", async () => {
		const h = harness();
		await h.saveToAll();

		assert.equal((await h.standing()).removedByReader, false);
	});

	it("lists the custom readlists the reader already holds the issue in", async () => {
		const h = harness();
		for (const slug of [WORK, HOME]) {
			await h.store.createReadlistDefinition({ userId: READER, slug, label: slug, createdAt: new Date() });
		}
		await h.saveToAll();
		await h.fileInto(WORK);
		await h.fileInto(HOME);

		assert.deepEqual((await h.standing()).filedInto, [WORK, HOME]);
	});

	it("reports an issue held only in a custom readlist, with a display URL, as removed from All", async () => {
		const h = harness();
		await h.store.createReadlistDefinition({ userId: READER, slug: WORK, label: "Work", createdAt: new Date() });
		await h.saveToAll();
		await h.fileInto(WORK);
		await h.setDisplayUrl();
		await h.removeFromAll();

		assert.deepEqual(await h.standing(), { removedByReader: true, savedToAll: false, filedInto: [WORK] });
	});

	it("reports a saved issue as saved to All", async () => {
		const h = harness();
		await h.saveToAll();

		assert.equal((await h.standing()).savedToAll, true);
	});

	it("reports an issue nobody has saved, and one held only in a custom readlist, as not saved to All", async () => {
		const nobody = harness();
		assert.equal((await nobody.standing()).savedToAll, false);

		const readlistOnly = harness();
		await readlistOnly.store.createReadlistDefinition({ userId: READER, slug: WORK, label: "Work", createdAt: new Date() });
		await readlistOnly.saveToAll();
		await readlistOnly.fileInto(WORK);
		await readlistOnly.removeFromAll();
		assert.deepEqual(await readlistOnly.standing(), { removedByReader: false, savedToAll: false, filedInto: [WORK] });
	});
});
