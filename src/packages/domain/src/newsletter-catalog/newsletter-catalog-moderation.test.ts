import assert from "node:assert/strict";
import { ForwardableSenderSchema } from "../gmail/build-forwarding-filter-query";
import {
	approveRecord,
	correctRecordFrom,
	createRecord,
	editRecord,
	listRecords,
	mergeSeed,
	mergeSubmittedSender,
	reconsiderRecord,
	rejectRecord,
	withdrawRecord,
} from "./newsletter-catalog-moderation";
import {
	NEWSLETTER_ADMIN_PAGE_SIZE,
	NewsletterCatalogDocumentSchema,
	type NewsletterCatalogDocument,
	type NewsletterCatalogRecord,
	NewsletterFromSchema,
	NewsletterNameSchema,
	type NewsletterStatus,
} from "./newsletter-catalog.schema";

const TLDR = ForwardableSenderSchema.parse("dan@tldr.tech");
const BREW = ForwardableSenderSchema.parse("crew@morningbrew.com");
const EARLIER = "2026-09-01T00:00:00.000Z";
const NOW = new Date("2026-09-30T10:00:00.000Z");
const AT = NOW.toISOString();

function record(overrides: Partial<NewsletterCatalogRecord> & { from: NewsletterCatalogRecord["from"] }): NewsletterCatalogRecord {
	return {
		name: undefined,
		status: "pending",
		evidence: [],
		replacedBy: undefined,
		createdAt: EARLIER,
		updatedAt: EARLIER,
		reviewedAt: undefined,
		...overrides,
	};
}

function catalog(...records: NewsletterCatalogRecord[]): NewsletterCatalogDocument {
	return { version: 1, records };
}

function recordOf(result: { ok: true; document: NewsletterCatalogDocument } | { ok: false }, from: string) {
	assert(result.ok, "expected the moderation change to apply");
	NewsletterCatalogDocumentSchema.parse(JSON.parse(JSON.stringify(result.document)));
	return result.document.records.find((candidate) => candidate.from === from);
}

describe("NewsletterCatalogDocumentSchema", () => {
	it("refuses a document that lists the same FROM address twice", () => {
		const duplicated = catalog(record({ from: TLDR }), record({ from: TLDR, status: "approved" }));

		assert.equal(NewsletterCatalogDocumentSchema.safeParse(duplicated).success, false);
	});
});

describe("mergeSubmittedSender", () => {
	it("adds an unknown sender as a pending record carrying the reader's submission", () => {
		const result = mergeSubmittedSender(catalog(), { from: TLDR, now: NOW });

		assert.deepEqual(recordOf(result, TLDR), {
			from: TLDR,
			name: undefined,
			status: "pending",
			evidence: [{ kind: "user-submission", url: undefined, note: undefined, addedAt: AT }],
			replacedBy: undefined,
			createdAt: AT,
			updatedAt: AT,
			reviewedAt: undefined,
		});
	});

	it("leaves an approved record and its name untouched", () => {
		const approved = record({ from: TLDR, status: "approved", name: NewsletterNameSchema.parse("TLDR") });

		assert.deepEqual(mergeSubmittedSender(catalog(approved), { from: TLDR, now: NOW }), { ok: false, reason: "unchanged" });
	});

	it("never reopens a rejected record", () => {
		const rejected = record({ from: TLDR, status: "rejected" });

		assert.deepEqual(mergeSubmittedSender(catalog(rejected), { from: TLDR, now: NOW }), { ok: false, reason: "unchanged" });
	});

	describe("under an approved wildcard for the sender's domain", () => {
		const SUBSTACK = NewsletterFromSchema.parse("*@substack.com");
		const MAMUND = ForwardableSenderSchema.parse("mamund@substack.com");
		const substack = record({ from: SUBSTACK, status: "approved", name: NewsletterNameSchema.parse("Substack"), reviewedAt: EARLIER });

		it("adds the sender as approved, named after the wildcard, with a note naming the wildcard it matched", () => {
			const result = mergeSubmittedSender(catalog(substack), { from: MAMUND, now: NOW });

			assert.deepEqual(recordOf(result, MAMUND), {
				from: MAMUND,
				name: "Substack",
				status: "approved",
				evidence: [
					{
						kind: "user-submission",
						url: undefined,
						note: "Approved automatically: matches the approved *@substack.com.",
						addedAt: AT,
					},
				],
				replacedBy: undefined,
				createdAt: AT,
				updatedAt: AT,
				reviewedAt: AT,
			});
			assert.deepEqual(recordOf(result, SUBSTACK), substack);
		});

		it.each([
			["approved", record({ from: MAMUND, status: "approved" })],
			["rejected", record({ from: MAMUND, status: "rejected" })],
			["pending", record({ from: MAMUND, status: "pending" })],
			["replaced by the wildcard", record({ from: MAMUND, status: "rejected", replacedBy: SUBSTACK })],
		])("leaves the sender's own %s record as it is", (_status, own) => {
			assert.deepEqual(mergeSubmittedSender(catalog(own, substack), { from: MAMUND, now: NOW }), { ok: false, reason: "unchanged" });
		});
	});

	it("adds the sender as pending when the wildcard for its domain is not approved", () => {
		const pendingWildcard = record({ from: NewsletterFromSchema.parse("*@tldr.tech"), status: "pending" });

		const result = mergeSubmittedSender(catalog(pendingWildcard), { from: TLDR, now: NOW });

		assert.deepEqual(recordOf(result, TLDR), {
			from: TLDR,
			name: undefined,
			status: "pending",
			evidence: [{ kind: "user-submission", url: undefined, note: undefined, addedAt: AT }],
			replacedBy: undefined,
			createdAt: AT,
			updatedAt: AT,
			reviewedAt: undefined,
		});
	});
});

