import { SESSION_TTL_SECONDS } from "./session-row";
import { isSessionDueForRenewal } from "./session-renewal";

const now = new Date("2026-09-21T00:00:00.000Z");
const nowSeconds = Math.floor(now.getTime() / 1000);

describe("isSessionDueForRenewal", () => {
	it("is not due at exactly one day after the last stamp, so a quiet day costs no write", () => {
		const sessionExpiresAt = nowSeconds + SESSION_TTL_SECONDS - 24 * 60 * 60;
		expect(isSessionDueForRenewal({ sessionExpiresAt, now })).toBe(false);
	});

	it("is due one second past a day, so an active reader costs at most one write a day", () => {
		const sessionExpiresAt = nowSeconds + SESSION_TTL_SECONDS - 24 * 60 * 60 - 1;
		expect(isSessionDueForRenewal({ sessionExpiresAt, now })).toBe(true);
	});
});
