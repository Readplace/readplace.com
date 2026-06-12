import assert from "node:assert/strict";
import { initInMemoryRateLimit } from "./in-memory-rate-limit";

const HOUR_RULE = { limit: 2, windowSeconds: 3600 };

function createMutableClock(startMs: number) {
	let nowMs = startMs;
	return {
		now: () => new Date(nowMs),
		advanceSeconds: (seconds: number) => {
			nowMs += seconds * 1000;
		},
	};
}

describe("initInMemoryRateLimit", () => {
	it("allows requests up to the limit within one window", async () => {
		const clock = createMutableClock(0);
		const { consumeRateLimit } = initInMemoryRateLimit({ now: clock.now });

		const first = await consumeRateLimit({ bucket: "login", key: "1.2.3.4", rule: HOUR_RULE });
		const second = await consumeRateLimit({ bucket: "login", key: "1.2.3.4", rule: HOUR_RULE });

		assert.deepEqual(first, { allowed: true });
		assert.deepEqual(second, { allowed: true });
	});

	it("denies the request past the limit and reports seconds until the window resets", async () => {
		const clock = createMutableClock(0);
		const { consumeRateLimit } = initInMemoryRateLimit({ now: clock.now });
		await consumeRateLimit({ bucket: "login", key: "1.2.3.4", rule: HOUR_RULE });
		await consumeRateLimit({ bucket: "login", key: "1.2.3.4", rule: HOUR_RULE });

		clock.advanceSeconds(600);
		const denied = await consumeRateLimit({ bucket: "login", key: "1.2.3.4", rule: HOUR_RULE });

		assert.deepEqual(denied, { allowed: false, retryAfterSeconds: 3000 });
	});

	it("starts a fresh count once the window rolls over", async () => {
		const clock = createMutableClock(0);
		const { consumeRateLimit } = initInMemoryRateLimit({ now: clock.now });
		await consumeRateLimit({ bucket: "login", key: "1.2.3.4", rule: HOUR_RULE });
		await consumeRateLimit({ bucket: "login", key: "1.2.3.4", rule: HOUR_RULE });

		clock.advanceSeconds(HOUR_RULE.windowSeconds);
		const afterReset = await consumeRateLimit({ bucket: "login", key: "1.2.3.4", rule: HOUR_RULE });

		assert.deepEqual(afterReset, { allowed: true });
	});

	it("counts each client key independently", async () => {
		const clock = createMutableClock(0);
		const { consumeRateLimit } = initInMemoryRateLimit({ now: clock.now });
		const exhaustedKey = "1.2.3.4";
		await consumeRateLimit({ bucket: "login", key: exhaustedKey, rule: HOUR_RULE });
		await consumeRateLimit({ bucket: "login", key: exhaustedKey, rule: HOUR_RULE });

		const otherClient = await consumeRateLimit({ bucket: "login", key: "5.6.7.8", rule: HOUR_RULE });

		assert.deepEqual(otherClient, { allowed: true });
	});

	it("counts each bucket independently for the same client key", async () => {
		const clock = createMutableClock(0);
		const { consumeRateLimit } = initInMemoryRateLimit({ now: clock.now });
		await consumeRateLimit({ bucket: "login", key: "1.2.3.4", rule: HOUR_RULE });
		await consumeRateLimit({ bucket: "login", key: "1.2.3.4", rule: HOUR_RULE });

		const otherBucket = await consumeRateLimit({ bucket: "signup", key: "1.2.3.4", rule: HOUR_RULE });

		assert.deepEqual(otherBucket, { allowed: true });
	});
});