describe("mergeSeed", () => {
	const seed = {
		version: 1 as const,
		entries: [
			{
				from: TLDR,
				name: NewsletterNameSchema.parse("TLDR"),
				evidence: [{ url: "https://tldr.tech/whitelist", note: "Publisher whitelist page" }],
			},
			{
				from: BREW,
				name: NewsletterNameSchema.parse("Morning Brew"),
				evidence: [{ url: undefined, note: "Supplied user feedback" }],
			},
		],
	};

	it("adds each absent seed entry as pending with its seed evidence", () => {
		const result = mergeSeed(catalog(), seed, NOW);

		assert.deepEqual(recordOf(result, TLDR), {
			from: TLDR,
			name: "TLDR",
			status: "pending",
			evidence: [{ kind: "seed", url: "https://tldr.tech/whitelist", note: "Publisher whitelist page", addedAt: AT }],
			replacedBy: undefined,
			createdAt: AT,
			updatedAt: AT,
			reviewedAt: undefined,
		});
		assert.deepEqual(recordOf(result, BREW)?.evidence, [
			{ kind: "seed", url: undefined, note: "Supplied user feedback", addedAt: AT },
		]);
	});

	it("never replaces a record the catalog already holds", () => {
		const approved = record({ from: TLDR, status: "approved", name: NewsletterNameSchema.parse("TL;DR daily") });

		const result = mergeSeed(catalog(approved), seed, NOW);

		assert.deepEqual(recordOf(result, TLDR), approved);
		assert.equal(recordOf(result, BREW)?.status, "pending");
	});

	it("reports an import of an already-imported seed as unchanged", () => {
		const imported = mergeSeed(catalog(), seed, NOW);
		assert(imported.ok);

		assert.deepEqual(mergeSeed(imported.document, seed, NOW), { ok: false, reason: "unchanged" });
	});
});

describe("createRecord", () => {
	it("creates a pending record with the admin's evidence", () => {
		const result = createRecord(catalog(), {
			from: TLDR,
			name: NewsletterNameSchema.parse("TLDR"),
			evidence: { url: "https://tldr.tech/whitelist", note: "Checked the FROM header" },
			now: NOW,
		});

		assert.deepEqual(recordOf(result, TLDR), {
			from: TLDR,
			name: "TLDR",
			status: "pending",
			evidence: [{ kind: "admin", url: "https://tldr.tech/whitelist", note: "Checked the FROM header", addedAt: AT }],
			replacedBy: undefined,
			createdAt: AT,
			updatedAt: AT,
			reviewedAt: undefined,
		});
	});

	it("refuses a FROM address the catalog already holds", () => {
		const result = createRecord(catalog(record({ from: TLDR })), {
			from: TLDR,
			name: undefined,
			evidence: { url: undefined, note: undefined },
			now: NOW,
		});

		assert.deepEqual(result, { ok: false, reason: "duplicate" });
	});
});

