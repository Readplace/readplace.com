import assert from "node:assert";
import { z } from "zod";
import type { UserId } from "../user";
import {
	classifyForRemoval,
	type NewsletterLinkCandidate,
	type NewsletterLinkRow,
	type NewsletterLinkSummary,
	REMOVAL_SKIP_REASONS,
	type RemovalSkipReason,
} from "./newsletter-link";

export const HELD_LINK_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export const SavedLinksJobIdSchema = z
	.string()
	.min(1)
	.brand<"SavedLinksJobId">();
export type SavedLinksJobId = z.infer<typeof SavedLinksJobIdSchema>;

export const SavedLinksJobActionSchema = z.enum(["remove", "restore", "count"]);
export type SavedLinksJobAction = z.infer<typeof SavedLinksJobActionSchema>;

export const SavedLinksJobStateSchema = z.enum([
	"requested",
	"running",
	"completed",
	"failed",
]);
export type SavedLinksJobState = z.infer<typeof SavedLinksJobStateSchema>;

export const SKIPPED_COUNT_CODES = [...REMOVAL_SKIP_REASONS, "opened"] as const;

const SavedLinksJobCountCodeSchema = z.enum([
	"held",
	...SKIPPED_COUNT_CODES,
	"restored",
	"already-in-all",
	"unrestorable",
]);
export type SavedLinksJobCountCode = z.infer<
	typeof SavedLinksJobCountCodeSchema
>;

export const SavedLinksJobCountsSchema = z.partialRecord(
	SavedLinksJobCountCodeSchema,
	z.number().int().nonnegative(),
);
export type SavedLinksJobCounts = z.infer<typeof SavedLinksJobCountsSchema>;

export interface SavedLinksJob {
	jobId: SavedLinksJobId;
	action: SavedLinksJobAction;
	state: SavedLinksJobState;
	requestedAt: Date;
	counts: SavedLinksJobCounts;
	finishedAt?: Date;
	counted?: CountedNewsletterLinks;
}

export interface CountedNewsletterLinks {
	cutoff: Date;
	summary: NewsletterLinkSummary;
	issues: number;
	held: HeldNewsletterLinks;
}

export interface HeldNewsletterLinks {
	bySender: Array<{ senderEmail: string; count: number }>;
	unrestorable: string[];
}

export type NewsletterLinkCount =
	| { kind: "none" }
	| { kind: "busy" }
	| { kind: "counting" }
	| { kind: "counted"; jobId: SavedLinksJobId; counted: CountedNewsletterLinks }
	| { kind: "failed" };

export function newsletterLinkCountOf(job: SavedLinksJob | undefined): NewsletterLinkCount {
	if (job === undefined) return { kind: "none" };
	const open = job.state === "requested" || job.state === "running";
	if (job.action !== "count") return open ? { kind: "busy" } : { kind: "none" };
	if (open) return { kind: "counting" };
	if (job.state === "failed") return { kind: "failed" };
	if (job.counted === undefined) return { kind: "none" };
	return { kind: "counted", jobId: job.jobId, counted: job.counted };
}

export type SavedLinksJobBulkAction = Exclude<SavedLinksJobAction, "count">;

export type NewsletterLinksLine =
	| { kind: "hidden" }
	| { kind: "offer"; offer: boolean; restore: boolean }
	| { kind: "working"; action: SavedLinksJobBulkAction }
	| { kind: "result"; action: SavedLinksJobBulkAction; counts: SavedLinksJobCounts; offer: boolean; restore: boolean }
	| { kind: "failed"; action: SavedLinksJobBulkAction; offer: boolean; restore: boolean };

export function newsletterLinksLineOf(params: {
	job: SavedLinksJob | undefined;
	hasNewsletterLink: boolean;
	hasHeldLinks: boolean;
}): NewsletterLinksLine {
	const { job } = params;
	const offers = { offer: params.hasNewsletterLink, restore: params.hasHeldLinks };
	if (job === undefined || job.action === "count") {
		return offers.offer || offers.restore ? { kind: "offer", ...offers } : { kind: "hidden" };
	}
	if (job.state === "requested" || job.state === "running") return { kind: "working", action: job.action };
	if (job.state === "failed") return { kind: "failed", action: job.action, ...offers };
	return { kind: "result", action: job.action, counts: job.counts, ...offers };
}

export type RemovalSenders =
	| { kind: "all" }
	| { kind: "chosen"; senderEmails: readonly string[] };

export type HoldDecision =
	| { kind: "hold" }
	| { kind: "skipped"; reason: RemovalSkipReason }
	| { kind: "not-selected" };

export type HoldOutcome =
	| { outcome: "held" }
	| { outcome: "skipped"; reason: RemovalSkipReason }
	| { outcome: "not-selected" };

export type RestoreOutcome =
	| { outcome: "restored" }
	| { outcome: "already-in-all" }
	| { outcome: "unrestorable" }
	| { outcome: "gone" };

