import assert from "node:assert";
import { emailIssueKeyPrefix } from "../inbox/email-issue-url";
import type { UserId } from "../user";
import type { ArticleStatus } from "./article.types";
import type { SaveProvenance } from "./save-provenance";

const RESERVED_KEY_PREFIX = "readplace:";

export interface NewsletterLinkRow {
	storedKey: string;
	provenance?: SaveProvenance;
	status: ArticleStatus;
	restoredAt?: Date;
	savedAt: Date;
}

export const REMOVAL_SKIP_REASONS = ["read", "highlighted", "changed", "unreadable"] as const;

export type RemovalSkipReason = (typeof REMOVAL_SKIP_REASONS)[number];

export type RemovalClassification =
	| { kind: "selected" }
	| { kind: "skipped"; reason: RemovalSkipReason }
	| { kind: "not-a-newsletter-link" };

export type NewsletterLinkCandidate = { kind: "row"; row: NewsletterLinkRow } | { kind: "unreadable" };

export interface NewsletterLinkSummary {
	selected: number;
	bySender: Array<{ senderEmail: string; count: number }>;
	skipped: Record<RemovalSkipReason, number>;
	earliestEmailSave: Date | undefined;
}

export function isNewsletterLink(params: { row: NewsletterLinkRow; userId: UserId }): boolean {
	const { row, userId } = params;
	return (
		row.provenance?.kind === "email" &&
		!row.storedKey.startsWith(RESERVED_KEY_PREFIX) &&
		!row.storedKey.startsWith(emailIssueKeyPrefix(userId))
	);
}

export function classifyForRemoval(params: {
	row: NewsletterLinkRow;
	userId: UserId;
	highlighted: ReadonlySet<string>;
	cutoff: Date;
}): RemovalClassification {
	const { row, highlighted, cutoff } = params;
	if (!isNewsletterLink(params)) return { kind: "not-a-newsletter-link" };
	if (row.savedAt.getTime() > cutoff.getTime()) return { kind: "skipped", reason: "changed" };
	if (row.restoredAt !== undefined && row.restoredAt.getTime() >= cutoff.getTime()) {
		return { kind: "skipped", reason: "changed" };
	}
	if (row.status === "read") return { kind: "skipped", reason: "read" };
	if (highlighted.has(row.storedKey)) return { kind: "skipped", reason: "highlighted" };
	return { kind: "selected" };
}

export function summariseNewsletterLinkRows(params: {
	candidates: readonly NewsletterLinkCandidate[];
	userId: UserId;
	highlighted: ReadonlySet<string>;
	cutoff: Date;
}): NewsletterLinkSummary {
	const skipped: Record<RemovalSkipReason, number> = { read: 0, highlighted: 0, changed: 0, unreadable: 0 };
	const senders = new Map<string, number>();
	let selected = 0;
	let earliestEmailSave: Date | undefined;
	for (const candidate of params.candidates) {
		if (candidate.kind === "unreadable") {
			skipped.unreadable += 1;
			continue;
		}
		const { row } = candidate;
		const classification = classifyForRemoval({ ...params, row });
		if (classification.kind === "skipped") skipped[classification.reason] += 1;
		if (classification.kind !== "selected") continue;
		assert(row.provenance?.kind === "email", "a selected newsletter link carries email provenance");
		selected += 1;
		senders.set(row.provenance.senderEmail, (senders.get(row.provenance.senderEmail) ?? 0) + 1);
		if (earliestEmailSave === undefined || row.savedAt.getTime() < earliestEmailSave.getTime()) {
			earliestEmailSave = row.savedAt;
		}
	}
	const bySender = [...senders.entries()]
		.map(([senderEmail, count]) => ({ senderEmail, count }))
		.sort((a, b) => b.count - a.count || a.senderEmail.localeCompare(b.senderEmail));
	return { selected, bySender, skipped, earliestEmailSave };
}