describe("editRecord", () => {
	const existing = record({
		from: TLDR,
		status: "approved",
		name: NewsletterNameSchema.parse("TLDR"),
		evidence: [{ kind: "seed", url: undefined, note: "Seeded", addedAt: EARLIER }],
	});

	it("renames a record and appends the admin's new evidence without changing its status", () => {
		const result = editRecord(catalog(existing), {
			from: TLDR,
			name: NewsletterNameSchema.parse("TLDR Tech"),
			evidenceNote: "Re-checked header",
			evidenceUrl: undefined,
			expectedUpdatedAt: EARLIER,
			now: NOW,
		});

		assert.deepEqual(recordOf(result, TLDR), {
			...existing,
			name: "TLDR Tech",
			evidence: [...existing.evidence, { kind: "admin", url: undefined, note: "Re-checked header", addedAt: AT }],
			updatedAt: AT,
		});
	});

	it("keeps the evidence as it was when the edit adds none", () => {
		const result = editRecord(catalog(existing), {
			from: TLDR,
			name: undefined,
			evidenceNote: undefined,
			evidenceUrl: undefined,
			expectedUpdatedAt: EARLIER,
			now: NOW,
		});

		assert.deepEqual(recordOf(result, TLDR), { ...existing, name: undefined, updatedAt: AT });
	});

	it("appends evidence that only carries a URL", () => {
		const result = editRecord(catalog(existing), {
			from: TLDR,
			name: existing.name,
			evidenceNote: undefined,
			evidenceUrl: "https://tldr.tech/whitelist",
			expectedUpdatedAt: EARLIER,
			now: NOW,
		});

		assert.deepEqual(recordOf(result, TLDR)?.evidence.at(-1), {
			kind: "admin",
			url: "https://tldr.tech/whitelist",
			note: undefined,
			addedAt: AT,
		});
	});

	it("refuses an edit made against an older version of the record", () => {
		const result = editRecord(catalog(existing), {
			from: TLDR,
			name: undefined,
			evidenceNote: undefined,
			evidenceUrl: undefined,
			expectedUpdatedAt: "2026-08-01T00:00:00.000Z",
			now: NOW,
		});

		assert.deepEqual(result, { ok: false, reason: "stale" });
	});

	it("refuses an edit of a FROM address the catalog does not hold", () => {
		const result = editRecord(catalog(), {
			from: TLDR,
			name: undefined,
			evidenceNote: undefined,
			evidenceUrl: undefined,
			expectedUpdatedAt: EARLIER,
			now: NOW,
		});

		assert.deepEqual(result, { ok: false, reason: "missing" });
	});
});

describe("review transitions", () => {
	const review = { from: TLDR, expectedUpdatedAt: EARLIER, now: NOW };
	const moves = [
		{ action: approveRecord, from: "pending", to: "approved" },
		{ action: rejectRecord, from: "pending", to: "rejected" },
		{ action: withdrawRecord, from: "approved", to: "rejected" },
		{ action: reconsiderRecord, from: "rejected", to: "pending" },
	] satisfies { action: typeof approveRecord; from: NewsletterStatus; to: NewsletterStatus }[];

	for (const move of moves) {
		it(`${move.action.name} moves a ${move.from} record to ${move.to} and stamps the review`, () => {
			const existing = record({ from: TLDR, status: move.from });

			const result = move.action(catalog(existing), review);

			assert.deepEqual(recordOf(result, TLDR), { ...existing, status: move.to, updatedAt: AT, reviewedAt: AT });
		});

		it(`${move.action.name} refuses a record that is not ${move.from}`, () => {
			const other = (["pending", "approved", "rejected"] as const).find((status) => status !== move.from && status !== move.to);
			assert(other);

			assert.deepEqual(move.action(catalog(record({ from: TLDR, status: other })), review), {
				ok: false,
				reason: "invalid-transition",
			});
		});

		it(`${move.action.name} refuses a review of an older version of the record`, () => {
			const existing = record({ from: TLDR, status: move.from, updatedAt: AT });

			assert.deepEqual(move.action(catalog(existing), review), { ok: false, reason: "stale" });
		});

		it(`${move.action.name} refuses a FROM address the catalog does not hold`, () => {
			assert.deepEqual(move.action(catalog(), review), { ok: false, reason: "missing" });
		});
	}
});

describe("reconsiderRecord", () => {
	it("keeps a record replaced by a corrected FROM rejected", () => {
		const typo = ForwardableSenderSchema.parse("dan@tldr.tec");
		const replaced = record({ from: typo, status: "rejected", replacedBy: TLDR });

		const result = reconsiderRecord(catalog(replaced, record({ from: TLDR })), { from: typo, expectedUpdatedAt: EARLIER, now: NOW });

		assert.deepEqual(result, { ok: false, reason: "invalid-transition" });
	});
});

