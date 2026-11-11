import assert from "node:assert/strict";
import { cooldownAfterRateLimit } from "./retry-after";

const receivedAt = new Date("2026-11-08T10:00:00.000Z");

describe("cooldownAfterRateLimit", () => {
	it("adds delta-seconds and the five-second margin to the receive time", () => {
		const cooldown = cooldownAfterRateLimit({
			retryAfter: " 120 ",
			responseDate: undefined,
			receivedAt,
			repeatedInOperation: false,
		});
		assert.deepEqual(cooldown, {
			cooldownUntil: new Date("2026-11-08T10:02:05.000Z"),
			source: "delta-seconds",
		});
	});

	it("measures an HTTP-date against the response Date header to cancel clock skew", () => {
		const cooldown = cooldownAfterRateLimit({
			retryAfter: "Sun, 08 Nov 2026 09:31:00 GMT",
			responseDate: "Sun, 08 Nov 2026 09:30:00 GMT",
			receivedAt,
			repeatedInOperation: false,
		});
		assert.deepEqual(cooldown, {
			cooldownUntil: new Date("2026-11-08T10:01:05.000Z"),
			source: "http-date",
		});
	});

	it("measures an HTTP-date against the receive time when the Date header is missing or invalid", () => {
		for (const responseDate of [undefined, "yesterday"]) {
			const cooldown = cooldownAfterRateLimit({
				retryAfter: "Sun, 08 Nov 2026 10:10:00 GMT",
				responseDate,
				receivedAt,
				repeatedInOperation: false,
			});
			assert.deepEqual(cooldown.cooldownUntil, new Date("2026-11-08T10:10:05.000Z"));
		}
	});

	it("keeps only the margin for an HTTP-date already in the past", () => {
		const cooldown = cooldownAfterRateLimit({
			retryAfter: "Sun, 08 Nov 2026 09:00:00 GMT",
			responseDate: undefined,
			receivedAt,
			repeatedInOperation: false,
		});
		assert.deepEqual(cooldown.cooldownUntil, new Date("2026-11-08T10:00:05.000Z"));
	});

	it.each([undefined, "", "soon", "-5", "Mon, not a date"])(
		"uses sixty seconds when Retry-After is %p",
		(retryAfter) => {
			const cooldown = cooldownAfterRateLimit({
				retryAfter,
				responseDate: undefined,
				receivedAt,
				repeatedInOperation: false,
			});
			assert.deepEqual(cooldown, {
				cooldownUntil: new Date("2026-11-08T10:01:00.000Z"),
				source: "missing-or-invalid",
			});
		},
	);

	it("uses six hundred seconds for a repeated 429 without a valid value", () => {
		const cooldown = cooldownAfterRateLimit({
			retryAfter: undefined,
			responseDate: undefined,
			receivedAt,
			repeatedInOperation: true,
		});
		assert.deepEqual(cooldown, {
			cooldownUntil: new Date("2026-11-08T10:10:00.000Z"),
			source: "repeated-in-operation",
		});
	});

	it("never shortens a valid delay, even one longer than any Lambda or queue limit", () => {
		const cooldown = cooldownAfterRateLimit({
			retryAfter: "86400",
			responseDate: undefined,
			receivedAt,
			repeatedInOperation: true,
		});
		assert.deepEqual(cooldown.cooldownUntil, new Date("2026-11-09T10:00:05.000Z"));
	});

	it("holds an unrepresentably long delay at the latest representable date", () => {
		const cooldown = cooldownAfterRateLimit({
			retryAfter: "9".repeat(400),
			responseDate: undefined,
			receivedAt,
			repeatedInOperation: false,
		});
		assert.equal(cooldown.cooldownUntil.getTime(), 8.64e15);
	});
});
