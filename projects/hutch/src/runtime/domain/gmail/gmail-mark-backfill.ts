import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import { z } from "zod";
import {
	ForwardableSenderSchema,
	GmailAccountEmailSchema,
	type GmailConnection,
	type GmailConnectionStore,
	type GmailMappingStore,
	type GmailMarkBackfillCancelReason,
	type GmailMarkBackfillCounts,
	type GmailMarkBackfillFailureReason,
	type GmailMarkBackfillJob,
	type GmailMarkBackfillRef,
	type GmailMarkBackfillStore,
	type GmailMessageOrigin,
	type GmailMessageUpdateStore,
	ZERO_GMAIL_MARK_BACKFILL_COUNTS,
	sameGmailAccount,
} from "@packages/domain/gmail";
import type { EmailImportCandidate, EmailImportCompletionStore, InboxEmailLinkStore } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import {
	GmailMarkBackfillPageProcessedEvent,
	ProcessGmailMarkBackfillPageCommand,
	type ProcessGmailMarkBackfillPageDetail,
	StartGmailMarkBackfillCommand,
} from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { HutchLogger } from "@packages/hutch-logger";
import type { OpenedGmailMailbox, OpenGmailMailboxForUpdate } from "@packages/provider-contracts/gmail-message-update";
import { classifyMarkBackfillEmail, needsLinksMeta } from "./classify-mark-backfill-email";
import { GmailUnavailableError, importedLabelId, markOriginal } from "./gmail-original-update";
import type { FindMarkImportedSince } from "./mark-imported-gate";

const ROWS_PER_READ = 100;
const ROWS_PER_PAGE = 400;
const ELIGIBLE_EMAILS_PER_PAGE = 25;
const PAGE_TIME_BUDGET_MS = 40_000;
const RUNNABLE_STATES: ReadonlySet<GmailMarkBackfillJob["state"]> = new Set(["queued", "running"]);

const GmailMarkBackfillEnvelope = z.union([
	z.object({ "detail-type": z.literal(StartGmailMarkBackfillCommand.detailType), detail: StartGmailMarkBackfillCommand.detailSchema }).transform(({ detail }) => ({ kind: "start" as const, detail })),
	z.object({ "detail-type": z.literal(ProcessGmailMarkBackfillPageCommand.detailType).optional(), detail: ProcessGmailMarkBackfillPageCommand.detailSchema }).transform(({ detail }) => ({ kind: "page" as const, detail })),
	z.object({ "detail-type": z.literal(GmailMarkBackfillPageProcessedEvent.detailType), detail: GmailMarkBackfillPageProcessedEvent.detailSchema }).transform(({ detail }) => ({ kind: "progress" as const, detail })),
]);

type EmailOutcome = "failed" | "notFound" | "marked" | "alreadyMarked";
const OUTCOME_SEVERITY: Record<EmailOutcome, number> = { failed: 3, notFound: 2, marked: 1, alreadyMarked: 0 };

type PageEnd = { kind: "stopped" } | { kind: "finished"; exhausted: boolean; cursor: string; counts: GmailMarkBackfillCounts };

function envelopeRef(envelope: z.output<typeof GmailMarkBackfillEnvelope>): GmailMarkBackfillRef {
	return {
		userId: UserIdSchema.parse(envelope.detail.userId),
		accountEmail: GmailAccountEmailSchema.parse(envelope.detail.accountEmail),
		senderEmail: ForwardableSenderSchema.parse(envelope.detail.senderEmail),
	};
}

function counted(counts: GmailMarkBackfillCounts, field: keyof GmailMarkBackfillCounts): GmailMarkBackfillCounts {
	return { ...counts, [field]: counts[field] + 1 };
}

function sameConnection(input: { job: GmailMarkBackfillJob; connection: GmailConnection | undefined }): input is { job: GmailMarkBackfillJob; connection: GmailConnection } {
	const { connection } = input;
	return (
		connection?.accountEmail !== undefined &&
		connection.disconnectRequestedAt === undefined &&
		sameGmailAccount(connection.accountEmail, input.job.accountEmail)
	);
}

