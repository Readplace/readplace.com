import type { InboxAddress } from "../inbox/inbox-address.schema";
import type { UserId } from "../user";
import type { ForwardableSender } from "./build-forwarding-filter-query";
import type { GmailAccountEmail } from "./gmail-account-email.schema";
import type {
	GmailHistoryImportCancelReason,
	GmailHistoryImportCounts,
	GmailHistoryImportFailureReason,
	GmailHistoryImportJobId,
	GmailHistoryImportMessageOutcome,
	GmailHistoryImportState,
	GmailMessageId,
} from "./gmail-history-import.schema";

export interface GmailConnectionIdentity {
	gatewayAddress: InboxAddress;
	accountEmail: GmailAccountEmail;
}

export interface GmailHistoryImportWindow {
	start: string;
	end: string;
}

export interface GmailHistoryImportJob {
	userId: UserId;
	jobId: GmailHistoryImportJobId;
	senderEmail: ForwardableSender;
	destinationAddress: InboxAddress;
	connection: GmailConnectionIdentity;
	window: GmailHistoryImportWindow | undefined;
	generation: string;
	page: number;
	pageToken: string | undefined;
	listingCompletedAt: string | undefined;
	state: GmailHistoryImportState;
	counts: GmailHistoryImportCounts;
	failureReason: GmailHistoryImportFailureReason | undefined;
	cancelReason: GmailHistoryImportCancelReason | undefined;
	createdAt: string;
	updatedAt: string;
	completedAt: string | undefined;
}

export interface GmailHistoryImportMessage {
	userId: UserId;
	jobId: GmailHistoryImportJobId;
	gmailMessageId: GmailMessageId;
	generation: string;
	rawS3Key: string;
	status: "fetched" | GmailHistoryImportMessageOutcome;
	recordedAt: string;
}

export interface GmailHistoryImportJobRef {
	userId: UserId;
	jobId: GmailHistoryImportJobId;
}

export interface GmailHistoryImportStore {
	createJob: (job: GmailHistoryImportJob) => Promise<void>;
	findJob: (input: GmailHistoryImportJobRef) => Promise<GmailHistoryImportJob | undefined>;
	listJobsByUserId: (userId: UserId) => Promise<GmailHistoryImportJob[]>;
	startJob: (input: GmailHistoryImportJobRef & { generation: string; now: Date }) => Promise<GmailHistoryImportJob | undefined>;
	claimPage: (input: GmailHistoryImportJobRef & { generation: string; page: number; now: Date }) => Promise<boolean>;
	recordFetched: (input: GmailHistoryImportJobRef & {
		generation: string;
		gmailMessageId: GmailMessageId;
		rawS3Key: string;
		now: Date;
	}) => Promise<"recorded" | "already-settled" | "stale">;
	savePage: (input: { previous: GmailHistoryImportJob; pageToken: string | undefined; now: Date }) => Promise<boolean>;
	recordOutcome: (input: GmailHistoryImportJobRef & {
		generation: string;
		gmailMessageId: GmailMessageId;
		outcome: GmailHistoryImportMessageOutcome;
		now: Date;
	}) => Promise<"recorded" | "duplicate" | "stale">;
	completeIfSettled: (input: GmailHistoryImportJobRef & { now: Date }) => Promise<GmailHistoryImportJob | undefined>;
	failJob: (input: GmailHistoryImportJobRef & {
		generation: string;
		reason: GmailHistoryImportFailureReason;
		now: Date;
	}) => Promise<GmailHistoryImportJob | undefined>;
	cancelJobs: (input: {
		userId: UserId;
		senderEmail: ForwardableSender | undefined;
		reason: GmailHistoryImportCancelReason;
		now: Date;
	}) => Promise<GmailHistoryImportJob[]>;
	deleteAllByUserId: (userId: UserId) => Promise<void>;
}
