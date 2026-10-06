import assert from "node:assert";
import {
	type GmailConnection,
	type GmailConnectionStore,
	type GmailHistoryImportCancelReason,
	type GmailHistoryImportFailureReason,
	type GmailHistoryImportJob,
	type GmailHistoryImportJobId,
	type GmailHistoryImportStore,
	type GmailSenderStore,
	gmailHistoryImportRawKey,
	resolveGmailDeliveryMode,
} from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";
import type { GmailHistoryImportMessageFetchedDetail } from "@packages/hutch-infra-components";
import type { GmailHistory, GmailHistoryResult, GmailHttpOperation, ObserveGmailHttpAttempt, PutGmailImportRaw } from "@packages/provider-contracts/gmail-history";
import { errorClassName } from "./error-class-name";
import type { GmailHistoryImportObservation, ObserveGmailHistoryImport } from "./gmail-history-import-observation.types";

export interface GmailHistoryImportPage {
	userId: UserId;
	jobId: GmailHistoryImportJobId;
	generation: string;
	page: number;
}

export interface GmailHistoryImportStep {
	next: GmailHistoryImportPage | undefined;
	completed: GmailHistoryImportJob | undefined;
	failed: GmailHistoryImportFailureReason | undefined;
}

export interface GmailHistoryImport {
	start: (input: { userId: UserId; jobId: GmailHistoryImportJobId; generation: string }, observe: ObserveGmailHistoryImport) => Promise<GmailHistoryImportStep>;
	page: (input: GmailHistoryImportPage, observe: ObserveGmailHistoryImport) => Promise<GmailHistoryImportStep>;
}

type GmailHistoryFailure = Exclude<GmailHistoryResult<never>, { ok: true }>;
type SkipReason = Extract<GmailHistoryImportObservation, { kind: "page-skipped" }>["reason"];
type GmailCallFailed = Extract<GmailHistoryImportObservation, { kind: "gmail-call-failed" }>;

const NOTHING: GmailHistoryImportStep = { next: undefined, completed: undefined, failed: undefined };
const RUNNABLE_STATES: ReadonlySet<GmailHistoryImportJob["state"]> = new Set(["queued", "running"]);
const UNLISTED_LABELS: ReadonlySet<string> = new Set(["SPAM", "TRASH"]);
const FAILURE_REASONS = {
	"reauth-required": "permission-revoked",
	"readonly-permission-required": "permission-revoked",
	rejected: "gmail-rejected",
} as const satisfies Record<Exclude<GmailHistoryFailure["reason"], "unavailable">, GmailHistoryImportFailureReason>;

function connectionCancelReason(job: GmailHistoryImportJob, connection: GmailConnection | undefined): GmailHistoryImportCancelReason | undefined {
	if (connection === undefined || connection.disconnectRequestedAt !== undefined) return "disconnected";
	const sameAccount = connection.accountEmail?.toLowerCase() === job.connection.accountEmail.toLowerCase();
	return sameAccount && connection.gatewayAddress === job.connection.gatewayAddress ? undefined : "account-changed";
}

function failureStatus(failure: GmailHistoryFailure): number | undefined {
	return "status" in failure ? failure.status : undefined;
}

function skipped(observe: ObserveGmailHistoryImport, reason: SkipReason): GmailHistoryImportStep {
	observe({ kind: "page-skipped", reason });
	return NOTHING;
}

function observeCallAttempts(observe: ObserveGmailHistoryImport): { observe: ObserveGmailHttpAttempt; lastAttemptOperation: () => GmailHttpOperation | undefined } {
	let lastAttemptOperation: GmailHttpOperation | undefined;
	return {
		observe: (attempt) => {
			lastAttemptOperation = attempt.operation;
			observe({ kind: "http-attempt", attempt });
		},
		lastAttemptOperation: () => lastAttemptOperation,
	};
}

