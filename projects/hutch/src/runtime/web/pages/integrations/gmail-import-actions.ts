import assert from "node:assert";
import type {
	ForwardableSender,
	GmailConnection,
	GmailHistoryImportJob,
	GmailHistoryImportJobId,
	GmailHistoryImportState,
	GmailSenderEntry,
} from "@packages/domain/gmail";
import { hasGmailScope } from "@packages/domain/gmail";
import type { InboxAddress } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import { GMAIL_READONLY_SCOPE } from "@packages/provider-contracts/gmail-oauth";
import type { GmailIntegrationDependencies } from "./gmail-integration.types";

export type StartGmailImportOutcome =
	| { ok: true; notice: "import_started" | "import_permission_needed" }
	| { ok: false; error: "import_reconnect_required" | "import_revoked" | "import_in_progress" };

export const UNFINISHED_IMPORT_STATES: ReadonlySet<GmailHistoryImportState> = new Set([
	"awaiting-permission",
	"queued",
	"running",
]);

export function latestGmailImportsBySender(
	imports: readonly GmailHistoryImportJob[],
): Map<ForwardableSender, GmailHistoryImportJob> {
	const latest = new Map<ForwardableSender, GmailHistoryImportJob>();
	for (const job of imports) {
		const current = latest.get(job.senderEmail);
		if (current === undefined || job.createdAt > current.createdAt) latest.set(job.senderEmail, job);
	}
	return latest;
}

export function importFollowsMapping(input: { job: GmailHistoryImportJob; mapping: GmailSenderEntry | undefined }): boolean {
	const { job, mapping } = input;
	if (mapping?.addedToFilterAt === undefined || mapping.mappedAddress !== job.destinationAddress) return false;
	assert(mapping.mappedAt, "a sender mapped to an address records when it was mapped");
	return job.createdAt >= mapping.mappedAt;
}

export interface GmailImportActions {
	readonlyGranted: (userId: UserId) => Promise<boolean>;
	resume: (input: { userId: UserId; jobId: GmailHistoryImportJobId }) => Promise<boolean>;
	start: (input: {
		userId: UserId;
		sender: ForwardableSender;
		destination: InboxAddress;
		connection: GmailConnection;
	}) => Promise<StartGmailImportOutcome>;
}

export function initGmailImportActions(deps: {
	gmail: GmailIntegrationDependencies;
	now: () => Date;
}): GmailImportActions {
	const { gmail } = deps;
	const imports = gmail.gmailHistoryImportStore;

	const readonlyGranted = async (userId: UserId): Promise<boolean> =>
		hasGmailScope({
			grantedScope: await gmail.gmailCredentialsStore.findGrantedScopeByUserId(userId),
			scope: GMAIL_READONLY_SCOPE,
		});

	const resume: GmailImportActions["resume"] = async ({ userId, jobId }) => {
		const started = await imports.startJob({
			userId,
			jobId,
			generation: gmail.newGmailHistoryImportGeneration(),
			now: deps.now(),
		});
		if (started === undefined) return false;
		await gmail.publishStartGmailHistoryImport({ userId, jobId, generation: started.generation });
		return true;
	};

	const start: GmailImportActions["start"] = async ({ userId, sender, destination, connection }) => {
		if (connection.revokedAt !== undefined) return { ok: false, error: "import_revoked" };
		const accountEmail = connection.accountEmail;
		if (accountEmail === undefined) return { ok: false, error: "import_reconnect_required" };
		const jobs = await imports.listJobsByUserId(userId);
		if (jobs.some((job) => job.senderEmail === sender && UNFINISHED_IMPORT_STATES.has(job.state))) {
			return { ok: false, error: "import_in_progress" };
		}
		const at = deps.now().toISOString();
		const job: GmailHistoryImportJob = {
			userId,
			jobId: gmail.newGmailHistoryImportJobId(),
			senderEmail: sender,
			destinationAddress: destination,
			connection: { gatewayAddress: connection.gatewayAddress, accountEmail },
			window: undefined,
			generation: gmail.newGmailHistoryImportGeneration(),
			page: 0,
			pageToken: undefined,
			listingCompletedAt: undefined,
			state: "awaiting-permission",
			counts: {
				listed: 0,
				imported: 0,
				alreadyImported: 0,
				skippedNoMessageId: 0,
				skippedSenderMismatch: 0,
				failed: 0,
				cancelled: 0,
			},
			failureReason: undefined,
			cancelReason: undefined,
			createdAt: at,
			updatedAt: at,
			completedAt: undefined,
		};
		await imports.createJob(job);
		if (!(await readonlyGranted(userId))) return { ok: true, notice: "import_permission_needed" };
		await resume({ userId, jobId: job.jobId });
		return { ok: true, notice: "import_started" };
	};

	return { readonlyGranted, resume, start };
}
