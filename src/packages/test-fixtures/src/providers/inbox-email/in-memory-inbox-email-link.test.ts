import assert from "node:assert/strict";
import {
	EmailLinkOrdinalSchema,
	type InboxEmailLinkEntry,
} from "@packages/domain/inbox";
import { ReadlistPurposeVersionSchema, ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryInboxEmailLink } from "./in-memory-inbox-email-link";

const owner = UserIdSchema.parse("00000000000000000000000000000001");
const otherUser = UserIdSchema.parse("00000000000000000000000000000002");
const RAM = "2026-06-23T00:00:00.000Z#<m-1@example.com>";
const WORK = ReadlistSlugSchema.parse("a1b2c3d4");

function makeLink(
	overrides: Partial<InboxEmailLinkEntry> = {},
): InboxEmailLinkEntry {
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
		anchorText: undefined,
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

	it("returns a link's anchor text as stored", async () => {
		const store = initInMemoryInboxEmailLink();
		await store.putLink(makeLink({ anchorText: "Ship small PRs" }));

		const found = await store.getLink({
			userId: owner,
			receivedAtMessageId: RAM,
			ordinal: EmailLinkOrdinalSchema.parse("0000"),
		});

		expect(found?.anchorText).toBe("Ship small PRs");
	});

	it("reports a re-inserted ordinal as a duplicate without overwriting", async () => {
		const store = initInMemoryInboxEmailLink();
		await store.putLink(makeLink());

		expect(
			await store.putLink(makeLink({ url: "https://tampered.test" })),
		).toBe("duplicate");

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
		await store.putLink(
			makeLink({ ordinal: EmailLinkOrdinalSchema.parse("0002") }),
		);
		await store.putLink(
			makeLink({ ordinal: EmailLinkOrdinalSchema.parse("0000") }),
		);
		await store.putLink(
			makeLink({ ordinal: EmailLinkOrdinalSchema.parse("0001") }),
		);
		await store.putLink(
			makeLink({
				userId: otherUser,
				ordinal: EmailLinkOrdinalSchema.parse("0000"),
			}),
		);

		const { links, meta } = await store.listLinksByEmail({
			userId: owner,
			receivedAtMessageId: RAM,
		});

		expect(links.map((l) => l.ordinal)).toEqual(["0000", "0001", "0002"]);
		expect(meta).toBeUndefined();
	});

	it("round-trips the truncated meta item per email", async () => {
		const store = initInMemoryInboxEmailLink();
		await store.putLinksMeta({
			userId: owner,
			receivedAtMessageId: RAM,
			meta: {
				truncated: true,
				extractionFailed: false,
			},
		});

		const { meta } = await store.listLinksByEmail({
			userId: owner,
			receivedAtMessageId: RAM,
		});
		expect(meta).toEqual({
			truncated: true,
			extractionFailed: false,
		});
		expect(await store.findLinksMeta({ userId: owner, receivedAtMessageId: RAM })).toEqual(meta);
		expect(await store.findLinksMeta({ userId: otherUser, receivedAtMessageId: RAM })).toBeUndefined();
	});

	it("writes a give-up barrier when extraction has not already reported", async () => {
		const store = initInMemoryInboxEmailLink();

		const result = await store.markLinksExtractionFailed({
			userId: owner,
			receivedAtMessageId: RAM,
		});

		expect(result).toBe("stored");
		const { meta } = await store.listLinksByEmail({
			userId: owner,
			receivedAtMessageId: RAM,
		});
		expect(meta).toEqual({
			truncated: false,
			extractionFailed: true,
		});
	});

	it("leaves a completed extraction's barrier untouched when a duplicate delivery gives up", async () => {
		const store = initInMemoryInboxEmailLink();
		await store.putLinksMeta({
			userId: owner,
			receivedAtMessageId: RAM,
			meta: {
				truncated: true,
				extractionFailed: false,
			},
		});

		const result = await store.markLinksExtractionFailed({
			userId: owner,
			receivedAtMessageId: RAM,
		});

		expect(result).toBe("superseded");
		const { meta } = await store.listLinksByEmail({
			userId: owner,
			receivedAtMessageId: RAM,
		});
		expect(meta).toEqual({
			truncated: true,
			extractionFailed: false,
		});
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
		expect(found.resolvedUrl).toBe(
			"https://destination.test/the-actual-article",
		);
		expect(found.failureReason).toBeUndefined();
	});

	it("clears the skip reason when an outcome lands on a skipped row", async () => {
		const store = initInMemoryInboxEmailLink();
		await store.putLink(
			makeLink({ status: "skipped", skipReason: "list-unsubscribe" }),
		);

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
			makeLink({
				status: "crawled",
				title: "stale",
				resolvedUrl: "https://destination.test/stale",
			}),
		);

		await store.setLinkOutcome({
			userId: owner,
			receivedAtMessageId: RAM,
			ordinal: EmailLinkOrdinalSchema.parse("0000"),
			outcome: { status: "failed", failureReason: "crawl-failed", resolvedUrl: undefined },
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

	it("keeps the destination a failed preview reached after a tracker redirect", async () => {
		const store = initInMemoryInboxEmailLink();
		await store.putLink(makeLink({ status: "pending" }));

		await store.setLinkOutcome({
			userId: owner,
			receivedAtMessageId: RAM,
			ordinal: EmailLinkOrdinalSchema.parse("0000"),
			outcome: {
				status: "failed",
				failureReason: "blocked",
				resolvedUrl: "https://www.telegraph.test/news/the-actual-article",
			},
		});

		const found = await store.getLink({
			userId: owner,
			receivedAtMessageId: RAM,
			ordinal: EmailLinkOrdinalSchema.parse("0000"),
		});
		assert(found);
		expect(found.status).toBe("failed");
		expect(found.resolvedUrl).toBe("https://www.telegraph.test/news/the-actual-article");
	});

	describe("deleteLinksByEmail", () => {
		it("removes every link and the meta row for one email, leaving another email untouched", async () => {
			const store = initInMemoryInboxEmailLink();
			const otherRam = "2026-06-24T00:00:00.000Z#<m-2@example.com>";
			await store.putLink(
				makeLink({ ordinal: EmailLinkOrdinalSchema.parse("0000") }),
			);
			await store.putLink(
				makeLink({ ordinal: EmailLinkOrdinalSchema.parse("0001") }),
			);
			await store.putLinksMeta({
				userId: owner,
				receivedAtMessageId: RAM,
				meta: {
					truncated: true,
					extractionFailed: false,
				},
			});
			await store.putLink(makeLink({ receivedAtMessageId: otherRam }));

			await store.deleteLinksByEmail({
				userId: owner,
				receivedAtMessageId: RAM,
			});

			const cleared = await store.listLinksByEmail({
				userId: owner,
				receivedAtMessageId: RAM,
			});
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
			await store.putLink(
				makeLink({ userId: otherUser, receivedAtMessageId: ramA }),
			);

			await store.deleteAllLinksByUserId(owner, [ramA, ramB]);

			expect(
				(
					await store.listLinksByEmail({
						userId: owner,
						receivedAtMessageId: ramA,
					})
				).links,
			).toHaveLength(0);
			expect(
				(
					await store.listLinksByEmail({
						userId: owner,
						receivedAtMessageId: ramB,
					})
				).links,
			).toHaveLength(0);
			expect(
				(
					await store.listLinksByEmail({
						userId: otherUser,
						receivedAtMessageId: ramA,
					})
				).links,
			).toHaveLength(1);
		});
	});
});

it("keeps Gmail list results independent, preserves the first selection, and removes them with their email", async () => {
	const store = initInMemoryInboxEmailLink();
	const second = ReadlistSlugSchema.parse("science");
	const key = { userId: owner, receivedAtMessageId: RAM };
	const outcome = {
		readlist: WORK,
		readlistLabel: "Work",
		decision: "no-purpose" as const,
		fit: [],
	};
	await store.putLinksMeta({
		...key,
		meta: {
			truncated: false,
			extractionFailed: false,
			selectedReadlists: [{ readlist: WORK, label: "Work" }],
		},
	});
	expect(await store.putReadlistOutcome({ ...key, outcome })).toBe("stored");
	expect(await store.putReadlistOutcome({ ...key, outcome })).toBe("duplicate");
	await store.putLinksMeta({
		...key,
		meta: {
			truncated: false,
			extractionFailed: false,
			selectedReadlists: [{ readlist: second, label: "Science" }],
		},
	});
	expect((await store.listLinksByEmail(key)).meta).toEqual({
		truncated: false,
		extractionFailed: false,
		selectedReadlists: [{ readlist: WORK, label: "Work" }],
		readlistOutcomes: [outcome],
	});
	await store.deleteLinksByEmail(key);
	await store.putLinksMeta({
		...key,
		meta: {
			truncated: false,
			extractionFailed: false,
			selectedReadlists: [{ readlist: WORK, label: "Work" }],
		},
	});
	expect((await store.listLinksByEmail(key)).meta?.readlistOutcomes).toEqual(
		[],
	);
});

it("lets a decided list result replace a failed one", async () => {
	const store = initInMemoryInboxEmailLink();
	const key = { userId: owner, receivedAtMessageId: RAM };
	const failed = { readlist: WORK, readlistLabel: "Work", decision: "failed" as const, fit: [] };
	const decided = { readlist: WORK, readlistLabel: "Work", decision: "no-purpose" as const, fit: [] };
	await store.putLinksMeta({
		...key,
		meta: { truncated: false, extractionFailed: false, selectedReadlists: [{ readlist: WORK, label: "Work" }] },
	});
	expect(await store.putReadlistOutcome({ ...key, outcome: failed })).toBe("stored");
	expect(await store.putReadlistOutcome({ ...key, outcome: decided })).toBe("stored");
	expect((await store.listLinksByEmail(key)).meta?.readlistOutcomes).toEqual([decided]);
});

it("never lets a failed list result replace a decided one", async () => {
	const store = initInMemoryInboxEmailLink();
	const key = { userId: owner, receivedAtMessageId: RAM };
	const failed = { readlist: WORK, readlistLabel: "Work", decision: "failed" as const, fit: [] };
	const decided = { readlist: WORK, readlistLabel: "Work", decision: "no-purpose" as const, fit: [] };
	await store.putLinksMeta({
		...key,
		meta: { truncated: false, extractionFailed: false, selectedReadlists: [{ readlist: WORK, label: "Work" }] },
	});
	expect(await store.putReadlistOutcome({ ...key, outcome: decided })).toBe("stored");
	expect(await store.putReadlistOutcome({ ...key, outcome: failed })).toBe("duplicate");
	expect((await store.listLinksByEmail(key)).meta?.readlistOutcomes).toEqual([decided]);
});

it("round-trips a Gmail list result with every verdict, and one without a purpose version, engine or model", async () => {
	const store = initInMemoryInboxEmailLink();
	const key = { userId: owner, receivedAtMessageId: RAM };
	const decided = {
		readlist: WORK,
		readlistLabel: "Work",
		decision: "filtered" as const,
		fit: [
			{ ordinal: EmailLinkOrdinalSchema.parse("0000"), verdict: "keep" as const, reason: "On topic" },
			{ ordinal: EmailLinkOrdinalSchema.parse("0001"), verdict: "drop" as const, reason: "Outside this list" },
			{ ordinal: EmailLinkOrdinalSchema.parse("0002"), verdict: "unsure" as const, reason: "Could go either way" },
		],
		purposeVersion: ReadlistPurposeVersionSchema.parse("0123456789ab"),
		engine: "deepseek-flash",
		model: "deepseek-v4-flash",
	};
	const noPurpose = {
		readlist: ReadlistSlugSchema.parse("science"),
		readlistLabel: "Science",
		decision: "no-purpose" as const,
		fit: [],
	};
	await store.putLinksMeta({
		...key,
		meta: { truncated: false, extractionFailed: false, selectedReadlists: [{ readlist: WORK, label: "Work" }] },
	});
	await store.putReadlistOutcome({ ...key, outcome: decided });
	await store.putReadlistOutcome({ ...key, outcome: noPurpose });
	const outcomes = (await store.listLinksByEmail(key)).meta?.readlistOutcomes;
	expect(outcomes).toEqual([decided, noPurpose]);
	expect(outcomes?.[1]).not.toHaveProperty("purposeVersion");
	expect(outcomes?.[1]).not.toHaveProperty("engine");
	expect(outcomes?.[1]).not.toHaveProperty("model");
});

it("preserves the accepted Gmail eligibility count and held flag when extraction retries", async () => {
	const store = initInMemoryInboxEmailLink();
	const key = { userId: owner, receivedAtMessageId: RAM };
	const first = { truncated: false, extractionFailed: false, selectedReadlists: [{ readlist: WORK, label: "Work" }], eligibleArticleCount: 0, savesHeld: true };
	await store.putLinksMeta({ ...key, meta: first });
	await store.putLinksMeta({ ...key, meta: { ...first, eligibleArticleCount: 1, savesHeld: false } });
	expect((await store.listLinksByEmail(key)).meta).toEqual({ ...first, readlistOutcomes: [] });
});

it("preserves the first record of where a Gmail issue went when extraction retries", async () => {
	const store = initInMemoryInboxEmailLink();
	const key = { userId: owner, receivedAtMessageId: RAM };
	const first = { truncated: false, extractionFailed: false, issueSave: { readlists: [{ readlist: WORK, label: "Work" }], held: false } };
	await store.putLinksMeta({ ...key, meta: first });
	await store.putLinksMeta({ ...key, meta: { ...first, issueSave: { readlists: [], held: true } } });
	expect((await store.listLinksByEmail(key)).meta).toEqual(first);
});

it("advances the stored extraction window only once per continuation", async () => {
	const store = initInMemoryInboxEmailLink();
	const key = { userId: owner, receivedAtMessageId: RAM };
	const first = { truncated: true, extractionFailed: false, extractionWindow: { start: 0, end: 300 } };
	const next = { truncated: false, extractionFailed: false, extractionWindow: { start: 300, end: 301 }, eligibleArticleCount: 1 };
	await store.putLinksMeta({ ...key, meta: first });
	await store.markWindowDispatched({ ...key, end: 300 });
	await store.putLinksMeta({ ...key, meta: next });
	await store.putLinksMeta({ ...key, meta: next });
	await store.markWindowDispatched({ ...key, end: 301 });
	await store.markWindowDispatched({ ...key, end: 300 });
	expect(await store.findLinksMeta(key)).toEqual({ ...next, dispatchedThrough: 301 });
});

describe("rescueSkippedLink", () => {
	it("moves a skipped link to pending once, clearing its skip reason", async () => {
		const store = initInMemoryInboxEmailLink();
		const link = makeLink({ status: "skipped", skipReason: "llm-noise" });
		await store.putLink(link);
		const key = { userId: owner, receivedAtMessageId: RAM, ordinal: link.ordinal };

		expect(await store.rescueSkippedLink(key)).toBe("rescued");
		expect(await store.getLink(key)).toEqual({ ...link, status: "pending", skipReason: undefined });
		expect(await store.rescueSkippedLink(key)).toBe("not-skipped");
	});

	it("reports not-skipped for a missing link", async () => {
		const store = initInMemoryInboxEmailLink();
		expect(
			await store.rescueSkippedLink({ userId: owner, receivedAtMessageId: RAM, ordinal: EmailLinkOrdinalSchema.parse("0000") }),
		).toBe("not-skipped");
	});
});

describe("addEligibleArticle", () => {
	const key = { userId: owner, receivedAtMessageId: RAM };

	it("adds one to the eligible count of an email with selected readlists", async () => {
		const store = initInMemoryInboxEmailLink();
		await store.putLinksMeta({
			...key,
			meta: { truncated: false, extractionFailed: false, selectedReadlists: [{ readlist: WORK, label: "Work" }], eligibleArticleCount: 2 },
		});
		await store.addEligibleArticle(key);
		expect((await store.findLinksMeta(key))?.eligibleArticleCount).toBe(3);
	});

	it("starts the count at one when none was recorded", async () => {
		const store = initInMemoryInboxEmailLink();
		await store.putLinksMeta({
			...key,
			meta: { truncated: false, extractionFailed: false, selectedReadlists: [{ readlist: WORK, label: "Work" }] },
		});
		await store.addEligibleArticle(key);
		expect((await store.findLinksMeta(key))?.eligibleArticleCount).toBe(1);
	});

	it("leaves an email without selected readlists unchanged", async () => {
		const store = initInMemoryInboxEmailLink();
		await store.putLinksMeta({ ...key, meta: { truncated: false, extractionFailed: false } });
		await store.addEligibleArticle(key);
		expect(await store.findLinksMeta(key)).toEqual({ truncated: false, extractionFailed: false });
	});
});

describe("mergeReadlistOutcomeFit", () => {
	const key = { userId: owner, receivedAtMessageId: RAM };
	const kept = { ordinal: EmailLinkOrdinalSchema.parse("0000"), verdict: "keep" as const, reason: "On topic" };
	const rescued = { ordinal: EmailLinkOrdinalSchema.parse("0004"), verdict: "drop" as const, reason: "Off topic" };
	const filtered = { readlist: WORK, readlistLabel: "Work", decision: "filtered" as const, fit: [kept] };

	async function seeded(outcome?: Parameters<ReturnType<typeof initInMemoryInboxEmailLink>["putReadlistOutcome"]>[0]["outcome"]) {
		const store = initInMemoryInboxEmailLink();
		await store.putLinksMeta({
			...key,
			meta: { truncated: false, extractionFailed: false, selectedReadlists: [{ readlist: WORK, label: "Work" }] },
		});
		if (outcome) await store.putReadlistOutcome({ ...key, outcome });
		return store;
	}

	it("appends the entry to a filtered decision", async () => {
		const store = await seeded(filtered);
		expect(await store.mergeReadlistOutcomeFit({ ...key, readlist: WORK, entry: rescued })).toBe("merged");
		expect((await store.listLinksByEmail(key)).meta?.readlistOutcomes).toEqual([{ ...filtered, fit: [kept, rescued] }]);
	});

	it("merges a decision into the continuation without replacing the initial result", async () => {
		const latest = { ...filtered, startIndex: 300, fit: [] };
		const store = await seeded(filtered);
		await store.putReadlistOutcome({ ...key, outcome: latest });
		expect(await store.mergeReadlistOutcomeFit({ ...key, readlist: WORK, startIndex: 300, entry: rescued })).toBe("merged");
		expect((await store.listLinksByEmail(key)).meta?.readlistOutcomes).toEqual([filtered, { ...latest, fit: [rescued] }]);
	});

	it("keeps an existing entry for the same link", async () => {
		const store = await seeded(filtered);
		expect(
			await store.mergeReadlistOutcomeFit({ ...key, readlist: WORK, entry: { ...kept, verdict: "drop" } }),
		).toBe("already-decided");
		expect((await store.listLinksByEmail(key)).meta?.readlistOutcomes).toEqual([filtered]);
	});

	it("reports not-filtered when the readlist has no decision or a different one", async () => {
		expect(await (await seeded()).mergeReadlistOutcomeFit({ ...key, readlist: WORK, entry: rescued })).toBe("not-filtered");
		const failed = await seeded({ ...filtered, decision: "failed", fit: [] });
		expect(await failed.mergeReadlistOutcomeFit({ ...key, readlist: WORK, entry: rescued })).toBe("not-filtered");
	});
});
