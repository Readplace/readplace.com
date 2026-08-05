import {
	formatLocalInstant,
	toAbsoluteDate,
	toAbsoluteDateTime,
	toAbsoluteShortDateTime,
	toRelativeOrDate,
	toRelativePhrase,
} from "./local-time.format";

const ISO = "2026-06-24T09:00:00.000Z";

describe("formatLocalInstant", () => {
	it("renders a UTC datetime with a 24-hour clock and the zone abbreviation", () => {
		expect(formatLocalInstant({ iso: ISO, style: "datetime", timeZone: "UTC" })).toBe(
			"Jun 24, 2026, 09:00 UTC",
		);
	});

	it("localises the datetime into the given zone, shifting the clock and the abbreviation", () => {
		expect(
			formatLocalInstant({ iso: ISO, style: "datetime", timeZone: "Australia/Sydney" }),
		).toBe("Jun 24, 2026, 19:00 GMT+10");
		expect(
			formatLocalInstant({ iso: ISO, style: "datetime", timeZone: "America/New_York" }),
		).toBe("Jun 24, 2026, 05:00 EDT");
	});

	it("falls back to a GMT offset for a zone without an abbreviation", () => {
		expect(
			formatLocalInstant({ iso: ISO, style: "datetime", timeZone: "Asia/Kolkata" }),
		).toBe("Jun 24, 2026, 14:30 GMT+5:30");
	});

	it("renders a bare calendar date with no zone suffix", () => {
		expect(formatLocalInstant({ iso: ISO, style: "date", timeZone: "UTC" })).toBe(
			"Jun 24, 2026",
		);
	});

	it("renders the short-datetime form with a 2-digit apostrophe year and no zone suffix", () => {
		expect(
			formatLocalInstant({ iso: "2026-03-26T14:32:00.000Z", style: "short-datetime", timeZone: "UTC" }),
		).toBe("26 Mar '26, 14:32");
	});

	it("localises the short-datetime form into the given zone", () => {
		expect(
			formatLocalInstant({ iso: "2026-03-26T14:32:00.000Z", style: "short-datetime", timeZone: "Australia/Sydney" }),
		).toBe("27 Mar '26, 01:32");
	});
});

describe("toAbsoluteDateTime", () => {
	it("carries the iso, datetime mode, and UTC baseline label", () => {
		expect(toAbsoluteDateTime({ iso: ISO })).toEqual({
			iso: ISO,
			label: "Jun 24, 2026, 09:00 UTC",
			mode: "datetime",
		});
	});
});

describe("toAbsoluteShortDateTime", () => {
	it("carries the iso, short-datetime mode, and UTC baseline label", () => {
		expect(toAbsoluteShortDateTime({ iso: "2026-03-26T14:32:00.000Z" })).toEqual({
			iso: "2026-03-26T14:32:00.000Z",
			label: "26 Mar '26, 14:32",
			mode: "short-datetime",
		});
	});

	it("keeps a single-digit day unpadded while zero-padding the hour", () => {
		expect(toAbsoluteShortDateTime({ iso: "2026-03-06T04:32:00.000Z" }).label).toBe(
			"6 Mar '26, 04:32",
		);
	});
});

describe("toAbsoluteDate", () => {
	it("carries the iso, date mode, and UTC baseline label", () => {
		expect(toAbsoluteDate({ iso: ISO })).toEqual({
			iso: ISO,
			label: "Jun 24, 2026",
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
			label: "Apr 25, 2026",
			mode: "date",
		});
	});
});

describe("toRelativePhrase", () => {
	const now = new Date("2026-06-24T12:00:00.000Z");
	const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
	const MINUTE = 60_000;
	const HOUR = 3_600_000;
	const DAY = 86_400_000;

	it("reports 'just now' under a minute", () => {
		expect(toRelativePhrase({ iso: ago(30_000), now })).toEqual({
			iso: ago(30_000),
			label: "just now",
			mode: "relative",
		});
	});

	it("spells minutes out in full, singular and plural", () => {
		expect(toRelativePhrase({ iso: ago(MINUTE), now }).label).toBe("1 minute ago");
		expect(toRelativePhrase({ iso: ago(5 * MINUTE), now }).label).toBe("5 minutes ago");
	});

	it("spells hours out in full, singular and plural", () => {
		expect(toRelativePhrase({ iso: ago(HOUR), now }).label).toBe("1 hour ago");
		expect(toRelativePhrase({ iso: ago(3 * HOUR), now }).label).toBe("3 hours ago");
	});

	it("counts days until a full week has passed", () => {
		expect(toRelativePhrase({ iso: ago(DAY), now }).label).toBe("1 day ago");
		expect(toRelativePhrase({ iso: ago(6 * DAY), now }).label).toBe("6 days ago");
	});

	it("counts weeks from the seventh day until a month has passed", () => {
		expect(toRelativePhrase({ iso: ago(7 * DAY), now }).label).toBe("1 week ago");
		expect(toRelativePhrase({ iso: ago(14 * DAY), now }).label).toBe("2 weeks ago");
		expect(toRelativePhrase({ iso: ago(29 * DAY), now }).label).toBe("4 weeks ago");
	});

	it("counts thirty-day months from the thirtieth day until a year has passed", () => {
		expect(toRelativePhrase({ iso: ago(30 * DAY), now }).label).toBe("1 month ago");
		expect(toRelativePhrase({ iso: ago(60 * DAY), now }).label).toBe("2 months ago");
		expect(toRelativePhrase({ iso: ago(359 * DAY), now }).label).toBe("11 months ago");
	});

	it("counts years once twelve thirty-day months have passed", () => {
		expect(toRelativePhrase({ iso: ago(360 * DAY), now }).label).toBe("1 year ago");
		expect(toRelativePhrase({ iso: ago(725 * DAY), now }).label).toBe("2 years ago");
	});

	it("stays relative where toRelativeOrDate would fall back to a date, so the hover title still resolves", () => {
		const iso = ago(60 * DAY);
		expect(toRelativePhrase({ iso, now })).toEqual({
			iso,
			label: "2 months ago",
			mode: "relative",
		});
	});
});
