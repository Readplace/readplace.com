import assert from "node:assert/strict";
import {
	fixedWindowRetryAfterSeconds,
	fixedWindowStartSeconds,
} from "./fixed-window";

describe("fixedWindowStartSeconds", () => {
	it("floors a mid-window timestamp to the window boundary", () => {
		const nowMs = 7_000_500; // 7000.5s → window of 3600s starting at 3600s
		assert.equal(fixedWindowStartSeconds({ nowMs, windowSeconds: 3600 }), 3600);
	});

	it("maps a timestamp exactly on the boundary to that boundary", () => {
		assert.equal(
			fixedWindowStartSeconds({ nowMs: 7_200_000, windowSeconds: 3600 }),
			7200,
		);
	});

	it("maps two timestamps inside the same window to the same start", () => {
		const first = fixedWindowStartSeconds({ nowMs: 3_600_000, windowSeconds: 3600 });
		const last = fixedWindowStartSeconds({ nowMs: 7_199_999, windowSeconds: 3600 });
		assert.equal(first, last);
	});

	it("maps timestamps in consecutive windows to different starts", () => {
		const before = fixedWindowStartSeconds({ nowMs: 7_199_999, windowSeconds: 3600 });
		const after = fixedWindowStartSeconds({ nowMs: 7_200_000, windowSeconds: 3600 });
		assert.equal(after - before, 3600);
	});
});

describe("fixedWindowRetryAfterSeconds", () => {
	it("returns the full window length at the window start", () => {
		assert.equal(
			fixedWindowRetryAfterSeconds({ nowMs: 7_200_000, windowSeconds: 3600 }),
			3600,
		);
	});

	it("returns 1 just before the window rolls over", () => {
		assert.equal(
			fixedWindowRetryAfterSeconds({ nowMs: 7_199_999, windowSeconds: 3600 }),
			1,
		);
	});

	it("rounds partial seconds up so Retry-After never undershoots", () => {
		// 2.5s left in a 60s window → a 2s Retry-After would let the client
		// retry while still inside the throttled window.
		assert.equal(
			fixedWindowRetryAfterSeconds({ nowMs: 57_500, windowSeconds: 60 }),
			3,
		);
	});
});
