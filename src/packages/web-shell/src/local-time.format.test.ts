import {
	formatLocalInstant,
	toAbsoluteDate,
	toAbsoluteDateTime,
	toRelativeOrDate,
} from "./local-time.format";

const ISO = "2026-06-24T09:00:00.000Z";

describe("formatLocalInstant", () => {
	it("renders a UTC datetime with a 24-hour clock and the zone abbreviation", () => {
		expect(formatLocalInstant({ iso: ISO, style: "datetime", timeZone: "UTC" })).toBe(
			"24 June 2026, 09:00 UTC",
		);
	});

	it("localises the datetime into the given zone, shifting the clock and the abbreviation", () => {
		expect(
			formatLocalInstant({ iso: ISO, style: "datetime", timeZone: "Australia/Sydney" }),
		).toBe("24 June 2026, 19:00 AEST");
		expect(
			formatLocalInstant({ iso: ISO, style: "datetime", timeZone: "America/New_York" }),
		).toBe("24 June 2026, 05:00 GMT-4");
	});

	it("falls back to a GMT offset for a zone without an abbreviation", () => {
		expect(
			formatLocalInstant({ iso: ISO, style: "datetime", timeZone: "Asia/Kolkata" }),
		).toBe("24 June 2026, 14:30 GMT+5:30");
	});

	it("renders a bare calendar date with no zone suffix", () => {
		expect(formatLocalInstant({ iso: ISO, style: "date", timeZone: "UTC" })).toBe(
			"24 June 2026",
		);
	});
});

describe("toAbsoluteDateTime", () => {
	it("carries the iso, datetime mode, and UTC baseline label", () => {
		expect(toAbsoluteDateTime({ iso: ISO })).toEqual({
			iso: ISO,
			label: "24 June 2026, 09:00 UTC",
			mode: "datetime",
		});
	});
});

describe("toAbsoluteDate", () => {
	it("carries the iso, date mode, and UTC baseline label", () => {
		expect(toAbsoluteDate({ iso: ISO })).toEqual({
			iso: ISO,
			label: "24 June 2026",
			mode: "date",
		});
	});
});

describe("toRelativeOrDate", () => {
	const now = new Date("2026-06-24T12:00:00.000Z");
	const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

	it("reports 'just now' under a minute", () => {
		expect(toRelativeOrDate({ iso: ago(30_000), now })).toEqual({
			iso: ago(30_000),
			label: "just now",
			mode: "relative",
		});
	});

	it("reports minutes under an hour", () => {
		expect(toRelativeOrDate({ iso: ago(5 * 60_000), now }).label).toBe("5m ago");
	});

	it("reports hours under a day", () => {
		expect(toRelativeOrDate({ iso: ago(3 * 3_600_000), now }).label).toBe("3h ago");
	});

	it("reports days under the 30-day cutoff", () => {
		expect(toRelativeOrDate({ iso: ago(2 * 86_400_000), now }).label).toBe("2d ago");
	});

	it("falls back to an absolute UTC date past the cutoff", () => {
		const iso = ago(60 * 86_400_000);
		expect(toRelativeOrDate({ iso, now })).toEqual({
			iso,
			label: "25 Apr 2026",
			mode: "date",
		});
	});
});
