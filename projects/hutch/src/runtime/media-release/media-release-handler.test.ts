import assert from "node:assert/strict";
import { calculateReadTime } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { Logger, noopLogger } from "@packages/logger";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import {
	initInMemoryTranscriptCharge,
	initInMemoryTranscriptLedger,
	initInMemoryTranscriptQuotaRows,
} from "@packages/test-fixtures/providers/transcript-quota";
import { initMediaReleaseHandler } from "./media-release-handler";
import { initPrivateItemReleaseSteps, initReleasePrivateItem } from "./private-item-release-steps";

const UPLOAD_ID = "0123456789abcdef0123456789abcdef";
const PRIVATE_URL = `https://uploads.readplace.invalid/${UPLOAD_ID}`;
const OWNER = UserIdSchema.parse("a".repeat(32));
const OTHER = UserIdSchema.parse("b".repeat(32));

async function buildSubject(overrides: { failRowDelete?: boolean } = {}) {
	const store = initInMemoryArticleStore();
	await store.saveArticle({
		userId: OWNER,
		url: PRIVATE_URL,
		metadata: { title: "A private book", siteName: "Private press", excerpt: "", wordCount: 3 },
		estimatedReadTime: calculateReadTime(3),
		provenance: { kind: "web" },
		savedAt: new Date("2026-09-01T00:00:00.000Z"),
	});
	await store.recordItemOwner({ url: PRIVATE_URL, ownerUserId: OWNER });
	const calls: string[] = [];
	const quotaRows = initInMemoryTranscriptQuotaRows();
	const ledger = initInMemoryTranscriptLedger({ rows: quotaRows });
	await initInMemoryTranscriptCharge({
		rows: quotaRows,
		allowanceSeconds: 1250,
		now: () => new Date("2026-11-09T10:00:00.000Z"),
	}).chargeTranscriptQuota({ userId: OWNER, uploadId: UPLOAD_ID, attempt: 1, seconds: 361 });
	await ledger.markTranscriptStarted({ userId: OWNER, uploadId: UPLOAD_ID, attempt: 1 });
	const steps = initPrivateItemReleaseSteps({
		purgeArticleContent: async (url) => {
			calls.push(`content:${url}`);
		},
		deleteMediaObjects: async (keys) => {
			calls.push(`media:${keys.join(",")}`);
		},
		listMediaKeys: async (prefix) =>
			prefix.startsWith("transcripts/") ? [`${prefix}1.input.mp3`, `${prefix}1.json`] : [`${prefix}cover.png`, `${prefix}figure-1.jpg`],
		deleteArticleRow: async (url) => {
			if (overrides.failRowDelete) throw new Error("DeleteItem failed");
			calls.push(`row:${url}`);
		},
		mediaObjects: {
			unrefAll: async ({ uploadId }) => {
				calls.push(`holdings:${uploadId}`);
			},
		},
		deleteUserArticleLinks: async (url) => {
			calls.push(`links:${url}`);
		},
		settleStartedCharge: async (ref) => {
			const settled = await ledger.settleStartedCharge(ref);
			calls.push(`charge:${ref.uploadId}:${settled.outcome}`);
			return settled;
		},
	});
	const handler = initMediaReleaseHandler({
		releasePrivateItem: initReleasePrivateItem({ findItemOwner: store.findItemOwner, steps }),
		logger: Logger.from(noopLogger),
	});
	return { calls, handler, chargeState: () => quotaRows.charges.get(`${OWNER}#${UPLOAD_ID}#1`)?.state };
}

function dequeued(userId: string) {
	return buildSqsEvent([{ messageId: "m1", body: JSON.stringify({ detail: { url: PRIVATE_URL, userId } }) }]);
}

describe("initMediaReleaseHandler", () => {
	it("releases the owner's item: content, pending original, book images, transcripts, started charge, row, then links", async () => {
		const { calls, handler } = await buildSubject();

		const result = await handler(dequeued(OWNER), buildLambdaContext(), () => {});

		assert.deepEqual(result, { batchItemFailures: [] });
		assert.deepEqual(calls, [
			`content:${PRIVATE_URL}`,
			`media:pending/${UPLOAD_ID}/original`,
			`media:images/${UPLOAD_ID}/cover.png,images/${UPLOAD_ID}/figure-1.jpg`,
			`media:transcripts/${UPLOAD_ID}/1.input.mp3,transcripts/${UPLOAD_ID}/1.json`,
			`charge:${UPLOAD_ID}:settled`,
			`row:${PRIVATE_URL}`,
			`holdings:${UPLOAD_ID}`,
			`links:${PRIVATE_URL}`,
		]);
	});

	it("settles a started charge when the dequeue arrives while the job runs", async () => {
		const { handler, chargeState } = await buildSubject();

		await handler(dequeued(OWNER), buildLambdaContext(), () => {});

		assert.equal(chargeState(), "settled");
	});

	it("runs no release step when a non-owner who holds the private url dequeues it", async () => {
		const { calls, handler, chargeState } = await buildSubject();

		const result = await handler(dequeued(OTHER), buildLambdaContext(), () => {});

		assert.deepEqual(result, { batchItemFailures: [] });
		assert.deepEqual(calls, []);
		assert.equal(chargeState(), "started");
	});

	it("fails the record when a step throws, so SQS retries it", async () => {
		const { calls, handler } = await buildSubject({ failRowDelete: true });

		const result = await handler(dequeued(OWNER), buildLambdaContext(), () => {});

		assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "m1" }] });
		assert.deepEqual(calls, [
			`content:${PRIVATE_URL}`,
			`media:pending/${UPLOAD_ID}/original`,
			`media:images/${UPLOAD_ID}/cover.png,images/${UPLOAD_ID}/figure-1.jpg`,
			`media:transcripts/${UPLOAD_ID}/1.input.mp3,transcripts/${UPLOAD_ID}/1.json`,
			`charge:${UPLOAD_ID}:settled`,
		]);
	});
});
