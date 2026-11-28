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

export type NewsletterRowKind = "link" | "issue";

export function isNewsletterIssueKey(params: { storedKey: string; userId: UserId }): boolean {
	return params.storedKey.startsWith(emailIssueKeyPrefix(params.userId));
}

function newsletterRowKindOf(params: { row: NewsletterLinkRow; userId: UserId }): NewsletterRowKind | undefined {
	const { row, userId } = params;
	if (row.provenance?.kind !== "email") return undefined;
	if (isNewsletterIssueKey({ storedKey: row.storedKey, userId })) return "issue";
	return row.storedKey.startsWith(RESERVED_KEY_PREFIX) ? undefined : "link";
}

export function isNewsletterLink(params: { row: NewsletterLinkRow; userId: UserId }): boolean {
	return newsletterRowKindOf(params) === "link";
}

export function classifyForRemoval(params: {
	row: NewsletterLinkRow;
	userId: UserId;
	highlighted: ReadonlySet<string>;
	cutoff: Date;
	kind: NewsletterRowKind;
}): RemovalClassification {
	const { row, highlighted, cutoff } = params;
	if (newsletterRowKindOf(params) !== params.kind) return { kind: "not-a-newsletter-link" };
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
		const classification = classifyForRemoval({ ...params, row, kind: "link" });
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

export const ISSUE_SKIP_REASONS = ["read", "highlighted"] as const;

type IssueSkipReason = (typeof ISSUE_SKIP_REASONS)[number];

export interface NewsletterIssueSummary {
	selected: number;
	bySender: Array<{ senderEmail: string; count: number }>;
	skipped: Record<IssueSkipReason, number>;
}

export function summariseNewsletterIssues(params: {
	emails: readonly { senderEmail: string; receivedAt: string; issueState: RemovalClassification | undefined }[];
	cutoff: Date;
}): NewsletterIssueSummary {
	const skipped: Record<IssueSkipReason, number> = { read: 0, highlighted: 0 };
	const senders = new Map<string, number>();
	let selected = 0;
	for (const email of params.emails) {
		if (email.receivedAt > params.cutoff.toISOString()) continue;
		const reason = email.issueState?.kind === "skipped" ? email.issueState.reason : undefined;
		if (reason === "read" || reason === "highlighted") {
			skipped[reason] += 1;
			continue;
		}
		if (reason !== undefined) continue;
		selected += 1;
		senders.set(email.senderEmail, (senders.get(email.senderEmail) ?? 0) + 1);
	}
	const bySender = [...senders.entries()]
		.map(([senderEmail, count]) => ({ senderEmail, count }))
		.sort((a, b) => b.count - a.count || a.senderEmail.localeCompare(b.senderEmail));
	return { selected, bySender, skipped };
}
