import type { ParseEmailResult } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import { z } from "zod";
import type { DownloadEmailImages } from "./download-email-images";
import { emailContentResourceId } from "./email-content-id";
import type { StoreEmailBody } from "./store-email-body";

/** The row fields the backfill scan projects — everything needed to re-derive
 * a stored body from its immutable raw `.eml`, nothing more. */
export const BackfillEmailRowSchema = z.object({
	userId: UserIdSchema,
	receivedAtMessageId: z.string().min(1),
	status: z.string(),
	receivedAt: z.string().min(1),
	rawEmailS3Key: z.string().min(1),
	bodyS3Key: z.string().nullish(),
});
export type BackfillEmailRow = z.infer<typeof BackfillEmailRowSchema>;

const UNROUTED_USER_ID = "__unrouted__";

export type BackfillOutcome =
	| "rewritten"
	| "would-rewrite"
	| "skipped-not-received"
	| "skipped-no-body"
	| "skipped-unrouted"
	| "skipped-other-user"
	| "key-mismatch"
	| "missing-raw"
	| "unparseable"
	| "empty-after-sanitize"
	| "failed";

/**
 * Re-derive every stored email body from its immutable raw `.eml` through the
 * SAME download/sanitize/store pipeline the receive path runs, so bodies stored
 * before ingest-time image rehosting existed gain their images back.
 *
 * Writes ONLY the `content.html` object (via `storeBody`) — never a DynamoDB
 * row, never an event: replaying the receive handler would re-trigger link
 * extraction, LLM triage billing, and the truncation alarm. Re-runnable: the
 * derived S3 keys are deterministic and the raw `.eml` is immutable.
 */
export function initBackfillEmailImages(deps: {
	scanEmailRowPages: () => AsyncIterable<BackfillEmailRow[]>;
	readRawEmail: (s3Key: string) => Promise<Buffer | undefined>;
	parseEmail: (input: { raw: Buffer; receivedAt: string }) => Promise<ParseEmailResult>;
	downloadEmailImages: DownloadEmailImages;
	storeBody: StoreEmailBody;
	logger: HutchLogger;
	dryRun: boolean;
	onlyUserId: string | undefined;
	/** Politeness pause between rows that fetch from newsletter CDNs. */
	sleepBetweenRows: () => Promise<void>;
}): () => Promise<Record<BackfillOutcome, number>> {
	const { logger } = deps;

	return async () => {
		const tally: Record<BackfillOutcome, number> = {
			rewritten: 0,
			"would-rewrite": 0,
			"skipped-not-received": 0,
			"skipped-no-body": 0,
			"skipped-unrouted": 0,
			"skipped-other-user": 0,
			"key-mismatch": 0,
			"missing-raw": 0,
			unparseable: 0,
			"empty-after-sanitize": 0,
			failed: 0,
		};
		const record = (row: BackfillEmailRow, outcome: BackfillOutcome) => {
			tally[outcome] += 1;
			logger.info("[backfill-email-images] row", {
				userId: row.userId,
				receivedAtMessageId: row.receivedAtMessageId,
				outcome,
			});
		};

		for await (const page of deps.scanEmailRowPages()) {
			for (const row of page) {
				const outcome = await processRow(deps, row);
				record(row, outcome);
				if (outcome === "rewritten" || outcome === "empty-after-sanitize") {
					await deps.sleepBetweenRows();
				}
			}
		}
		logger.info("[backfill-email-images] done", { tally });
		return tally;
	};
}

async function processRow(
	deps: Parameters<typeof initBackfillEmailImages>[0],
	row: BackfillEmailRow,
): Promise<BackfillOutcome> {
	if (row.status !== "received") return "skipped-not-received";
	if (row.bodyS3Key === null || row.bodyS3Key === undefined) return "skipped-no-body";
	if (row.userId === UNROUTED_USER_ID) return "skipped-unrouted";
	if (deps.onlyUserId !== undefined && row.userId !== deps.onlyUserId) {
		return "skipped-other-user";
	}
	// The overwrite must land on the exact object the row points at; a derived
	// key that disagrees means the keying scheme changed and overwriting would
	// write a body nothing reads.
	const derivedKey = emailContentResourceId({
		userId: row.userId,
		receivedAtMessageId: row.receivedAtMessageId,
	}).toS3ContentKey();
	if (derivedKey !== row.bodyS3Key) return "key-mismatch";
	if (deps.dryRun) return "would-rewrite";

	try {
		const raw = await deps.readRawEmail(row.rawEmailS3Key);
		if (raw === undefined) return "missing-raw";
		const parsed = await deps.parseEmail({ raw, receivedAt: row.receivedAt });
		if (!parsed.ok) return "unparseable";
		const downloadedImages = await deps.downloadEmailImages({ html: parsed.email.html });
		const bodyS3Key = await deps.storeBody({
			userId: row.userId,
			receivedAtMessageId: row.receivedAtMessageId,
			html: parsed.email.html,
			inlineImages: parsed.email.inlineImages,
			downloadedImages,
		});
		return bodyS3Key === undefined ? "empty-after-sanitize" : "rewritten";
	} catch (error) {
		deps.logger.error("[backfill-email-images] row failed", {
			userId: row.userId,
			receivedAtMessageId: row.receivedAtMessageId,
			error,
		});
		return "failed";
	}
}
