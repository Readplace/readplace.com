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
const OTHER_USER_ID = UserIdSchema.parse("user_other");
const OTHERS_PRIVATE_URL = "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef";
const OWN_PRIVATE_URL = "https://uploads.readplace.invalid/fedcba9876543210fedcba9876543210";

function build() {
	const articleStore = initInMemoryArticleStore();
	const store = initInMemoryPastReads({
		findArticleByUrl: articleStore.findArticleByUrl,
		findArticleById: articleStore.findArticleById,
		findItemOwner: articleStore.findItemOwner,
	});

	async function save(params: { url: string; title: string; savedAt?: Date }) {
		const { saved } = await articleStore.saveArticle({
			userId: USER_ID,
			url: params.url,
			metadata: { title: params.title, siteName: "Example", excerpt: "An excerpt", wordCount: 400 },
			estimatedReadTime: MinutesSchema.parse(2),
			provenance: { kind: "web" },
			savedAt: params.savedAt ?? new Date(),
			saveTrigger: "manual",
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

	it("drops a past read of a webmail page", async () => {
		const { articleStore, store, save } = build();
		await save({ url: URL, title: "Target" });
		const webmail = await save({ url: "https://mail.google.com/mail/u/2/", title: "Inbox (12)" });
		const kept = await save({ url: PAST_URL, title: "Read earlier" });
		await articleStore.updateArticleStatus(webmail.id, USER_ID, "read");
		await articleStore.updateArticleStatus(kept.id, USER_ID, "read");
		await store.markPastReadsReady({
			userId: USER_ID,
			url: URL,
			pastReads: [
				{ url: "https://mail.google.com/mail/u/2/", reason: "Inbox" },
				{ url: PAST_URL, reason: "Same subject" },
			],
			fingerprint: "fp",
			inputTokens: 1,
			outputTokens: 1,
			at: AT,
		});

		const result = await store.findPastReads({ userId: USER_ID, url: URL });

		assert(result.status === "ready", "a settled computation reports ready");
		expect(result.items.map((item) => item.id)).toEqual([kept.id]);
	});

	it("drops a past read of another reader's private upload and keeps the reader's own", async () => {
		const { articleStore, store, save } = build();
		await save({ url: URL, title: "Target" });
		const theirs = await save({ url: OTHERS_PRIVATE_URL, title: "Their book" });
		await articleStore.recordItemOwner({ url: OTHERS_PRIVATE_URL, ownerUserId: OTHER_USER_ID });
		const own = await save({ url: OWN_PRIVATE_URL, title: "My book" });
		await articleStore.recordItemOwner({ url: OWN_PRIVATE_URL, ownerUserId: USER_ID });
		await articleStore.updateArticleStatus(theirs.id, USER_ID, "read");
		await articleStore.updateArticleStatus(own.id, USER_ID, "read");
		await store.markPastReadsReady({
			userId: USER_ID,
			url: URL,
			pastReads: [
				{ url: OTHERS_PRIVATE_URL, reason: "Their upload" },
				{ url: OWN_PRIVATE_URL, reason: "My upload" },
			],
			fingerprint: "fp",
			inputTokens: 1,
			outputTokens: 1,
			at: AT,
		});

		const result = await store.findPastReads({ userId: USER_ID, url: URL });

		assert(result.status === "ready", "a settled computation reports ready");
		expect(result.items.map((item) => item.id)).toEqual([own.id]);
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

	describe("budget blocks", () => {
		const SAVED_AT = new Date("2026-09-10T00:00:00.000Z");
		const UNTIL = new Date("2026-09-13T00:00:00.000Z");

		async function buildSaved() {
			const built = build();
			await built.save({ url: URL, title: "Target", savedAt: SAVED_AT });
			return built;
		}

		async function settle(store: ReturnType<typeof build>["store"]) {
			await store.markPastReadsReady({
				userId: USER_ID,
				url: URL,
				pastReads: [],
				fingerprint: "fp",
				inputTokens: 1,
				outputTokens: 1,
				at: AT,
			});
		}

		it("reports the budget limit when a block is recorded before anything was computed", async () => {
			const { store } = await buildSaved();

			const outcome = await store.markPastReadsBudgetBlocked({
				userId: USER_ID,
				url: URL,
				blockedUntil: UNTIL,
				observed: { savedAt: SAVED_AT },
			});

			expect(outcome).toBe("stored");
			expect(await store.findPastReads({ userId: USER_ID, url: URL })).toEqual({
				status: "budget-limited",
				until: UNTIL,
			});
			expect(await store.readPastReadsState({ userId: USER_ID, url: URL })).toEqual({
				savedAt: SAVED_AT,
				budgetBlockedUntil: UNTIL,
			});
		});

		it("keeps a settled result visible alongside a block recorded against it", async () => {
			const { store } = await buildSaved();
			await settle(store);

			const outcome = await store.markPastReadsBudgetBlocked({
				userId: USER_ID,
				url: URL,
				blockedUntil: UNTIL,
				observed: { savedAt: SAVED_AT, computedAt: AT },
			});

			expect(outcome).toBe("stored");
			expect(await store.findPastReads({ userId: USER_ID, url: URL })).toEqual({
				status: "ready",
				items: [],
				budgetBlockedUntil: UNTIL,
			});
			expect(await store.readPastReadsState({ userId: USER_ID, url: URL })).toEqual({
				fingerprint: "fp",
				computedAt: AT,
				savedAt: SAVED_AT,
				budgetBlockedUntil: UNTIL,
			});
		});

		it("reports a block observed against a different computation as superseded", async () => {
			const { store } = await buildSaved();
			await settle(store);

			const outcome = await store.markPastReadsBudgetBlocked({
				userId: USER_ID,
				url: URL,
				blockedUntil: UNTIL,
				observed: { savedAt: SAVED_AT },
			});

			expect(outcome).toBe("superseded");
			expect(await store.findPastReads({ userId: USER_ID, url: URL })).toEqual({
				status: "ready",
				items: [],
			});
		});

		it("keeps a block recorded before the computation settled", async () => {
			const { store } = await buildSaved();
			await store.markPastReadsBudgetBlocked({
				userId: USER_ID,
				url: URL,
				blockedUntil: UNTIL,
				observed: { savedAt: SAVED_AT },
			});

			await settle(store);

			expect(await store.findPastReads({ userId: USER_ID, url: URL })).toEqual({
				status: "ready",
				items: [],
				budgetBlockedUntil: UNTIL,
			});
		});

		it("forgets the block with the row", async () => {
			const { store } = await buildSaved();
			await store.markPastReadsBudgetBlocked({
				userId: USER_ID,
				url: URL,
				blockedUntil: UNTIL,
				observed: { savedAt: SAVED_AT },
			});

			store.forgetRow({ userId: USER_ID, url: URL });

			expect(await store.findPastReads({ userId: USER_ID, url: URL })).toEqual({ status: "pending" });
			expect(await store.readPastReadsState({ userId: USER_ID, url: URL })).toEqual({ savedAt: SAVED_AT });
		});

		it("reports a block observed against a different save as superseded", async () => {
			const { store } = await buildSaved();

			const outcome = await store.markPastReadsBudgetBlocked({
				userId: USER_ID,
				url: URL,
				blockedUntil: UNTIL,
				observed: { savedAt: new Date("2026-09-11T00:00:00.000Z") },
			});

			expect(outcome).toBe("superseded");
			expect(await store.findPastReads({ userId: USER_ID, url: URL })).toEqual({ status: "pending" });
		});

		it("reports a block on a link the reader has not saved as superseded", async () => {
			const { store } = build();

			const outcome = await store.markPastReadsBudgetBlocked({
				userId: USER_ID,
				url: URL,
				blockedUntil: UNTIL,
				observed: { savedAt: SAVED_AT },
			});

			expect(outcome).toBe("superseded");
			expect(await store.readPastReadsState({ userId: USER_ID, url: URL })).toEqual({});
		});
	});
});
