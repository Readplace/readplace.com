import type { ForwardableSender } from "../gmail/build-forwarding-filter-query";
import {
	NEWSLETTER_ADMIN_PAGE_SIZE,
	type NewsletterCatalogDocument,
	type NewsletterCatalogRecord,
	type NewsletterCatalogSeed,
	type NewsletterEvidence,
	type NewsletterFrom,
	type NewsletterListStatus,
	type NewsletterName,
	type NewsletterStatus,
} from "./newsletter-catalog.schema";

export type NewsletterModerationFailure = "unchanged" | "duplicate" | "stale" | "missing" | "invalid-transition";

export type NewsletterModerationResult<Reason extends NewsletterModerationFailure = NewsletterModerationFailure> =
	| { ok: true; document: NewsletterCatalogDocument }
	| { ok: false; reason: Reason };

export interface NewsletterEvidenceInput {
	url: string | undefined;
	note: string | undefined;
}

interface ReviewInput {
	from: NewsletterFrom;
	expectedUpdatedAt: string;
	now: Date;
}

function findRecord(document: NewsletterCatalogDocument, from: NewsletterFrom): NewsletterCatalogRecord | undefined {
	return document.records.find((record) => record.from === from);
}

function withRecord(document: NewsletterCatalogDocument, record: NewsletterCatalogRecord): NewsletterCatalogDocument {
	const others = document.records.filter((existing) => existing.from !== record.from);
	return { ...document, records: [...others, record] };
}

function adminEvidence(input: NewsletterEvidenceInput & { now: Date }): NewsletterEvidence {
	return { kind: "admin", url: input.url, note: input.note, addedAt: input.now.toISOString() };
}

function pendingRecord(input: {
	from: NewsletterFrom;
	name: NewsletterName | undefined;
	evidence: NewsletterEvidence[];
	now: Date;
}): NewsletterCatalogRecord {
	const at = input.now.toISOString();
	return {
		from: input.from,
		name: input.name,
		status: "pending",
		evidence: input.evidence,
		replacedBy: undefined,
		createdAt: at,
		updatedAt: at,
		reviewedAt: undefined,
	};
}

function reviewable(
	document: NewsletterCatalogDocument,
	input: ReviewInput,
): { ok: true; record: NewsletterCatalogRecord } | { ok: false; reason: "missing" | "stale" } {
	const record = findRecord(document, input.from);
	if (record === undefined) return { ok: false, reason: "missing" };
	if (record.updatedAt !== input.expectedUpdatedAt) return { ok: false, reason: "stale" };
	return { ok: true, record };
}

export function mergeSubmittedSender(
	document: NewsletterCatalogDocument,
	input: { from: ForwardableSender; now: Date },
): NewsletterModerationResult<"unchanged"> {
	if (findRecord(document, input.from) !== undefined) return { ok: false, reason: "unchanged" };
	const evidence: NewsletterEvidence = { kind: "user-submission", url: undefined, note: undefined, addedAt: input.now.toISOString() };
	return {
		ok: true,
		document: withRecord(document, pendingRecord({ from: input.from, name: undefined, evidence: [evidence], now: input.now })),
	};
}

export function mergeSeed(
	document: NewsletterCatalogDocument,
	seed: NewsletterCatalogSeed,
	now: Date,
): NewsletterModerationResult<"unchanged"> {
	let merged = document;
	for (const entry of seed.entries) {
		if (findRecord(merged, entry.from) !== undefined) continue;
		const evidence = entry.evidence.map(
			(item): NewsletterEvidence => ({ kind: "seed", url: item.url, note: item.note, addedAt: now.toISOString() }),
		);
		merged = withRecord(merged, pendingRecord({ from: entry.from, name: entry.name, evidence, now }));
	}
	if (merged === document) return { ok: false, reason: "unchanged" };
	return { ok: true, document: merged };
}

export function createRecord(
	document: NewsletterCatalogDocument,
	input: { from: NewsletterFrom; name: NewsletterName | undefined; evidence: NewsletterEvidenceInput; now: Date },
): NewsletterModerationResult<"duplicate"> {
	if (findRecord(document, input.from) !== undefined) return { ok: false, reason: "duplicate" };
	const record = pendingRecord({
		from: input.from,
		name: input.name,
		evidence: [adminEvidence({ ...input.evidence, now: input.now })],
		now: input.now,
	});
	return { ok: true, document: withRecord(document, record) };
}

