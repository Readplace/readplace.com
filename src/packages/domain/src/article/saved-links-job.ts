import assert from "node:assert";
import { z } from "zod";
import type { UserId } from "../user";
import { classifyForRemoval, type NewsletterLinkRow, REMOVAL_SKIP_REASONS, type RemovalSkipReason } from "./newsletter-link";

export const HELD_LINK_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export const SavedLinksJobIdSchema = z.string().min(1).brand<"SavedLinksJobId">();
export type SavedLinksJobId = z.infer<typeof SavedLinksJobIdSchema>;

export const SavedLinksJobActionSchema = z.enum(["remove", "restore"]);
export type SavedLinksJobAction = z.infer<typeof SavedLinksJobActionSchema>;

export const SavedLinksJobStateSchema = z.enum(["requested", "running", "completed", "failed"]);
export type SavedLinksJobState = z.infer<typeof SavedLinksJobStateSchema>;

const SavedLinksJobCountCodeSchema = z.enum([
	"held",
	...REMOVAL_SKIP_REASONS,
	"restored",
	"already-in-all",
	"unrestorable",
]);
export type SavedLinksJobCountCode = z.infer<typeof SavedLinksJobCountCodeSchema>;

export const SavedLinksJobCountsSchema = z.partialRecord(SavedLinksJobCountCodeSchema, z.number().int().nonnegative());
export type SavedLinksJobCounts = z.infer<typeof SavedLinksJobCountsSchema>;

export interface SavedLinksJob {
	jobId: SavedLinksJobId;
	action: SavedLinksJobAction;
	state: SavedLinksJobState;
	requestedAt: Date;
	counts: SavedLinksJobCounts;
	finishedAt?: Date;
}

export type RemovalSenders = { kind: "all" } | { kind: "chosen"; senderEmails: readonly string[] };

export type HoldDecision = { kind: "hold" } | { kind: "skipped"; reason: RemovalSkipReason } | { kind: "not-selected" };

export type HoldOutcome = { outcome: "held" } | { outcome: "skipped"; reason: RemovalSkipReason } | { outcome: "not-selected" };

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

export function isHeldLinkLive(params: { link: Pick<HeldLink, "expiresAt">; now: Date }): boolean {
	return params.link.expiresAt.getTime() > params.now.getTime();
}

export function decideHold(params: {
	row: NewsletterLinkRow;
	userId: UserId;
	cutoff: Date;
	senders: RemovalSenders;
}): HoldDecision {
	const { row, senders } = params;
	const classification = classifyForRemoval({ ...params, highlighted: new Set(), openedInReadlists: new Set() });
	if (classification.kind === "not-a-newsletter-link") return { kind: "not-selected" };
	assert(row.provenance?.kind === "email", "a newsletter link carries email provenance");
	if (senders.kind === "chosen" && !senders.senderEmails.includes(row.provenance.senderEmail)) {
		return { kind: "not-selected" };
	}
	if (classification.kind === "skipped") return classification;
	return { kind: "hold" };
}