export function initGmailHistoryImport(deps: {
	history: GmailHistory;
	imports: GmailHistoryImportStore;
	connections: GmailConnectionStore;
	senders: GmailSenderStore;
	putRaw: PutGmailImportRaw;
	publishFetched: (detail: GmailHistoryImportMessageFetchedDetail) => Promise<void>;
	now: () => Date;
}): GmailHistoryImport {
	const { history, imports, connections, senders, now } = deps;

	async function cancel(input: { job: GmailHistoryImportJob; reason: GmailHistoryImportCancelReason; observe: ObserveGmailHistoryImport }): Promise<GmailHistoryImportStep> {
		const { job, reason } = input;
		const cancelled = await imports.cancelJobs({ userId: job.userId, senderEmail: job.senderEmail, reason, now: now() });
		input.observe({ kind: "job-cancelled", reason, cancelledJobs: cancelled.length });
		return NOTHING;
	}

	async function fail(input: {
		job: GmailHistoryImportJob;
		connection: GmailConnection;
		operation: GmailCallFailed["operation"];
		lastAttemptOperation: GmailCallFailed["lastAttemptOperation"];
		failure: GmailHistoryFailure;
		observe: ObserveGmailHistoryImport;
	}): Promise<GmailHistoryImportStep> {
		const { job, connection, failure, observe } = input;
		observe({ kind: "gmail-call-failed", operation: input.operation, lastAttemptOperation: input.lastAttemptOperation, reason: failure.reason, status: failureStatus(failure) });
		if (failure.reason === "unavailable") throw new Error(`Gmail history import unavailable (${failure.status})`);
		if (failure.reason === "reauth-required") {
			const revoked = await connections.markRevokedIfCurrent({ userId: job.userId, gatewayAddress: connection.gatewayAddress, connectedAt: connection.connectedAt, reason: "invalid-grant" });
			observe({ kind: "connection-revoked", persisted: revoked });
			if (!revoked) throw new Error("Gmail connection changed during history import");
		}
		const reason = FAILURE_REASONS[failure.reason];
		const failed = await imports.failJob({ userId: job.userId, jobId: job.jobId, generation: job.generation, reason, now: now() });
		observe({ kind: "job-failed", reason, persisted: failed !== undefined });
		return { ...NOTHING, failed: failed === undefined ? undefined : reason };
	}

	async function completeListedJob(job: GmailHistoryImportJob, observe: ObserveGmailHistoryImport): Promise<GmailHistoryImportStep> {
		const completed = await imports.completeIfSettled({ userId: job.userId, jobId: job.jobId, now: now() });
		observe({ kind: "job-completed", persisted: completed !== undefined });
		return { ...NOTHING, completed };
	}

	const page: GmailHistoryImport["page"] = async (input, observe) => {
		const job = await imports.findJob(input);
		if (job === undefined) return skipped(observe, "job-missing");
		if (job.generation !== input.generation) return skipped(observe, "generation-stale");
		if (!RUNNABLE_STATES.has(job.state)) return skipped(observe, "job-not-runnable");
		if (job.page === input.page + 1) {
			observe({ kind: "page-already-processed", listingCompleted: job.listingCompletedAt !== undefined });
			if (job.listingCompletedAt !== undefined) return completeListedJob(job, observe);
			return { ...NOTHING, next: { ...input, page: job.page } };
		}
		if (job.page !== input.page) return skipped(observe, "page-mismatch");

		const connection = await connections.findConnectionByUserId(input.userId);
		const connectionChange = connectionCancelReason(job, connection);
		if (connectionChange !== undefined) return cancel({ job, reason: connectionChange, observe });
		assert(connection, "an unchanged connection exists");
		const sender = await senders.findSender({ userId: input.userId, senderEmail: job.senderEmail });
		if (sender?.mappedAddresses === undefined) return cancel({ job, reason: "mapping-removed", observe });
		const destinations = new Set(sender.mappedAddresses);
		if (destinations.size !== new Set(job.destinationAddresses).size || job.destinationAddresses.some((address) => !destinations.has(address))) {
			return cancel({ job, reason: "destination-changed", observe });
		}
		if (!(await imports.claimPage({ ...input, now: now() }))) return skipped(observe, "claim-lost");
		observe({ kind: "page-claimed" });

		assert(job.window, "a queued import has its listing window");
		const listingAttempts = observeCallAttempts(observe);
		const listing = await history.listUnreadMessageIds({ userId: input.userId, sender: job.senderEmail, window: job.window, pageToken: job.pageToken, observe: listingAttempts.observe });
		if (!listing.ok) return fail({ job, connection, operation: "messages.list", lastAttemptOperation: listingAttempts.lastAttemptOperation(), failure: listing, observe });
		observe({ kind: "page-listed", messageCount: listing.value.messageIds.length, nextPagePresent: listing.value.nextPageToken !== undefined });

		for (const [index, gmailMessageId] of listing.value.messageIds.entries()) {
			const fetchAttempts = observeCallAttempts(observe);
			const message = await history.fetchRawMessage({ userId: input.userId, messageId: gmailMessageId, observe: fetchAttempts.observe });
			if (!message.ok) return fail({ job, connection, operation: "messages.get", lastAttemptOperation: fetchAttempts.lastAttemptOperation(), failure: message, observe });
			if ("notFound" in message.value) {
				observe({ kind: "message-processed", index, outcome: "not-found" });
				continue;
			}
			if (message.value.labelIds.some((label) => UNLISTED_LABELS.has(label))) {
				observe({ kind: "message-processed", index, outcome: "unlisted-label" });
				continue;
			}
			const rawEmailS3Key = gmailHistoryImportRawKey({ userId: input.userId, jobId: input.jobId, gmailMessageId });
			await deps.putRaw({ key: rawEmailS3Key, raw: message.value.raw });
			const recorded = await imports.recordFetched({ ...input, gmailMessageId, rawS3Key: rawEmailS3Key, now: now() });
			if (recorded === "stale") return skipped(observe, "fetched-stale");
			if (recorded === "already-settled") {
				observe({ kind: "message-processed", index, outcome: "already-settled" });
				continue;
			}
			try {
				await deps.publishFetched({
					userId: input.userId,
					jobId: input.jobId,
					generation: input.generation,
					gmailMessageId,
					accountEmail: job.connection.accountEmail,
					senderEmail: job.senderEmail,
					destinationAddresses: job.destinationAddresses,
					deliveryMode: resolveGmailDeliveryMode(sender),
					rawEmailS3Key,
					internalDate: message.value.internalDate,
				});
			} catch (error) {
				observe({ kind: "message-publication-failed", index, errorName: errorClassName(error) });
				throw error;
			}
			observe({ kind: "message-processed", index, outcome: "published" });
		}

		const nextPageToken = listing.value.nextPageToken;
		if (!(await imports.savePage({ previous: job, pageToken: nextPageToken, now: now() }))) return skipped(observe, "save-page-lost");
		observe({ kind: "page-saved", nextPagePresent: nextPageToken !== undefined });
		if (nextPageToken === undefined) return completeListedJob(job, observe);
		return { ...NOTHING, next: { ...input, page: input.page + 1 } };
	};

	return {
		page,
		start: (input, observe) => page({ ...input, page: 0 }, observe),
	};
}
