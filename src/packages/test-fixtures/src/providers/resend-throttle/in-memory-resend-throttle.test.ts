import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryResendThrottle } from "./in-memory-resend-throttle";

const USER_ID = UserIdSchema.parse("user-1");

/** Mutable clock so each test can advance time deterministically. */
function createClock(startMs: number): { now: () => Date; advanceSeconds: (s: number) => void } {
	let currentMs = startMs;
	return {
		now: () => new Date(currentMs),
		advanceSeconds: (s) => {
			currentMs += s * 1000;
		},
	};
}

describe("initInMemoryResendThrottle", () => {
	it("allows the first attempt, then blocks an immediate retry under the default 60s cooldown", async () => {
		const clock = createClock(1_000_000_000_000);
		const { recordResendAttempt } = initInMemoryResendThrottle({ now: clock.now });

		expect(await recordResendAttempt({ userId: USER_ID })).toEqual({ ok: true });
		expect(await recordResendAttempt({ userId: USER_ID })).toEqual({
			ok: false,
			reason: "throttled",
		});
	});

	it("allows another attempt once the cooldown elapses, up to the daily cap, then blocks on the cap", async () => {
		const clock = createClock(1_000_000_000_000);
		const { recordResendAttempt } = initInMemoryResendThrottle({
			now: clock.now,
			cooldownSeconds: 60,
			cap: 3,
			windowSeconds: 3600,
		});

		expect(await recordResendAttempt({ userId: USER_ID })).toEqual({ ok: true });

		clock.advanceSeconds(60);
		expect(await recordResendAttempt({ userId: USER_ID })).toEqual({ ok: true });

		clock.advanceSeconds(60);
		expect(await recordResendAttempt({ userId: USER_ID })).toEqual({ ok: true });

		// Cooldown has elapsed but the daily cap (3) is reached → throttled.
		clock.advanceSeconds(60);
		expect(await recordResendAttempt({ userId: USER_ID })).toEqual({
			ok: false,
			reason: "throttled",
		});
	});

	it("resets the window once it expires, treating the stale row as absent", async () => {
		const clock = createClock(1_000_000_000_000);
		const { recordResendAttempt } = initInMemoryResendThrottle({
			now: clock.now,
			cooldownSeconds: 10,
			cap: 1,
			windowSeconds: 100,
		});

		expect(await recordResendAttempt({ userId: USER_ID })).toEqual({ ok: true });

		// Cooldown elapsed but the cap (1) is reached → throttled.
		clock.advanceSeconds(20);
		expect(await recordResendAttempt({ userId: USER_ID })).toEqual({
			ok: false,
			reason: "throttled",
		});

		// Window has fully elapsed → the row is treated as absent and the cap resets.
		clock.advanceSeconds(80);
		expect(await recordResendAttempt({ userId: USER_ID })).toEqual({ ok: true });
	});

	it("throttles each user independently", async () => {
		const clock = createClock(1_000_000_000_000);
		const { recordResendAttempt } = initInMemoryResendThrottle({ now: clock.now });
		const otherUser = UserIdSchema.parse("user-2");

		expect(await recordResendAttempt({ userId: USER_ID })).toEqual({ ok: true });
		expect(await recordResendAttempt({ userId: otherUser })).toEqual({ ok: true });
	});
});
