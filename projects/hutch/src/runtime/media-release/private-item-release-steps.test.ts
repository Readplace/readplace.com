import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import {
	initInMemoryTranscriptCharge,
	initInMemoryTranscriptLedger,
	initInMemoryTranscriptQuotaRows,
} from "@packages/test-fixtures/providers/transcript-quota";
import { initPrivateItemReleaseSteps, initReleasePrivateItem, type ReleaseStep } from "./private-item-release-steps";

const UPLOAD_ID = "0123456789abcdef0123456789abcdef";
const PRIVATE_URL = `https://uploads.readplace.invalid/${UPLOAD_ID}`;
const OWNER = UserIdSchema.parse("a".repeat(32));
const OTHER = UserIdSchema.parse("b".repeat(32));

function recordingSteps(calls: string[]): ReleaseStep[] {
	return ["first", "second"].map((name) => async ({ url, userId }) => {
		calls.push(`${name}:${url}:${userId}`);
	});
}

describe("initReleasePrivateItem", () => {
	it("runs every step in order when the owner releases the item", async () => {
		const calls: string[] = [];
		const releasePrivateItem = initReleasePrivateItem({ findItemOwner: async () => OWNER, steps: recordingSteps(calls) });

		const outcome = await releasePrivateItem({ url: PRIVATE_URL, userId: OWNER });

		assert.equal(outcome, "released");
		assert.deepEqual(calls, [`first:${PRIVATE_URL}:${OWNER}`, `second:${PRIVATE_URL}:${OWNER}`]);
	});

	it("returns not-owner and runs no step when another user releases the item", async () => {
		const calls: string[] = [];
		const releasePrivateItem = initReleasePrivateItem({ findItemOwner: async () => OWNER, steps: recordingSteps(calls) });

		const outcome = await releasePrivateItem({ url: PRIVATE_URL, userId: OTHER });

		assert.equal(outcome, "not-owner");
		assert.deepEqual(calls, []);
	});

	it("runs every step when the row is already gone, so a replay converges", async () => {
		const calls: string[] = [];
		const releasePrivateItem = initReleasePrivateItem({ findItemOwner: async () => undefined, steps: recordingSteps(calls) });

		const outcome = await releasePrivateItem({ url: PRIVATE_URL, userId: OWNER });

		assert.equal(outcome, "released");
		assert.deepEqual(calls, [`first:${PRIVATE_URL}:${OWNER}`, `second:${PRIVATE_URL}:${OWNER}`]);
	});
});

describe("initPrivateItemReleaseSteps", () => {
	it("releases the content, the pending original, the book images, the transcripts, the started charge, the row, the media holdings, then the links", async () => {
		const calls: string[] = [];
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
			settleStartedCharge: async ({ userId, uploadId, attempt }) => {
				calls.push(`charge:${userId}:${uploadId}:${attempt}`);
				return { outcome: "settled" };
			},
		});

		for (const step of steps) {
			await step({ url: PRIVATE_URL, userId: OWNER });
		}

		assert.deepEqual(calls, [
			`content:${PRIVATE_URL}`,
			`media:pending/${UPLOAD_ID}/original`,
			`media:images/${UPLOAD_ID}/cover.png,images/${UPLOAD_ID}/figure-1.jpg`,
			`media:transcripts/${UPLOAD_ID}/1.input.mp3,transcripts/${UPLOAD_ID}/1.json`,
			`charge:${OWNER}:${UPLOAD_ID}:1`,
			`row:${PRIVATE_URL}`,
			`holdings:${UPLOAD_ID}`,
			`links:${PRIVATE_URL}`,
		]);
	});

	it("settles the owner's started transcript charge and leaves a reserved charge alone", async () => {
		const RESERVED_UPLOAD_ID = "fedcba9876543210fedcba9876543210";
		const rows = initInMemoryTranscriptQuotaRows();
		const { chargeTranscriptQuota } = initInMemoryTranscriptCharge({
			rows,
			allowanceSeconds: 1250,
			now: () => new Date("2026-11-09T10:00:00.000Z"),
		});
		const ledger = initInMemoryTranscriptLedger({ rows });
		await chargeTranscriptQuota({ userId: OWNER, uploadId: UPLOAD_ID, attempt: 1, seconds: 361 });
		await ledger.markTranscriptStarted({ userId: OWNER, uploadId: UPLOAD_ID, attempt: 1 });
		await chargeTranscriptQuota({ userId: OWNER, uploadId: RESERVED_UPLOAD_ID, attempt: 1, seconds: 61 });
		const steps = initPrivateItemReleaseSteps({
			purgeArticleContent: async () => {},
			deleteMediaObjects: async () => {},
			listMediaKeys: async () => [],
			deleteArticleRow: async () => {},
			mediaObjects: { unrefAll: async () => {} },
			deleteUserArticleLinks: async () => {},
			settleStartedCharge: ledger.settleStartedCharge,
		});

		for (const url of [PRIVATE_URL, `https://uploads.readplace.invalid/${RESERVED_UPLOAD_ID}`]) {
			for (const step of steps) {
				await step({ url, userId: OWNER });
			}
		}

		assert.equal(rows.charges.get(`${OWNER}#${UPLOAD_ID}#1`)?.state, "settled");
		assert.equal(rows.charges.get(`${OWNER}#${RESERVED_UPLOAD_ID}#1`)?.state, "reserved");
		assert.equal(rows.spentSeconds.get(`${OWNER}#2026-11-09`), 422);
	});
});
