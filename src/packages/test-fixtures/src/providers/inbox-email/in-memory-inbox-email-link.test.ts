import assert from "node:assert/strict";
import {
	EmailLinkOrdinalSchema,
	type InboxEmailLinkEntry,
} from "@packages/domain/inbox";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryInboxEmailLink } from "./in-memory-inbox-email-link";

const owner = UserIdSchema.parse("00000000000000000000000000000001");
const otherUser = UserIdSchema.parse("00000000000000000000000000000002");
const RAM = "2026-06-23T00:00:00.000Z#<m-1@example.com>";
const WORK = ReadlistSlugSchema.parse("a1b2c3d4");
const DROPPED_FOR = { readlist: WORK, readlistLabel: "Work", reason: "A product launch, not practice." };

function makeLink(overrides: Partial<InboxEmailLinkEntry> = {}): InboxEmailLinkEntry {
	return {
		userId: owner,
		receivedAtMessageId: RAM,
		ordinal: EmailLinkOrdinalSchema.parse("0000"),
		url: "https://example.com/post",
		resolvedUrl: undefined,
		status: "pending",
		title: undefined,
		excerpt: undefined,
		siteName: undefined,
		imageUrl: undefined,
		failureReason: undefined,
		skipReason: undefined,
		droppedFor: undefined,
		...overrides,
	};
}

