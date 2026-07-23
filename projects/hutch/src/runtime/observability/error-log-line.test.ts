import { formatErrorLogLine } from "@packages/hutch-logger";
import { classifyForwardedLine } from "../forward-analytics/forward-analytics-handler";
import { FORWARDED_STREAMS } from "./events";

// formatErrorLogLine lives in @packages/hutch-logger, whose own check runs lint
// only. Its test lives here — alongside observability-filter.test.ts, for the
// same reason — because this project runs tests under coverage enforcement, and
// because what the format has to satisfy is defined by this pipeline: the filter
// must deliver the line, the classifier must route it, and Logs Insights must be
// able to discover its fields.
const now = () => new Date("2026-07-20T07:15:50.745Z");

describe("formatErrorLogLine", () => {
	it("emits pure JSON, which is what lets the errors table populate its columns", () => {
		// Parsing IS the assertion. The two-argument form this replaces
		// (`logger.error(msg, { error })`) prints `msg { error: undefined }`, which
		// throws here — and rendered on the dashboard with every column but the
		// timestamp blank, because Logs Insights only discovers fields in pure JSON.
		expect(JSON.parse(formatErrorLogLine({ message: "boom", now }))).toEqual({
			level: "ERROR",
			timestamp: "2026-07-20T07:15:50.745Z",
			message: "boom",
		});
	});

	it("carries level in the payload — the Lambda preamble that holds it is stripped before the funnel", () => {
		expect(JSON.parse(formatErrorLogLine({ message: "boom", now })).level).toBe("ERROR");
	});

	it("includes the stack when an Error is given", () => {
		const error = new Error("kaboom");
		expect(JSON.parse(formatErrorLogLine({ message: "boom", error, now })).stack).toBe(error.stack);
	});

	it("omits the stack key entirely when there is no Error", () => {
		expect(formatErrorLogLine({ message: "boom", now })).not.toContain("stack");
	});

	it("carries name and the Node error code/errno/syscall so the failure class is queryable", () => {
		const error = Object.assign(new Error("spawn curl_chrome131 ENOENT"), {
			code: "ENOENT",
			errno: -2,
			syscall: "spawn curl_chrome131",
		});
		const line = JSON.parse(formatErrorLogLine({ message: "boom", error, now }));
		expect(line.name).toBe("Error");
		expect(line.code).toBe("ENOENT");
		expect(line.errno).toBe(-2);
		expect(line.syscall).toBe("spawn curl_chrome131");
	});

	it("unwinds an Error cause to its name/message/code — where undici hides the real reason", () => {
		const cause = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
		const error = new Error("fetch failed", { cause });
		const line = JSON.parse(formatErrorLogLine({ message: "boom", error, now }));
		expect(line.cause).toMatchObject({ name: "Error", message: "read ECONNRESET", code: "ECONNRESET" });
	});

	it("stringifies a non-Error cause rather than dropping it", () => {
		const error = new Error("wrapped", { cause: "raw string reason" });
		expect(JSON.parse(formatErrorLogLine({ message: "boom", error, now })).cause).toBe("raw string reason");
	});

	it("omits the cause key when the Error has none", () => {
		const line = JSON.parse(formatErrorLogLine({ message: "boom", error: new Error("plain"), now }));
		expect(line).not.toHaveProperty("cause");
	});

	// The end the format exists for: a line in this shape must reach the errors
	// funnel rather than being dropped or filed as business history.
	it("routes to the errors funnel", () => {
		expect(
			classifyForwardedLine({
				message: formatErrorLogLine({ message: "boom", now }),
				analyticsStreams: FORWARDED_STREAMS,
			}),
		).toBe("errors");
	});
});
