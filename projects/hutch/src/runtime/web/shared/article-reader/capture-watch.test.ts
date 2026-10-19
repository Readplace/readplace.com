import { type CaptureWatch, captureWatchQuery, NO_CAPTURE_WATCH, parseCaptureWatch } from "./capture-watch";

function queryOf(watch: CaptureWatch): Record<string, string> {
	return Object.fromEntries(new URLSearchParams(captureWatchQuery(watch)));
}

describe("capture watch query", () => {
	it.each<CaptureWatch>([
		NO_CAPTURE_WATCH,
		{ kind: "started", noticeRevision: 0 },
		{ kind: "started", noticeRevision: 4 },
		{ kind: "watching", since: 7 },
		{ kind: "device-gave-up", since: 7 },
	])("reads back a $kind watch from the query it writes", (watch) => {
		expect(parseCaptureWatch(queryOf(watch))).toEqual(watch);
	});

	it("reads a tab's legacy capturing flag as a watch from revision zero", () => {
		expect(parseCaptureWatch({ capturing: "1" })).toEqual({ kind: "watching", since: 0 });
	});

	it.each([
		{ query: {}, label: "no capture parameters" },
		{ query: { captureSince: "" }, label: "an empty revision" },
		{ query: { captureSince: "-1" }, label: "a negative revision" },
		{ query: { captureNotice: "2.5" }, label: "a fractional revision" },
		{ query: { captureSince: ["1", "2"] }, label: "a repeated revision" },
		{ query: { capturing: "true" }, label: "a legacy flag that is not 1" },
	])("reads $label as no watch", ({ query }) => {
		expect(parseCaptureWatch(query)).toEqual(NO_CAPTURE_WATCH);
	});

	it("reads a give-up flag that is not 1 as a watch still in progress", () => {
		expect(parseCaptureWatch({ captureSince: "3", captureGaveUp: "yes" })).toEqual({ kind: "watching", since: 3 });
	});
});
