import { z } from "zod";
import type { UserId } from "../user";
import type { ForwardableSender } from "./build-forwarding-filter-query";
import type { GmailAccountEmail } from "./gmail-account-email.schema";

export const GmailMarkBackfillStateSchema = z.enum(["queued", "running", "complete", "failed", "cancelled"]);
export type GmailMarkBackfillState = z.infer<typeof GmailMarkBackfillStateSchema>;

export const GmailMarkBackfillFailureReasonSchema = z.enum(["permission-revoked", "gmail-rejected", "dead-lettered"]);
export type GmailMarkBackfillFailureReason = z.infer<typeof GmailMarkBackfillFailureReasonSchema>;

export const GmailMarkBackfillCancelReasonSchema = z.enum(["option-off", "mapping-removed", "disconnected"]);
export type GmailMarkBackfillCancelReason = z.infer<typeof GmailMarkBackfillCancelReasonSchema>;

export const GmailMarkBackfillCountsSchema = z.object({
	marked: z.number().int().nonnegative(),
	alreadyMarked: z.number().int().nonnegative(),
	notFound: z.number().int().nonnegative(),
	unlocatable: z.number().int().nonnegative(),
	notSaved: z.number().int().nonnegative(),
	failed: z.number().int().nonnegative(),
});
export type GmailMarkBackfillCounts = z.infer<typeof GmailMarkBackfillCountsSchema>;

export const GMAIL_MARK_BACKFILL_COUNT_FIELDS = [
	"marked",
	"alreadyMarked",
	"notFound",
	"unlocatable",
	"notSaved",
	"failed",
] as const satisfies readonly (keyof GmailMarkBackfillCounts)[];

export const ZERO_GMAIL_MARK_BACKFILL_COUNTS: GmailMarkBackfillCounts = {
	marked: 0,
	alreadyMarked: 0,
	notFound: 0,
	unlocatable: 0,
	notSaved: 0,
	failed: 0,
};

export interface GmailMarkBackfillRef {
	userId: UserId;
	accountEmail: GmailAccountEmail;
	senderEmail: ForwardableSender;
}

export interface GmailMarkBackfillJob extends GmailMarkBackfillRef {
	optionEnabledAt: string;
	generation: number;
	page: number;
	cursor: string | undefined;
	state: GmailMarkBackfillState;
	counts: GmailMarkBackfillCounts;
	failureReason: GmailMarkBackfillFailureReason | undefined;
	cancelReason: GmailMarkBackfillCancelReason | undefined;
	startedAt: string;
	updatedAt: string;
	finishedAt: string | undefined;
}

export type GmailMarkBackfillStart = { started: true; job: GmailMarkBackfillJob } | { started: false };

export function planGmailMarkBackfillStart(input: {
	existing: GmailMarkBackfillJob | undefined;
	ref: GmailMarkBackfillRef;
	optionEnabledAt: string;
	now: Date;
}): GmailMarkBackfillJob | undefined {
	const { existing } = input;
	const now = input.now.toISOString();
	if (existing === undefined || existing.optionEnabledAt !== input.optionEnabledAt) {
		return {
			userId: input.ref.userId,
			accountEmail: input.ref.accountEmail,
			senderEmail: input.ref.senderEmail,
			optionEnabledAt: input.optionEnabledAt,
			generation: (existing?.generation ?? 0) + 1,
			page: 0,
			cursor: undefined,
			state: "queued",
			counts: ZERO_GMAIL_MARK_BACKFILL_COUNTS,
			failureReason: undefined,
			cancelReason: undefined,
			startedAt: now,
			updatedAt: now,
			finishedAt: undefined,
		};
	}
	if (existing.state !== "failed" && existing.state !== "cancelled") return undefined;
	return {
		...existing,
		generation: existing.generation + 1,
		state: "queued",
		failureReason: undefined,
		cancelReason: undefined,
		updatedAt: now,
		finishedAt: undefined,
	};
}

export function addGmailMarkBackfillCounts(input: {
	base: GmailMarkBackfillCounts;
	added: GmailMarkBackfillCounts;
}): GmailMarkBackfillCounts {
	return {
		marked: input.base.marked + input.added.marked,
		alreadyMarked: input.base.alreadyMarked + input.added.alreadyMarked,
		notFound: input.base.notFound + input.added.notFound,
		unlocatable: input.base.unlocatable + input.added.unlocatable,
		notSaved: input.base.notSaved + input.added.notSaved,
		failed: input.base.failed + input.added.failed,
	};
}

export interface GmailMarkBackfillStore {
	startBackfill: (input: GmailMarkBackfillRef & { optionEnabledAt: string; now: Date }) => Promise<GmailMarkBackfillStart>;
	findBackfill: (input: GmailMarkBackfillRef) => Promise<GmailMarkBackfillJob | undefined>;
	listBackfillsByUserId: (userId: UserId) => Promise<GmailMarkBackfillJob[]>;
	claimPage: (input: GmailMarkBackfillRef & { generation: number; page: number; now: Date }) => Promise<boolean>;
	savePage: (input: GmailMarkBackfillRef & {
		generation: number;
		page: number;
		cursor: string;
		counts: GmailMarkBackfillCounts;
		now: Date;
	}) => Promise<boolean>;
	complete: (input: GmailMarkBackfillRef & {
		generation: number;
		page: number;
		counts: GmailMarkBackfillCounts;
		now: Date;
	}) => Promise<boolean>;
	failBackfill: (input: GmailMarkBackfillRef & {
		generation: number | undefined;
		reason: GmailMarkBackfillFailureReason;
		now: Date;
	}) => Promise<"failed" | "unchanged">;
	cancelBackfill: (input: GmailMarkBackfillRef & {
		generation: number | undefined;
		reason: GmailMarkBackfillCancelReason;
		now: Date;
	}) => Promise<"cancelled" | "unchanged">;
}