describe("initInMemoryInboxEmailLink", () => {
	it("stores then reads a pending link by ordinal", async () => {
		const store = initInMemoryInboxEmailLink();

		expect(await store.putLink(makeLink())).toBe("stored");
		const found = await store.getLink({
			userId: owner,
			receivedAtMessageId: RAM,
			ordinal: EmailLinkOrdinalSchema.parse("0000"),
		});

		assert(found, "expected the stored link to resolve");
		expect(found.url).toBe("https://example.com/post");
		expect(found.status).toBe("pending");
	});

	it("reports a re-inserted ordinal as a duplicate without overwriting", async () => {
		const store = initInMemoryInboxEmailLink();
		await store.putLink(makeLink());

		expect(await store.putLink(makeLink({ url: "https://tampered.test" }))).toBe("duplicate");

		const found = await store.getLink({
			userId: owner,
			receivedAtMessageId: RAM,
			ordinal: EmailLinkOrdinalSchema.parse("0000"),
		});
		assert(found);
		expect(found.url).toBe("https://example.com/post");
	});

	it("lists a single email's links in ordinal order with no meta by default", async () => {
		const store = initInMemoryInboxEmailLink();
		await store.putLink(makeLink({ ordinal: EmailLinkOrdinalSchema.parse("0002") }));
		await store.putLink(makeLink({ ordinal: EmailLinkOrdinalSchema.parse("0000") }));
		await store.putLink(makeLink({ ordinal: EmailLinkOrdinalSchema.parse("0001") }));
		await store.putLink(
			makeLink({ userId: otherUser, ordinal: EmailLinkOrdinalSchema.parse("0000") }),
		);

		const { links, meta } = await store.listLinksByEmail({ userId: owner, receivedAtMessageId: RAM });

		expect(links.map((l) => l.ordinal)).toEqual(["0000", "0001", "0002"]);
		expect(meta).toBeUndefined();
	});

	it("round-trips the truncated meta item per email", async () => {
		const store = initInMemoryInboxEmailLink();
		await store.putLinksMeta({
			userId: owner,
			receivedAtMessageId: RAM,
			meta: { truncated: true, extractionFailed: false, readlistDecision: undefined },
		});

		const { meta } = await store.listLinksByEmail({ userId: owner, receivedAtMessageId: RAM });
		expect(meta).toEqual({ truncated: true, extractionFailed: false, readlistDecision: undefined });
	});

	it("writes a give-up barrier when extraction has not already reported", async () => {
		const store = initInMemoryInboxEmailLink();

		const result = await store.markLinksExtractionFailed({ userId: owner, receivedAtMessageId: RAM });

		expect(result).toBe("stored");
		const { meta } = await store.listLinksByEmail({ userId: owner, receivedAtMessageId: RAM });
		expect(meta).toEqual({ truncated: false, extractionFailed: true, readlistDecision: undefined });
	});

	it("leaves a completed extraction's barrier untouched when a duplicate delivery gives up", async () => {
		const store = initInMemoryInboxEmailLink();
		await store.putLinksMeta({
			userId: owner,
			receivedAtMessageId: RAM,
			meta: { truncated: true, extractionFailed: false, readlistDecision: undefined },
		});

		const result = await store.markLinksExtractionFailed({ userId: owner, receivedAtMessageId: RAM });

		expect(result).toBe("superseded");
		const { meta } = await store.listLinksByEmail({ userId: owner, receivedAtMessageId: RAM });
		expect(meta).toEqual({ truncated: true, extractionFailed: false, readlistDecision: undefined });
	});

	it("opens a deciding readlist decision on a routed email's barrier", async () => {
		const store = initInMemoryInboxEmailLink();
		await store.putLinksMeta({
			userId: owner,
			receivedAtMessageId: RAM,
			meta: { truncated: false, extractionFailed: false, readlistDecision: { readlist: WORK } },
		});

		const { meta } = await store.listLinksByEmail({ userId: owner, receivedAtMessageId: RAM });
		expect(meta?.readlistDecision).toEqual({ state: "deciding", readlist: WORK });
	});

	it("keeps a settled decision when a redelivered extraction rewrites the barrier", async () => {
		const store = initInMemoryInboxEmailLink();
		const meta = { truncated: false, extractionFailed: false, readlistDecision: { readlist: WORK } };
		await store.putLinksMeta({ userId: owner, receivedAtMessageId: RAM, meta });
		await store.settleReadlistDecision({
			userId: owner,
			receivedAtMessageId: RAM,
			decision: { state: "decided", readlist: WORK, readlistLabel: "Work" },
		});

		await store.putLinksMeta({ userId: owner, receivedAtMessageId: RAM, meta });

		const listed = await store.listLinksByEmail({ userId: owner, receivedAtMessageId: RAM });
		expect(listed.meta?.readlistDecision).toEqual({ state: "decided", readlist: WORK, readlistLabel: "Work" });
	});

	it("keeps an open decision when the barrier is rewritten without one", async () => {
		const store = initInMemoryInboxEmailLink();
		await store.putLinksMeta({
			userId: owner,
			receivedAtMessageId: RAM,
			meta: { truncated: false, extractionFailed: false, readlistDecision: { readlist: WORK } },
		});

		await store.putLinksMeta({
			userId: owner,
			receivedAtMessageId: RAM,
			meta: { truncated: true, extractionFailed: false, readlistDecision: undefined },
		});

		const { meta } = await store.listLinksByEmail({ userId: owner, receivedAtMessageId: RAM });
		expect(meta).toEqual({
			truncated: true,
			extractionFailed: false,
			readlistDecision: { state: "deciding", readlist: WORK },
		});
	});

	it("settles a deciding barrier once, reporting a second settle as already settled", async () => {
		const store = initInMemoryInboxEmailLink();
		await store.putLinksMeta({
			userId: owner,
			receivedAtMessageId: RAM,
			meta: { truncated: false, extractionFailed: false, readlistDecision: { readlist: WORK } },
		});

		const first = await store.settleReadlistDecision({
			userId: owner,
			receivedAtMessageId: RAM,
			decision: { state: "failed", readlist: WORK },
		});
		const second = await store.settleReadlistDecision({
			userId: owner,
			receivedAtMessageId: RAM,
			decision: { state: "decided", readlist: WORK, readlistLabel: "Work" },
		});

		expect([first, second]).toEqual(["settled", "already-settled"]);
		const { meta } = await store.listLinksByEmail({ userId: owner, receivedAtMessageId: RAM });
		expect(meta?.readlistDecision).toEqual({ state: "failed", readlist: WORK });
	});

	it("reports an unrouted barrier as already settled", async () => {
		const store = initInMemoryInboxEmailLink();
		await store.markLinksExtractionFailed({ userId: owner, receivedAtMessageId: RAM });

		const result = await store.settleReadlistDecision({
			userId: owner,
			receivedAtMessageId: RAM,
			decision: { state: "failed", readlist: WORK },
		});

		expect(result).toBe("already-settled");
	});

	it("throws when a decision arrives before the extraction barrier", async () => {
		const store = initInMemoryInboxEmailLink();

		await expect(
			store.settleReadlistDecision({
				userId: owner,
				receivedAtMessageId: RAM,
				decision: { state: "failed", readlist: WORK },
			}),
		).rejects.toThrow("readlist decision arrived before the extraction barrier");
	});

	it("marks a crawled link dropped without touching its preview", async () => {
		const store = initInMemoryInboxEmailLink();
		await store.putLink(makeLink({ status: "crawled", title: "Launch" }));

		const result = await store.markLinkDropped({
			userId: owner,
			receivedAtMessageId: RAM,
			ordinal: EmailLinkOrdinalSchema.parse("0000"),
			droppedFor: DROPPED_FOR,
		});

		expect(result).toBe("marked");
		const found = await store.getLink({
			userId: owner,
			receivedAtMessageId: RAM,
			ordinal: EmailLinkOrdinalSchema.parse("0000"),
		});
		expect(found).toEqual(makeLink({ status: "crawled", title: "Launch", droppedFor: DROPPED_FOR }));
	});

	it("refuses to drop a skipped link", async () => {
		const store = initInMemoryInboxEmailLink();
		await store.putLink(makeLink({ status: "skipped", skipReason: "llm-ad" }));

		const result = await store.markLinkDropped({
			userId: owner,
			receivedAtMessageId: RAM,
			ordinal: EmailLinkOrdinalSchema.parse("0000"),
			droppedFor: DROPPED_FOR,
		});

		expect(result).toBe("not-a-candidate");
	});

	it("refuses to drop a link that was never stored", async () => {
		const store = initInMemoryInboxEmailLink();

		const result = await store.markLinkDropped({
			userId: owner,
			receivedAtMessageId: RAM,
			ordinal: EmailLinkOrdinalSchema.parse("0000"),
			droppedFor: DROPPED_FOR,
		});

		expect(result).toBe("not-a-candidate");
	});

	it("stamps a crawled outcome including a lead image", async () => {
		const store = initInMemoryInboxEmailLink();
		await store.putLink(makeLink());

		await store.setLinkOutcome({
			userId: owner,
			receivedAtMessageId: RAM,
			ordinal: EmailLinkOrdinalSchema.parse("0000"),
			outcome: {
				status: "crawled",
				title: "A title",
				excerpt: "An excerpt",
				siteName: "Example",
				imageUrl: "https://cdn.test/x.jpg",
				resolvedUrl: "https://destination.test/the-actual-article",
			},
		});

		const found = await store.getLink({
			userId: owner,
			receivedAtMessageId: RAM,
			ordinal: EmailLinkOrdinalSchema.parse("0000"),
		});
		assert(found);
		expect(found.status).toBe("crawled");
		expect(found.title).toBe("A title");
		expect(found.imageUrl).toBe("https://cdn.test/x.jpg");
		expect(found.resolvedUrl).toBe("https://destination.test/the-actual-article");
		expect(found.failureReason).toBeUndefined();
	});

	it("clears the skip reason when an outcome lands on a skipped row", async () => {
		const store = initInMemoryInboxEmailLink();
		await store.putLink(makeLink({ status: "skipped", skipReason: "list-unsubscribe" }));

		await store.setLinkOutcome({
			userId: owner,
			receivedAtMessageId: RAM,
			ordinal: EmailLinkOrdinalSchema.parse("0000"),
			outcome: {
				status: "crawled",
				title: "T",
				excerpt: "E",
				siteName: "S",
				imageUrl: undefined,
				resolvedUrl: undefined,
			},
		});

		const found = await store.getLink({
			userId: owner,
			receivedAtMessageId: RAM,
			ordinal: EmailLinkOrdinalSchema.parse("0000"),
		});
		assert(found);
		expect(found.status).toBe("crawled");
		expect(found.skipReason).toBeUndefined();
	});

	it("stamps a failed outcome and clears any preview fields", async () => {
		const store = initInMemoryInboxEmailLink();
		await store.putLink(
			makeLink({ status: "crawled", title: "stale", resolvedUrl: "https://destination.test/stale" }),
		);

		await store.setLinkOutcome({
			userId: owner,
			receivedAtMessageId: RAM,
			ordinal: EmailLinkOrdinalSchema.parse("0000"),
			outcome: { status: "failed", failureReason: "crawl-failed" },
		});

		const found = await store.getLink({
			userId: owner,
			receivedAtMessageId: RAM,
			ordinal: EmailLinkOrdinalSchema.parse("0000"),
		});
		assert(found);
		expect(found.status).toBe("failed");
		expect(found.failureReason).toBe("crawl-failed");
		expect(found.title).toBeUndefined();
		expect(found.resolvedUrl).toBeUndefined();
	});

	describe("deleteLinksByEmail", () => {
		it("removes every link and the meta row for one email, leaving another email untouched", async () => {
			const store = initInMemoryInboxEmailLink();
			const otherRam = "2026-06-24T00:00:00.000Z#<m-2@example.com>";
			await store.putLink(makeLink({ ordinal: EmailLinkOrdinalSchema.parse("0000") }));
			await store.putLink(makeLink({ ordinal: EmailLinkOrdinalSchema.parse("0001") }));
			await store.putLinksMeta({
				userId: owner,
				receivedAtMessageId: RAM,
				meta: { truncated: true, extractionFailed: false, readlistDecision: undefined },
			});
			await store.putLink(makeLink({ receivedAtMessageId: otherRam }));

			await store.deleteLinksByEmail({ userId: owner, receivedAtMessageId: RAM });

			const cleared = await store.listLinksByEmail({ userId: owner, receivedAtMessageId: RAM });
			expect(cleared.links).toHaveLength(0);
			expect(cleared.meta).toBeUndefined();
			const survivor = await store.listLinksByEmail({
				userId: owner,
				receivedAtMessageId: otherRam,
			});
			expect(survivor.links).toHaveLength(1);
		});
	});

	describe("deleteAllLinksByUserId", () => {
		it("clears every provided email's links and leaves another user's links intact", async () => {
			const store = initInMemoryInboxEmailLink();
			const ramA = "2026-06-23T00:00:00.000Z#<a@x>";
			const ramB = "2026-06-24T00:00:00.000Z#<b@x>";
			await store.putLink(makeLink({ receivedAtMessageId: ramA }));
			await store.putLink(makeLink({ receivedAtMessageId: ramB }));
			await store.putLink(makeLink({ userId: otherUser, receivedAtMessageId: ramA }));

			await store.deleteAllLinksByUserId(owner, [ramA, ramB]);

			expect(
				(await store.listLinksByEmail({ userId: owner, receivedAtMessageId: ramA })).links,
			).toHaveLength(0);
			expect(
				(await store.listLinksByEmail({ userId: owner, receivedAtMessageId: ramB })).links,
			).toHaveLength(0);
			expect(
				(await store.listLinksByEmail({ userId: otherUser, receivedAtMessageId: ramA })).links,
			).toHaveLength(1);
		});
	});
});