export interface HeldLink {
	heldKey: string;
	storedKey: string;
	jobId: SavedLinksJobId;
	removedAt: Date;
	expiresAt: Date;
	senderEmail: string;
}

export function heldLinkExpiresAt(removedAt: Date): Date {
	return new Date(removedAt.getTime() + HELD_LINK_DAYS * DAY_MS);
}

export function isHeldLinkLive(params: {
	link: Pick<HeldLink, "expiresAt">;
	now: Date;
}): boolean {
	return params.link.expiresAt.getTime() > params.now.getTime();
}

export function decideHold(params: {
	row: NewsletterLinkRow;
	userId: UserId;
	cutoff: Date;
	senders: RemovalSenders;
}): HoldDecision {
	const { row, senders } = params;
	const classification = classifyForRemoval({
		...params,
		highlighted: new Set(),
	});
	if (classification.kind === "not-a-newsletter-link")
		return { kind: "not-selected" };
	assert(
		row.provenance?.kind === "email",
		"a newsletter link carries email provenance",
	);
	if (
		senders.kind === "chosen" &&
		!senders.senderEmails.includes(row.provenance.senderEmail)
	) {
		return { kind: "not-selected" };
	}
	if (classification.kind === "skipped") return classification;
	return { kind: "hold" };
}

export function isChosenSender(params: {
	senders: RemovalSenders;
	senderEmail: string;
}): boolean {
	return (
		params.senders.kind === "all" ||
		params.senders.senderEmails.includes(params.senderEmail)
	);
}

export function addSavedLinksJobCount(params: {
	counts: SavedLinksJobCounts;
	code: SavedLinksJobCountCode;
	by: number;
}): SavedLinksJobCounts {
	return {
		...params.counts,
		[params.code]: (params.counts[params.code] ?? 0) + params.by,
	};
}

export function selectRemovalPage(params: {
	candidates: readonly NewsletterLinkCandidate[];
	userId: UserId;
	highlighted: ReadonlySet<string>;
	cutoff: Date;
	senders: RemovalSenders;
	counts: SavedLinksJobCounts;
}): { selected: string[]; counts: SavedLinksJobCounts } {
	const selected: string[] = [];
	let skipped: SavedLinksJobCounts = params.counts;
	for (const candidate of params.candidates) {
		if (candidate.kind === "unreadable") {
			skipped = addSavedLinksJobCount({
				counts: skipped,
				code: "unreadable",
				by: 1,
			});
			continue;
		}
		const classification = classifyForRemoval({
			...params,
			row: candidate.row,
		});
		if (classification.kind === "not-a-newsletter-link") continue;
		assert(
			candidate.row.provenance?.kind === "email",
			"a newsletter link carries email provenance",
		);
		if (
			!isChosenSender({
				senders: params.senders,
				senderEmail: candidate.row.provenance.senderEmail,
			})
		)
			continue;
		if (classification.kind === "skipped") {
			skipped = addSavedLinksJobCount({
				counts: skipped,
				code: classification.reason,
				by: 1,
			});
			continue;
		}
		selected.push(candidate.row.storedKey);
	}
	return { selected, counts: skipped };
}

export function selectHeldLinksToRestore(params: {
	links: readonly HeldLink[];
	requestedAt: Date;
	senders: RemovalSenders;
	now: Date;
}): HeldLink[] {
	const earliest = new Map<string, HeldLink>();
	for (const link of params.links) {
		if (!isHeldLinkLive({ link, now: params.now })) continue;
		if (link.removedAt.getTime() > params.requestedAt.getTime()) continue;
		if (
			!isChosenSender({
				senders: params.senders,
				senderEmail: link.senderEmail,
			})
		)
			continue;
		const kept = earliest.get(link.storedKey);
		if (
			kept === undefined ||
			link.removedAt.getTime() < kept.removedAt.getTime()
		)
			earliest.set(link.storedKey, link);
	}
	return [...earliest.values()];
}

export function summariseHeldLinks(params: {
	links: readonly HeldLink[];
	cutoff: Date;
	now: Date;
	unrestorable: ReadonlySet<string>;
	inAll: ReadonlySet<string>;
}): HeldNewsletterLinks {
	const restorable = selectHeldLinksToRestore({
		links: params.links,
		requestedAt: params.cutoff,
		senders: { kind: "all" },
		now: params.now,
	});
	const bySender = new Map<string, number>();
	const unrestorable: string[] = [];
	for (const link of restorable) {
		if (params.unrestorable.has(link.storedKey)) {
			unrestorable.push(link.storedKey);
			continue;
		}
		if (params.inAll.has(link.storedKey)) continue;
		bySender.set(link.senderEmail, (bySender.get(link.senderEmail) ?? 0) + 1);
	}
	return {
		bySender: [...bySender]
			.map(([senderEmail, count]) => ({ senderEmail, count }))
			.sort((a, b) => b.count - a.count),
		unrestorable,
	};
}
