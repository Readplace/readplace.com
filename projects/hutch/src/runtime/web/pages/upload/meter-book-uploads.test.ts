import assert from "node:assert/strict";
import type { MediaUploadSession } from "@packages/domain";
import { SaveAttemptIdSchema } from "@packages/domain/article";
import type { RateLimitDecision } from "@packages/domain/rate-limit";
import { UserIdSchema } from "@packages/domain/user";
import { AUDIO, BOOK, UploadIdSchema } from "@packages/media-contracts";
import type { ConsumeRateLimit } from "@packages/provider-contracts/rate-limit";
import type { EffectiveAccess, GetEffectiveAccess } from "@packages/subscription-access";
import type { SettleReceivedUpload } from "./commit-received-upload";
import { initMeterBookUploads } from "./meter-book-uploads";

const uploadId = UploadIdSchema.parse("0123456789abcdef0123456789abcdef");
const userId = UserIdSchema.parse("00000000000000000000000000000001");
const session: MediaUploadSession = {
	uploadId,
	userId,
	kind: "book",
	saveAttemptId: SaveAttemptIdSchema.parse("attempt-1"),
	status: "staged",
};
const bookParams = { session, kind: BOOK, etag: '"e1"', size: 10 };
const audioParams = { session: { ...session, kind: "audio" as const }, kind: AUDIO, etag: '"e1"', size: 10 };
const rule = { limit: 9, windowSeconds: 86_400 };
const now = new Date("2026-11-13T21:30:00.000Z");
const INACTIVE: EffectiveAccess = {
	tier: "free",
	banner: "free",
	reason: "subscription-cancelled",
	plan: undefined,
};
const FOUNDING: EffectiveAccess = { tier: "founding", banner: "none" };

function accessOf(access: EffectiveAccess): GetEffectiveAccess {
	return async () => access;
}

function recordingLimiter(decision: RateLimitDecision) {
	const consumed: Parameters<ConsumeRateLimit>[0][] = [];
	const consumeRateLimit: ConsumeRateLimit = async (params) => {
		consumed.push(params);
		return decision;
	};
	return { consumed, consumeRateLimit };
}

function recordingSettle() {
	const settled: Parameters<SettleReceivedUpload>[0][] = [];
	const settle: SettleReceivedUpload = async (params) => {
		settled.push(params);
		return { outcome: "committed", uploadId };
	};
	return { settled, settle };
}

describe("initMeterBookUploads", () => {
	it("counts a metered account's book against the day and settles it while it fits", async () => {
		const { consumed, consumeRateLimit } = recordingLimiter({ allowed: true });
		const { settled, settle } = recordingSettle();
		const commit = initMeterBookUploads({
			getEffectiveAccess: accessOf(INACTIVE),
			consumeRateLimit,
			rule,
			now: () => now,
			settle,
		});

		assert.deepEqual(await commit(bookParams), { outcome: "committed", uploadId });
		assert.deepEqual(consumed, [{ bucket: "book-upload", key: userId, rule }]);
		assert.deepEqual(settled, [bookParams]);
	});

	it("refuses a metered account's book past the day's limit with the instant it may retry, without settling", async () => {
		const { consumeRateLimit } = recordingLimiter({ allowed: false, retryAfterSeconds: 9000 });
		const { settled, settle } = recordingSettle();
		const commit = initMeterBookUploads({
			getEffectiveAccess: accessOf(INACTIVE),
			consumeRateLimit,
			rule,
			now: () => now,
			settle,
		});

		assert.deepEqual(await commit(bookParams), {
			outcome: "book-quota",
			retryAt: new Date("2026-11-14T00:00:00.000Z"),
		});
		assert.deepEqual(settled, []);
	});

	it("settles a full-access account's book without reading the limiter", async () => {
		const { consumed, consumeRateLimit } = recordingLimiter({ allowed: false, retryAfterSeconds: 9000 });
		const { settled, settle } = recordingSettle();
		const commit = initMeterBookUploads({
			getEffectiveAccess: accessOf(FOUNDING),
			consumeRateLimit,
			rule,
			now: () => now,
			settle,
		});

		assert.deepEqual(await commit(bookParams), { outcome: "committed", uploadId });
		assert.deepEqual(consumed, []);
		assert.deepEqual(settled, [bookParams]);
	});

	it("settles a metered account's audio without counting it as a book", async () => {
		const { consumed, consumeRateLimit } = recordingLimiter({ allowed: false, retryAfterSeconds: 9000 });
		const { settled, settle } = recordingSettle();
		const commit = initMeterBookUploads({
			getEffectiveAccess: accessOf(INACTIVE),
			consumeRateLimit,
			rule,
			now: () => now,
			settle,
		});

		assert.deepEqual(await commit(audioParams), { outcome: "committed", uploadId });
		assert.deepEqual(consumed, []);
		assert.deepEqual(settled, [audioParams]);
	});
});