export function editRecord(
	document: NewsletterCatalogDocument,
	input: ReviewInput & { name: NewsletterName | undefined; evidenceNote: string | undefined; evidenceUrl: string | undefined },
): NewsletterModerationResult<"missing" | "stale"> {
	const found = reviewable(document, input);
	if (!found.ok) return found;
	const addsEvidence = input.evidenceNote !== undefined || input.evidenceUrl !== undefined;
	const evidence = addsEvidence
		? [...found.record.evidence, adminEvidence({ url: input.evidenceUrl, note: input.evidenceNote, now: input.now })]
		: found.record.evidence;
	return {
		ok: true,
		document: withRecord(document, { ...found.record, name: input.name, evidence, updatedAt: input.now.toISOString() }),
	};
}

function transition(
	document: NewsletterCatalogDocument,
	input: ReviewInput,
	move: { from: NewsletterStatus; to: NewsletterStatus },
): NewsletterModerationResult<"missing" | "stale" | "invalid-transition"> {
	const found = reviewable(document, input);
	if (!found.ok) return found;
	if (found.record.status !== move.from) return { ok: false, reason: "invalid-transition" };
	const at = input.now.toISOString();
	return { ok: true, document: withRecord(document, { ...found.record, status: move.to, updatedAt: at, reviewedAt: at }) };
}

export function approveRecord(document: NewsletterCatalogDocument, input: ReviewInput) {
	return transition(document, input, { from: "pending", to: "approved" });
}

export function rejectRecord(document: NewsletterCatalogDocument, input: ReviewInput) {
	return transition(document, input, { from: "pending", to: "rejected" });
}

export function withdrawRecord(document: NewsletterCatalogDocument, input: ReviewInput) {
	return transition(document, input, { from: "approved", to: "rejected" });
}

export function reconsiderRecord(
	document: NewsletterCatalogDocument,
	input: ReviewInput,
): NewsletterModerationResult<"missing" | "stale" | "invalid-transition"> {
	if (findRecord(document, input.from)?.replacedBy !== undefined) return { ok: false, reason: "invalid-transition" };
	return transition(document, input, { from: "rejected", to: "pending" });
}

export function correctRecordFrom(
	document: NewsletterCatalogDocument,
	input: ReviewInput & { newFrom: NewsletterFrom },
): NewsletterModerationResult<"missing" | "stale" | "duplicate"> {
	const found = reviewable(document, input);
	if (!found.ok) return found;
	if (findRecord(document, input.newFrom) !== undefined) return { ok: false, reason: "duplicate" };
	const at = input.now.toISOString();
	const corrected = pendingRecord({
		from: input.newFrom,
		name: found.record.name,
		evidence: [
			...found.record.evidence,
			adminEvidence({ url: undefined, note: `Corrected from ${found.record.from}`, now: input.now }),
		],
		now: input.now,
	});
	const replaced: NewsletterCatalogRecord = {
		...found.record,
		status: "rejected",
		replacedBy: input.newFrom,
		updatedAt: at,
		reviewedAt: at,
	};
	return { ok: true, document: withRecord(withRecord(document, replaced), corrected) };
}

function matchesQuery(record: NewsletterCatalogRecord, query: string): boolean {
	return `${record.from} ${record.name ?? ""}`.toLowerCase().includes(query);
}

function byListOrder(listStatus: NewsletterListStatus): (a: NewsletterCatalogRecord, b: NewsletterCatalogRecord) => number {
	if (listStatus === "pending") return (a, b) => a.createdAt.localeCompare(b.createdAt);
	return (a, b) => b.updatedAt.localeCompare(a.updatedAt);
}

export function listRecords(
	document: NewsletterCatalogDocument,
	input: { listStatus: NewsletterListStatus; q: string; page: number },
): { records: NewsletterCatalogRecord[]; total: number; page: number; totalPages: number } {
	const query = input.q.trim().toLowerCase();
	const matching = document.records
		.filter((record) => input.listStatus === "all" || record.status === input.listStatus)
		.filter((record) => matchesQuery(record, query))
		.sort(byListOrder(input.listStatus));
	const totalPages = Math.max(1, Math.ceil(matching.length / NEWSLETTER_ADMIN_PAGE_SIZE));
	const page = Math.min(Math.max(1, input.page), totalPages);
	const start = (page - 1) * NEWSLETTER_ADMIN_PAGE_SIZE;
	return {
		records: matching.slice(start, start + NEWSLETTER_ADMIN_PAGE_SIZE),
		total: matching.length,
		page,
		totalPages,
	};
}