export function initGmailMarkBackfillHandler(deps: {
	backfills: GmailMarkBackfillStore;
	updates: GmailMessageUpdateStore;
	connections: Pick<GmailConnectionStore, "findConnectionByUserId" | "markRevokedIfCurrent">;
	mappings: Pick<GmailMappingStore, "findMapping">;
	findMarkImportedSince: FindMarkImportedSince;
	completions: Pick<EmailImportCompletionStore, "listCompletionsBefore">;
	links: Pick<InboxEmailLinkStore, "findLinksMeta">;
	openMailbox: OpenGmailMailboxForUpdate;
	dispatchPage: (detail: ProcessGmailMarkBackfillPageDetail) => Promise<void>;
	publishEvent: PublishEvent;
	logger: HutchLogger;
	now: () => Date;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { backfills, logger, now } = deps;

	function skipped(input: { reason: string; job: GmailMarkBackfillRef; generation: number; page: number }): void {
		logger.info("[gmail-mark-backfill] page skipped", { reason: input.reason, userId: input.job.userId, generation: input.generation, page: input.page });
	}

	async function cancel(job: GmailMarkBackfillJob, reason: GmailMarkBackfillCancelReason): Promise<PageEnd> {
		const result = await backfills.cancelBackfill({ userId: job.userId, accountEmail: job.accountEmail, senderEmail: job.senderEmail, generation: job.generation, reason, now: now() });
		logger.info("[gmail-mark-backfill] cancelled", { reason, result, userId: job.userId, generation: job.generation });
		return { kind: "stopped" };
	}

	async function fail(job: GmailMarkBackfillJob, reason: GmailMarkBackfillFailureReason): Promise<PageEnd> {
		const result = await backfills.failBackfill({ userId: job.userId, accountEmail: job.accountEmail, senderEmail: job.senderEmail, generation: job.generation, reason, now: now() });
		logger.info("[gmail-mark-backfill] failed", { reason, result, userId: job.userId, generation: job.generation });
		return { kind: "stopped" };
	}

	async function reauthRequired(job: GmailMarkBackfillJob): Promise<PageEnd> {
		const connection = await deps.connections.findConnectionByUserId(job.userId);
		const current = { job, connection };
		if (!sameConnection(current)) return cancel(job, "disconnected");
		await deps.connections.markRevokedIfCurrent({
			userId: job.userId,
			gatewayAddress: current.connection.gatewayAddress,
			connectedAt: current.connection.connectedAt,
			reason: "invalid-grant",
		});
		return fail(job, "permission-revoked");
	}

	async function markEmail(input: {
		job: GmailMarkBackfillJob;
		mailbox: OpenedGmailMailbox;
		labelId: string;
		email: EmailImportCandidate;
		origins: GmailMessageOrigin[];
	}): Promise<EmailOutcome | "reauth-required"> {
		const { job } = input;
		let worst: EmailOutcome = "alreadyMarked";
		for (const origin of input.origins) {
			const recorded = await deps.updates.recordPending({ userId: job.userId, receivedAtMessageId: input.email.receivedAtMessageId, origin, now: now() });
			let outcome: EmailOutcome;
			if (recorded.status === "completed") {
				outcome = "alreadyMarked";
			} else if (recorded.status === "failed") {
				outcome = recorded.failureReason === "original-not-found" ? "notFound" : "failed";
			} else {
				const marked = await markOriginal({ mailbox: input.mailbox, origin, labelId: input.labelId });
				if (marked.kind === "reauth-required") return "reauth-required";
				if (marked.kind === "marked") {
					await deps.updates.markCompleted({ userId: job.userId, origin, now: now() });
					outcome = "marked";
				} else {
					await deps.updates.markFailed({ userId: job.userId, origin, reason: marked.reason, now: now() });
					outcome = marked.reason === "original-not-found" ? "notFound" : "failed";
				}
			}
			if (OUTCOME_SEVERITY[outcome] > OUTCOME_SEVERITY[worst]) worst = outcome;
		}
		return worst;
	}

	async function markRows(input: { job: GmailMarkBackfillJob; mailbox: OpenedGmailMailbox; labelId: string; startedAt: number }): Promise<PageEnd> {
		const { job } = input;
		let cursor = job.cursor ?? job.optionEnabledAt;
		let counts = ZERO_GMAIL_MARK_BACKFILL_COUNTS;
		let rowsRead = 0;
		let eligibleDone = 0;
		while (rowsRead < ROWS_PER_PAGE) {
			const batch = await deps.completions.listCompletionsBefore({ userId: job.userId, before: cursor, limit: Math.min(ROWS_PER_READ, ROWS_PER_PAGE - rowsRead) });
			rowsRead += batch.emails.length;
			for (const email of batch.emails) {
				if (eligibleDone === ELIGIBLE_EMAILS_PER_PAGE) return { kind: "finished", exhausted: false, cursor, counts };
				const meta = needsLinksMeta({ email, job })
					? await deps.links.findLinksMeta({ userId: job.userId, receivedAtMessageId: email.receivedAtMessageId })
					: undefined;
				const classified = classifyMarkBackfillEmail({ email, meta, job });
				if (classified.kind === "eligible") {
					if (now().getTime() - input.startedAt >= PAGE_TIME_BUDGET_MS) return { kind: "finished", exhausted: false, cursor, counts };
					const since = await deps.findMarkImportedSince({ userId: job.userId, accountEmail: job.accountEmail, senderEmail: job.senderEmail });
					if (since !== job.optionEnabledAt) return cancel(job, "option-off");
					const outcome = await markEmail({ ...input, email, origins: classified.origins });
					if (outcome === "reauth-required") return reauthRequired(job);
					counts = counted(counts, outcome);
					eligibleDone += 1;
				} else if (classified.kind === "not-saved") {
					counts = counted(counts, "notSaved");
				} else if (classified.kind === "unlocatable") {
					counts = counted(counts, "unlocatable");
				}
				cursor = email.receivedAtMessageId;
			}
			if (batch.exhausted) return { kind: "finished", exhausted: true, cursor, counts };
		}
		return { kind: "finished", exhausted: false, cursor, counts };
	}

	async function processPage(input: GmailMarkBackfillRef & { generation: number; page: number }): Promise<void> {
		const startedAt = now().getTime();
		const job = await backfills.findBackfill(input);
		const guard = { job: input, generation: input.generation, page: input.page };
		if (job === undefined) return skipped({ ...guard, reason: "job-missing" });
		if (job.generation !== input.generation) return skipped({ ...guard, reason: "generation-stale" });
		if (!RUNNABLE_STATES.has(job.state)) return skipped({ ...guard, reason: "not-runnable" });
		if (input.page < job.page) return skipped({ ...guard, reason: "page-already-processed" });
		if (input.page > job.page) return skipped({ ...guard, reason: "page-mismatch" });

		const connection = await deps.connections.findConnectionByUserId(job.userId);
		if (!sameConnection({ job, connection })) {
			await cancel(job, "disconnected");
			return;
		}
		const mapping = await deps.mappings.findMapping(job);
		if (mapping === undefined) {
			await cancel(job, "mapping-removed");
			return;
		}
		if (mapping.markImportedAt !== job.optionEnabledAt) {
			await cancel(job, "option-off");
			return;
		}
		if (!(await backfills.claimPage({ ...input, now: now() }))) return skipped({ ...guard, reason: "claim-lost" });

		const opened = await deps.openMailbox({ userId: job.userId, accountEmail: job.accountEmail });
		if (!opened.ok) {
			if (opened.reason === "unavailable") throw new GmailUnavailableError(`Gmail unavailable (${opened.status})`);
			if (opened.reason === "reauth-required") await reauthRequired(job);
			else if (opened.reason === "modify-permission-required") await fail(job, "permission-revoked");
			else await cancel(job, "disconnected");
			return;
		}
		const labelId = await importedLabelId(opened.mailbox);
		if (!labelId.ok) {
			if (labelId.outcome.kind === "reauth-required") await reauthRequired(job);
			else await fail(job, "gmail-rejected");
			return;
		}

		const end = await markRows({ job, mailbox: opened.mailbox, labelId: labelId.value, startedAt });
		if (end.kind === "stopped") return;
		const step = { userId: job.userId, accountEmail: job.accountEmail, senderEmail: job.senderEmail, generation: job.generation, page: job.page, counts: end.counts, now: now() };
		if (end.exhausted) {
			await backfills.complete(step);
			return;
		}
		await deps.publishEvent(GmailMarkBackfillPageProcessedEvent, {
			userId: job.userId,
			accountEmail: job.accountEmail,
			senderEmail: job.senderEmail,
			nextPage: { generation: job.generation, page: job.page + 1 },
		});
		await backfills.savePage({ ...step, cursor: end.cursor });
	}

	async function processRecord(record: SQSRecord): Promise<void> {
		const envelope = GmailMarkBackfillEnvelope.parse(JSON.parse(record.body));
		const ref = envelopeRef(envelope);
		if (envelope.kind === "progress") {
			await deps.dispatchPage({ ...ref, ...envelope.detail.nextPage });
			return;
		}
		if (envelope.kind === "page") {
			await processPage({ ...ref, generation: envelope.detail.generation, page: envelope.detail.page });
			return;
		}
		const job = await backfills.findBackfill(ref);
		const guard = { job: ref, generation: envelope.detail.generation, page: 0 };
		if (job === undefined) return skipped({ ...guard, reason: "job-missing" });
		if (job.generation !== envelope.detail.generation) return skipped({ ...guard, reason: "generation-stale" });
		if (job.state !== "queued") return skipped({ ...guard, reason: "not-runnable" });
		await deps.dispatchPage({ ...ref, generation: job.generation, page: job.page });
	}

	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];
		for (const record of event.Records) {
			try {
				await processRecord(record);
			} catch (error) {
				logger.error("[gmail-mark-backfill] record failed", { messageId: record.messageId, error });
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}
		return { batchItemFailures };
	};
}

export function initGmailMarkBackfillDlqHandler(deps: {
	failBackfill: GmailMarkBackfillStore["failBackfill"];
	logger: HutchLogger;
	now: () => Date;
}): Handler<SQSEvent, SQSBatchResponse> {
	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];
		for (const record of event.Records) {
			try {
				const envelope = GmailMarkBackfillEnvelope.parse(JSON.parse(record.body));
				const ref = envelopeRef(envelope);
				const generation = envelope.kind === "progress" ? envelope.detail.nextPage.generation : envelope.detail.generation;
				const result = await deps.failBackfill({ ...ref, generation, reason: "dead-lettered", now: deps.now() });
				deps.logger.info("[gmail-mark-backfill-dlq] backfill dead-lettered", { result, userId: ref.userId, generation });
			} catch (error) {
				deps.logger.error("[gmail-mark-backfill-dlq] record failed", { messageId: record.messageId, error });
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}
		return { batchItemFailures };
	};
}
