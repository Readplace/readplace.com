import type { UserId } from "@packages/domain/user";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import type { ReaderArticleHashId } from "@packages/domain/article";
import { z } from "zod";

export const StarterAssignmentSchema = z.object({
	campaignId: z.string(),
	arm: z.enum(["treatment", "comparison"]),
	assignedAt: z.string(),
	tier: z.enum(["trial", "paid"]),
	accountCohort: z.enum(["existing", "new"]),
});
export type StarterAssignment = z.infer<typeof StarterAssignmentSchema>;

export const EngagementStateSchema = z.object({
	observationStartedAt: z.string().optional(),
	lastActivityAt: z.string().optional(),
	activityRevision: z.number().default(0),
	assignment: StarterAssignmentSchema.optional(),
	activatedAt: z.string().optional(),
	engagedDays8To14At: z.string().optional(),
});
export type EngagementState = z.infer<typeof EngagementStateSchema>;

export type EngagementActivityKind =
	| "reader-open"
	| "summary-open"
	| "read-status"
	| "personal-save"
	| "import-request"
	| "mcp-content"
	| "mcp-summary";
export type RecordEngagementActivity = (input: {
	userId: UserId;
	kind: EngagementActivityKind;
	at: Date;
	articleId?: ReaderArticleHashId;
	markedRead?: boolean;
	campaignId?: string;
}) => Promise<void>;

export const StarterPickSchema = z.object({
	url: z.string(),
	hnItemId: z.number(),
	rank: z.number(),
	snapshotAt: z.string(),
});
export type StarterPick = z.infer<typeof StarterPickSchema>;
export const FrozenStarterMessageSchema = z.object({
	from: z.string(),
	to: z.string(),
	replyTo: z.string(),
	subject: z.string(),
	html: z.string(),
	text: z.string(),
	headers: z.record(z.string(), z.string()),
	idempotencyKey: z.string(),
});
export type FrozenStarterMessage = z.infer<typeof FrozenStarterMessageSchema>;
export const StarterPackSchema = z.object({
	campaignId: z.string(),
	picks: z.array(StarterPickSchema),
	readlist: ReadlistSlugSchema,
	readlistLabel: z.string(),
	selectedAt: z.string(),
	insertedAt: z.string().optional(),
	insertionOutcome: z.enum(["inserted", "conflict", "failed"]).optional(),
	lastInsertionAttemptAt: z.string().optional(),
	emailStatus: z.enum(["pending", "sending", "sent", "suppressed", "review"]),
	message: FrozenStarterMessageSchema.optional(),
	firstAttemptAt: z.string().optional(),
	sentAt: z.string().optional(),
	itemCount: z.number().optional(),
	reason: z.string().optional(),
});
export type StarterPack = z.infer<typeof StarterPackSchema>;

export interface EngagementStarterState {
	listStarterObservations: (campaignId: string) => Promise<
		{ userId: UserId; engagement: EngagementState; starterPack?: StarterPack }[]
	>;
	findEngagement: (userId: UserId) => Promise<EngagementState>;
	withdrawStarterAssignment: (userId: UserId) => Promise<void>;
	observeEngagement: (input: { userId: UserId; startedAt: string }) => Promise<EngagementState>;
	recordEngagementActivity: RecordEngagementActivity;
	assignStarter: (input: {
		userId: UserId;
		revision: number;
		assignment: StarterAssignment;
		pack: StarterPack;
	}) => Promise<"assigned" | "conflict">;
	findStarterPack: (userId: UserId) => Promise<StarterPack | undefined>;
	replaceStarterSelection: (input: {
		userId: UserId;
		selectedAt: string;
		pack: StarterPack;
	}) => Promise<"replaced" | "conflict">;
	recordStarterInsertionFailure: (input: {
		userId: UserId;
		selectedAt: string;
		at: Date;
		outcome: "conflict" | "failed";
	}) => Promise<void>;
	suppressStarterEmail: (input: { userId: UserId; reason: string }) => Promise<boolean>;
	claimStarterEmail: (input: {
		userId: UserId;
		message: FrozenStarterMessage;
		at: Date;
		minGapMs: number;
		itemCount: number;
	}) => Promise<StarterPack | undefined>;
	markStarterEmailSent: (input: { userId: UserId; at: Date }) => Promise<boolean>;
	markStarterEmailReview: (input: { userId: UserId; reason: string }) => Promise<boolean>;
}

export interface PersonalLibrary {
	urls: string[];
	personalCount: number;
}
export type FindPersonalLibrary = (userId: UserId) => Promise<PersonalLibrary>;
export type SaveStarterPack = (input: {
	userId: UserId;
	activityRevision: number;
	pack: StarterPack;
	savedAt: Date[];
	at: Date;
}) => Promise<"inserted" | "conflict">;