describe("correctRecordFrom", () => {
	const typo = ForwardableSenderSchema.parse("dan@tldr.tec");
	const existing = record({
		from: typo,
		status: "approved",
		name: NewsletterNameSchema.parse("TLDR"),
		evidence: [{ kind: "seed", url: undefined, note: "Seeded", addedAt: EARLIER }],
	});

	it("creates the corrected FROM as a pending record and rejects the old one as replaced", () => {
		const result = correctRecordFrom(catalog(existing), { from: typo, newFrom: TLDR, expectedUpdatedAt: EARLIER, now: NOW });

		assert.deepEqual(recordOf(result, TLDR), {
			from: TLDR,
			name: "TLDR",
			status: "pending",
			evidence: [...existing.evidence, { kind: "admin", url: undefined, note: "Corrected from dan@tldr.tec", addedAt: AT }],
			replacedBy: undefined,
			createdAt: AT,
			updatedAt: AT,
			reviewedAt: undefined,
		});
		assert.deepEqual(recordOf(result, typo), {
			...existing,
			status: "rejected",
			replacedBy: TLDR,
			updatedAt: AT,
			reviewedAt: AT,
		});
	});

	it("refuses a correction onto a FROM address the catalog already holds", () => {
		const result = correctRecordFrom(catalog(existing, record({ from: TLDR })), {
			from: typo,
			newFrom: TLDR,
			expectedUpdatedAt: EARLIER,
			now: NOW,
		});

		assert.deepEqual(result, { ok: false, reason: "duplicate" });
	});

	it("refuses a correction made against an older version of the record", () => {
		const result = correctRecordFrom(catalog(existing), { from: typo, newFrom: TLDR, expectedUpdatedAt: AT, now: NOW });

		assert.deepEqual(result, { ok: false, reason: "stale" });
	});

	it("refuses a correction of a FROM address the catalog does not hold", () => {
		const result = correctRecordFrom(catalog(), { from: typo, newFrom: TLDR, expectedUpdatedAt: EARLIER, now: NOW });

		assert.deepEqual(result, { ok: false, reason: "missing" });
	});
});

describe("listRecords", () => {
	const first = record({ from: ForwardableSenderSchema.parse("a@first.com"), createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-05T00:00:00.000Z" });
	const second = record({
		from: ForwardableSenderSchema.parse("b@second.com"),
		name: NewsletterNameSchema.parse("Second Weekly"),
		createdAt: "2026-09-02T00:00:00.000Z",
		updatedAt: "2026-09-03T00:00:00.000Z",
	});
	const approvedOld = record({ from: ForwardableSenderSchema.parse("c@old.com"), status: "approved", updatedAt: "2026-09-01T00:00:00.000Z" });
	const approvedNew = record({ from: ForwardableSenderSchema.parse("d@new.com"), status: "approved", updatedAt: "2026-09-10T00:00:00.000Z" });
	const rejected = record({ from: ForwardableSenderSchema.parse("e@spam.com"), status: "rejected", updatedAt: "2026-09-08T00:00:00.000Z" });
	const document = catalog(second, approvedOld, rejected, first, approvedNew);

	it("lists pending records oldest-submitted first so the queue is worked in order", () => {
		const listed = listRecords(document, { listStatus: "pending", q: "", page: 1 });

		assert.deepEqual(listed, { records: [first, second], total: 2, page: 1, totalPages: 1 });
	});

	it("lists reviewed records most recently changed first", () => {
		const listed = listRecords(document, { listStatus: "approved", q: "", page: 1 });

		assert.deepEqual(listed.records, [approvedNew, approvedOld]);
	});

	it("lists every status together on the all tab, most recently changed first", () => {
		const listed = listRecords(document, { listStatus: "all", q: "", page: 1 });

		assert.deepEqual(listed.records, [approvedNew, rejected, first, second, approvedOld]);
	});

	it("searches the FROM address and name case-insensitively", () => {
		assert.deepEqual(listRecords(document, { listStatus: "all", q: "  WEEKLY ", page: 1 }).records, [second]);
		assert.deepEqual(listRecords(document, { listStatus: "all", q: "spam.com", page: 1 }).records, [rejected]);
	});

	it("pages the list and clamps a page past the end to the last page", () => {
		const many = catalog(
			...Array.from({ length: NEWSLETTER_ADMIN_PAGE_SIZE + 1 }, (_, index) =>
				record({
					from: ForwardableSenderSchema.parse(`sender${String(index).padStart(2, "0")}@example.com`),
					createdAt: `2026-09-01T00:00:${String(index % 60).padStart(2, "0")}.000Z`,
				}),
			),
		);

		const lastPage = listRecords(many, { listStatus: "pending", q: "", page: 9 });

		assert.equal(lastPage.page, 2);
		assert.equal(lastPage.totalPages, 2);
		assert.equal(lastPage.total, NEWSLETTER_ADMIN_PAGE_SIZE + 1);
		assert.deepEqual(
			lastPage.records.map((listed) => listed.from),
			["sender50@example.com"],
		);
	});

	it("shows a single empty page when nothing matches", () => {
		assert.deepEqual(listRecords(document, { listStatus: "pending", q: "nothing", page: 0 }), {
			records: [],
			total: 0,
			page: 1,
			totalPages: 1,
		});
	});
});
