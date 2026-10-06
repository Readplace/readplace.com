import { QUEUE_DIGEST_MIN_GAP_MS, QUEUE_DIGEST_MIN_SAVE_AGE_DAYS, QUEUE_DIGEST_MIN_SAVE_AGE_MS } from "./queue-digest-cadence";

const HOUR_MS = 60 * 60 * 1000;

describe("queue digest cadence", () => {
	it("holds a regular digest until 7 days less half an hour after the last one, so a 6-hourly scan landing a little early still sends", () => {
		expect(QUEUE_DIGEST_MIN_GAP_MS).toBe(167.5 * HOUR_MS);
	});

	it("lists only saves at least 30 days old", () => {
		expect(QUEUE_DIGEST_MIN_SAVE_AGE_DAYS).toBe(30);
		expect(QUEUE_DIGEST_MIN_SAVE_AGE_MS).toBe(30 * 24 * HOUR_MS);
	});
});
