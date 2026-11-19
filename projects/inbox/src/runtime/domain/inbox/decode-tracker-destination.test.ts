import { decodeTrackerDestination } from "./decode-tracker-destination";

function base64url(text: string): string {
	return Buffer.from(text).toString("base64url");
}

describe("decodeTrackerDestination", () => {
	it("reads a plain destination from a query value", () => {
		expect(decodeTrackerDestination("https://click.tracker.test/c?id=42&url=https%3A%2F%2Fexample.com%2Fa")).toBe(
			"https://example.com/a",
		);
	});

	it("reads a plain destination from a path segment", () => {
		expect(decodeTrackerDestination("https://click.tracker.test/r/https%3A%2F%2Fexample.com%2Fa")).toBe(
			"https://example.com/a",
		);
	});

	it("reads a destination from a base64 path segment", () => {
		const token = base64url('{"href":"https://example.com/post?ref=mail","id":7}');
		expect(decodeTrackerDestination(`https://click.tracker.test/c/${token}`)).toBe(
			"https://example.com/post?ref=mail",
		);
	});

	it("reads a destination from the base64 part of a dotted, JWT-like segment", () => {
		const payload = base64url('{"url":"https://example.com/b"}');
		expect(
			decodeTrackerDestination(`https://click.tracker.test/e/${base64url('{"alg":"HS256"}')}.${payload}.c2lnbmF0dXJlLXZhbHVl`),
		).toBe("https://example.com/b");
	});

	it("percent-decodes a destination encoded inside base64", () => {
		const token = base64url('{"link":"https%3A%2F%2Fexample.com%2Fc","u":9}');
		expect(decodeTrackerDestination(`https://click.tracker.test/l/${token}`)).toBe("https://example.com/c");
	});

	it("rejects a destination on the tracker's own host and keeps looking", () => {
		expect(
			decodeTrackerDestination(
				"https://click.tracker.test/c?prefs=https%3A%2F%2Fclick.tracker.test%2Fprefs&to=https%3A%2F%2Fexample.com%2Fd",
			),
		).toBe("https://example.com/d");
	});

	it("finds nothing when the only destination is on the tracker's own host", () => {
		expect(decodeTrackerDestination("https://click.tracker.test/c?prefs=https%3A%2F%2Fclick.tracker.test%2Fprefs")).toBe(
			undefined,
		);
	});

	it("skips a candidate that looks like a URL but does not parse", () => {
		expect(decodeTrackerDestination("https://click.tracker.test/c?u=https%3A%2F%2F%5Bbad")).toBe(undefined);
	});

	it("skips a candidate whose percent escapes are malformed", () => {
		expect(decodeTrackerDestination("https://click.tracker.test/c?u=https%3A%2F%2Fexample.com%E0%A4%A")).toBe(undefined);
	});

	it("finds nothing in base64 that decodes to garbage", () => {
		expect(decodeTrackerDestination("https://click.tracker.test/c/q83vEjRWeJCrze8SNFZ4kA")).toBe(undefined);
	});

	it("does not decode a segment shorter than twelve characters", () => {
		expect(decodeTrackerDestination(`https://click.tracker.test/c/${base64url("http://a.b").slice(0, 11)}`)).toBe(
			undefined,
		);
	});

	it("finds nothing in an opaque token", () => {
		expect(
			decodeTrackerDestination(
				"https://link.mail.beehiiv.test/ss/c/u001.Xk3pQ9vLm2RtYw8ZbNcA7dEf/4f2/aB3cD4eF5gH6iJ7kL8mN9oP0q/h12/Zx9Yw8Vu7",
			),
		).toBe(undefined);
	});

	it("finds nothing in a URL that does not parse", () => {
		expect(decodeTrackerDestination("not a url")).toBe(undefined);
	});
});
