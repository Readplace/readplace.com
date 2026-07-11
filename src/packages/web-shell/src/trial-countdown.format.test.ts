import { SERVER_TIME_ZONE } from "./local-time.format";
import {
	deriveTrialEscalation,
	formatCancellationEndsLabel,
	formatTrialDisplay,
	formatTrialRemaining,
	type TrialDisplay,
} from "./trial-countdown.format";

const ONE_SECOND_MS = 1000;
const ONE_MINUTE_MS = 60 * ONE_SECOND_MS;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

describe("formatTrialRemaining", () => {
	it("breaks the remaining window into days/hours/minutes/seconds", () => {
		const now = new Date("2026-01-01T00:00:00.000Z");
		const endsAt = new Date(
			now.getTime() + 13 * ONE_DAY_MS + 12 * ONE_HOUR_MS + 33 * ONE_MINUTE_MS + 22 * ONE_SECOND_MS,
		).toISOString();
		expect(formatTrialRemaining(endsAt, now)).toEqual({
			days: 13,
			hours: 12,
			minutes: 33,
			seconds: 22,
			totalMs:
				13 * ONE_DAY_MS + 12 * ONE_HOUR_MS + 33 * ONE_MINUTE_MS + 22 * ONE_SECOND_MS,
		});
	});

	it("clamps a past endsAt to zero remaining so an expired trial reports totalMs=0", () => {
		const now = new Date("2026-01-01T00:00:00.000Z");
		const endsAt = new Date(now.getTime() - ONE_DAY_MS).toISOString();
		expect(formatTrialRemaining(endsAt, now)).toEqual({
			days: 0,
			hours: 0,
			minutes: 0,
			seconds: 0,
			totalMs: 0,
		});
	});

	it("reports exactly zero across the boundary so the client sees totalMs<=0 once and only once", () => {
		const now = new Date("2026-01-01T00:00:00.000Z");
		expect(formatTrialRemaining(now.toISOString(), now).totalMs).toBe(0);
	});
});

describe("deriveTrialEscalation", () => {
	const baseRemaining = { days: 0, hours: 0, minutes: 0, seconds: 0 };

	it("returns 'soft' when more than seven days remain", () => {
		expect(
			deriveTrialEscalation({ ...baseRemaining, totalMs: 8 * ONE_DAY_MS }),
		).toBe("soft");
	});

	it("returns 'moderate' when between one and seven days remain", () => {
		expect(
			deriveTrialEscalation({ ...baseRemaining, totalMs: 3 * ONE_DAY_MS }),
		).toBe("moderate");
		expect(
			deriveTrialEscalation({ ...baseRemaining, totalMs: 7 * ONE_DAY_MS }),
		).toBe("moderate");
	});

	it("returns 'urgent' when between one hour and one day remain", () => {
		expect(
			deriveTrialEscalation({ ...baseRemaining, totalMs: 5 * ONE_HOUR_MS }),
		).toBe("urgent");
		expect(
			deriveTrialEscalation({ ...baseRemaining, totalMs: ONE_DAY_MS }),
		).toBe("urgent");
	});

	it("returns 'critical' when less than one hour remains", () => {
		expect(
			deriveTrialEscalation({ ...baseRemaining, totalMs: 30 * ONE_MINUTE_MS }),
		).toBe("critical");
		expect(
			deriveTrialEscalation({ ...baseRemaining, totalMs: 0 }),
		).toBe("critical");
	});
});

describe("formatTrialDisplay", () => {
	function active(remaining: {
		days: number;
		hours: number;
		minutes: number;
		seconds: number;
	}) {
		return formatTrialDisplay(
			{
				state: "active",
				endsAtIso: "2026-01-15T00:00:00.000Z",
				serverNowIso: "2026-01-01T00:00:00.000Z",
				remaining: { ...remaining, totalMs: 1 },
				escalation: "soft",
			},
			SERVER_TIME_ZONE,
		);
	}

	it("drops minutes and seconds when at least one day remains so multi-day trials show a stable `Xd Yh`", () => {
		expect(active({ days: 13, hours: 12, minutes: 33, seconds: 22 })).toBe(
			"13d 12h left in your free trial",
		);
	});

	it("falls back to `Xh Ym` when less than a day remains so the user sees minute-by-minute progress", () => {
		expect(active({ days: 0, hours: 2, minutes: 33, seconds: 22 })).toBe(
			"2h 33m left in your free trial",
		);
	});

	it("falls back to `Xm Ys` when less than an hour remains so the user sees the second tick", () => {
		expect(active({ days: 0, hours: 0, minutes: 5, seconds: 22 })).toBe(
			"5m 22s left in your free trial",
		);
	});

	it("falls back to bare `Ys` when less than a minute remains so the final countdown isn't padded with `0d 0h 0m`", () => {
		expect(active({ days: 0, hours: 0, minutes: 0, seconds: 53 })).toBe(
			"53s left in your free trial",
		);
	});

	it("renders the expired state as the standalone 'Subscription not active' message — unified for trial-expired and post-cancellation", () => {
		expect(formatTrialDisplay({ state: "expired" }, SERVER_TIME_ZONE)).toBe(
			"Subscription not active",
		);
	});

	it("renders cancellation-scheduled as the compact 'Ends <date>' so the chip stays one line in the crowded header", () => {
		expect(
			formatTrialDisplay(
				{
					state: "cancellation-scheduled",
					endsAtIso: "2026-06-22T10:00:00.000Z",
					serverNowIso: "2026-05-23T12:00:00.000Z",
				},
				SERVER_TIME_ZONE,
			),
		).toBe("Ends Jun 22, 2026");
	});

	it("renders the end date in the viewer's zone, rolling to the next calendar day for a zone that is already past midnight when the UTC baseline is not", () => {
		const display: TrialDisplay = {
			state: "cancellation-scheduled",
			endsAtIso: "2026-06-22T23:30:00.000Z",
			serverNowIso: "2026-05-23T12:00:00.000Z",
		};
		expect(formatTrialDisplay(display, SERVER_TIME_ZONE)).toBe("Ends Jun 22, 2026");
		expect(formatTrialDisplay(display, "Australia/Brisbane")).toBe("Ends Jun 23, 2026");
	});
});

describe("formatCancellationEndsLabel", () => {
	it("spells out the full 'Subscription ends on <date>' sentence for the chip's aria-label and tooltip", () => {
		expect(
			formatCancellationEndsLabel({
				endsAtIso: "2026-06-22T10:00:00.000Z",
				timeZone: SERVER_TIME_ZONE,
			}),
		).toBe("Subscription ends on Jun 22, 2026");
	});

	it("localises the aria-label date too, so assistive tech and the hover tooltip agree with the chip's visible text", () => {
		expect(
			formatCancellationEndsLabel({
				endsAtIso: "2026-06-22T23:30:00.000Z",
				timeZone: "Australia/Brisbane",
			}),
		).toBe("Subscription ends on Jun 23, 2026");
	});
});
