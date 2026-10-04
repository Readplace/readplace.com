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
} from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";
import type { GmailHistoryImportMessageFetchedDetail } from "@packages/hutch-infra-components";
import type { GmailHistory, GmailHistoryResult, PutGmailImportRaw } from "@packages/provider-contracts/gmail-history";

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
	start: (input: { userId: UserId; jobId: GmailHistoryImportJobId; generation: string }) => Promise<GmailHistoryImportStep>;
	page: (input: GmailHistoryImportPage) => Promise<GmailHistoryImportStep>;
}

type GmailHistoryFailure = Exclude<GmailHistoryResult<never>, { ok: true }>;

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

	async function cancel(job: GmailHistoryImportJob, reason: GmailHistoryImportCancelReason): Promise<GmailHistoryImportStep> {
		await imports.cancelJobs({ userId: job.userId, senderEmail: job.senderEmail, reason, now: now() });
		return NOTHING;
	}

	async function fail(job: GmailHistoryImportJob, connection: GmailConnection, failure: GmailHistoryFailure): Promise<GmailHistoryImportStep> {
		if (failure.reason === "unavailable") throw new Error(`Gmail history import unavailable (${failure.status})`);
		if (failure.reason === "reauth-required" && !(await connections.markRevokedIfCurrent({ userId: job.userId, gatewayAddress: connection.gatewayAddress, connectedAt: connection.connectedAt, reason: "invalid-grant" }))) {
			throw new Error("Gmail connection changed during history import");
		}
		const reason = FAILURE_REASONS[failure.reason];
		const failed = await imports.failJob({ userId: job.userId, jobId: job.jobId, generation: job.generation, reason, now: now() });
		return { ...NOTHING, failed: failed === undefined ? undefined : reason };
	}

	async function completeListedJob(job: GmailHistoryImportJob): Promise<GmailHistoryImportStep> {
		return { ...NOTHING, completed: await imports.completeIfSettled({ userId: job.userId, jobId: job.jobId, now: now() }) };
	}

	const page: GmailHistoryImport["page"] = async (input) => {
		const job = await imports.findJob(input);
		if (job === undefined || job.generation !== input.generation || !RUNNABLE_STATES.has(job.state)) return NOTHING;
		if (job.page === input.page + 1) {
			if (job.listingCompletedAt !== undefined) return completeListedJob(job);
			return { ...NOTHING, next: { ...input, page: job.page } };
		}
		if (job.page !== input.page) return NOTHING;

		const connection = await connections.findConnectionByUserId(input.userId);
		const connectionChange = connectionCancelReason(job, connection);
		if (connectionChange !== undefined) return cancel(job, connectionChange);
		assert(connection, "an unchanged connection exists");
		const sender = await senders.findSender({ userId: input.userId, senderEmail: job.senderEmail });
		if (sender?.mappedAddresses === undefined) return cancel(job, "mapping-removed");
		const destinations = new Set(sender.mappedAddresses);
		if (destinations.size !== new Set(job.destinationAddresses).size || job.destinationAddresses.some((address) => !destinations.has(address))) {
			return cancel(job, "destination-changed");
		}
		if (!(await imports.claimPage({ ...input, now: now() }))) return NOTHING;

		assert(job.window, "a queued import has its listing window");
		const listing = await history.listUnreadMessageIds({ userId: input.userId, sender: job.senderEmail, window: job.window, pageToken: job.pageToken });
		if (!listing.ok) return fail(job, connection, listing);

		for (const gmailMessageId of listing.value.messageIds) {
			const message = await history.fetchRawMessage({ userId: input.userId, messageId: gmailMessageId });
			if (!message.ok) return fail(job, connection, message);
			if ("notFound" in message.value || message.value.labelIds.some((label) => UNLISTED_LABELS.has(label))) continue;
			const rawEmailS3Key = gmailHistoryImportRawKey({ userId: input.userId, jobId: input.jobId, gmailMessageId });
			await deps.putRaw({ key: rawEmailS3Key, raw: message.value.raw });
			const recorded = await imports.recordFetched({ ...input, gmailMessageId, rawS3Key: rawEmailS3Key, now: now() });
			if (recorded === "stale") return NOTHING;
			if (recorded === "already-settled") continue;
			await deps.publishFetched({
				userId: input.userId,
				jobId: input.jobId,
				generation: input.generation,
				gmailMessageId,
				accountEmail: job.connection.accountEmail,
				senderEmail: job.senderEmail,
				destinationAddresses: job.destinationAddresses,
				rawEmailS3Key,
				internalDate: message.value.internalDate,
			});
		}

		const nextPageToken = listing.value.nextPageToken;
		if (!(await imports.savePage({ previous: job, pageToken: nextPageToken, now: now() }))) return NOTHING;
		if (nextPageToken === undefined) return completeListedJob(job);
		return { ...NOTHING, next: { ...input, page: input.page + 1 } };
	};

	return {
		page,
		start: (input) => page({ ...input, page: 0 }),
	};
}
