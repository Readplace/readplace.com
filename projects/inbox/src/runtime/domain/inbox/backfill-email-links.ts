import { UNROUTED_USER_ID } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import type { UserId } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import { z } from "zod";

/** The row fields the link backfill scan projects — the event detail the
 * extraction consumer needs, nothing more (it re-reads the row itself). */
export const BackfillLinksRowSchema = z.object({
	userId: UserIdSchema,
	receivedAtMessageId: z.string().min(1),
	status: z.string(),
	recipientAddress: z.string().min(1),
});
export type BackfillLinksRow = z.infer<typeof BackfillLinksRowSchema>;

export type BackfillLinksOutcome =
	| "re-extracted"
	| "would-re-extract"
	| "skipped-not-received"
	| "skipped-unrouted"
	| "skipped-other-user"
	| "skipped-received-after-start"
	| "failed";

/**
 * Re-run link extraction for every received email so the CURRENT
 * skip/triage classification applies to mail that predates it: delete the
 * email's link rows and meta barrier, then re-publish `EmailReceivedEvent` and
 * let the DEPLOYED extraction consumer re-derive everything — action-link
 * skips, List-Unsubscribe matches, LLM triage, and the preview-crawl fan-out —
 * through the same code a fresh receive runs.
 *
 * Deleting first matters: the consumer's link writes are conditional puts, so
 * stale rows would survive re-extraction and keep their old classification.
 * A crash between the delete and the publish leaves the email in the detail
 * page's "Looking for links…" state; re-running the script converges (the
 * delete is idempotent and the consumer handles replays).
 */
export function initBackfillEmailLinks(deps: {
	scanEmailRowPages: () => AsyncIterable<BackfillLinksRow[]>;
	deleteEmailLinks: (input: { userId: UserId; receivedAtMessageId: string }) => Promise<void>;
	publishEmailReceived: (input: {
		userId: UserId;
		receivedAtMessageId: string;
		recipientAddress: string;
		origin: "backfill";
	}) => Promise<void>;
	logger: HutchLogger;
	dryRun: boolean;
	onlyUserId: string | undefined;
	/** ISO instant the run started. Mail received after it is skipped: its
	 * receive-time extraction may still be in flight, and deleting rows from
	 * under a live extraction would race it for no gain — fresh mail already
	 * has the current classification. `receivedAtMessageId` starts with the
	 * receipt ISO instant, so a plain string compare is the receipt order. */
	receivedBefore: string;
	/** Pacing pause between re-published emails so the extraction consumer's
	 * LLM triage and crawl fan-out drain steadily instead of in one burst. */
	sleepBetweenRows: () => Promise<void>;
}): () => Promise<Record<BackfillLinksOutcome, number>> {
	const { logger } = deps;

	return async () => {
		const tally: Record<BackfillLinksOutcome, number> = {
			"re-extracted": 0,
			"would-re-extract": 0,
			"skipped-not-received": 0,
			"skipped-unrouted": 0,
			"skipped-other-user": 0,
			"skipped-received-after-start": 0,
			failed: 0,
		};
		const record = (row: BackfillLinksRow, outcome: BackfillLinksOutcome) => {
			tally[outcome] += 1;
			logger.info("[backfill-email-links] row", {
				userId: row.userId,
				receivedAtMessageId: row.receivedAtMessageId,
				outcome,
			});
		};

		for await (const page of deps.scanEmailRowPages()) {
			for (const row of page) {
				const outcome = await processRow(deps, row);
				record(row, outcome);
				if (outcome === "re-extracted") {
					await deps.sleepBetweenRows();
				}
			}
		}
		logger.info("[backfill-email-links] done", { tally });
		return tally;
	};
}

async function processRow(
	deps: Parameters<typeof initBackfillEmailLinks>[0],
	row: BackfillLinksRow,
): Promise<BackfillLinksOutcome> {
	if (row.status !== "received") return "skipped-not-received";
	if (row.userId === UNROUTED_USER_ID) return "skipped-unrouted";
	if (deps.onlyUserId !== undefined && row.userId !== deps.onlyUserId) {
		return "skipped-other-user";
	}
	if (row.receivedAtMessageId >= deps.receivedBefore) return "skipped-received-after-start";
	if (deps.dryRun) return "would-re-extract";

	try {
		await deps.deleteEmailLinks({
			userId: row.userId,
			receivedAtMessageId: row.receivedAtMessageId,
		});
		await deps.publishEmailReceived({
			userId: row.userId,
			receivedAtMessageId: row.receivedAtMessageId,
			recipientAddress: row.recipientAddress,
			origin: "backfill",
		});
		return "re-extracted";
	} catch (error) {
		deps.logger.error("[backfill-email-links] row failed", {
			userId: row.userId,
			receivedAtMessageId: row.receivedAtMessageId,
			error,
		});
		return "failed";
	}
}
