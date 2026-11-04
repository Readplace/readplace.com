import assert from "node:assert/strict";
import { adaptSdkLogger } from "./sdk-logger";

type Call = { level: string; args: unknown[] };

function recordingLogger(calls: Call[]) {
	const at =
		(level: string) =>
		(...args: unknown[]) => {
			calls.push({ level, args });
		};
	return {
		info: at("info"),
		warn: at("warn"),
		debug: at("debug"),
		error: (message: string, details?: { readonly error?: unknown; readonly [field: string]: unknown }) => {
			calls.push({ level: "error", args: [message, details] });
		},
	};
}

describe("adaptSdkLogger", () => {
	it("hands a message-only SDK error to the logger with no details", () => {
		const calls: Call[] = [];

		adaptSdkLogger(recordingLogger(calls)).error("Connection error");

		assert.deepEqual(calls, [{ level: "error", args: ["Connection error", undefined] }]);
	});

	it("gathers the SDK's extra error arguments under sdk so a string argument is not spread per character", () => {
		const calls: Call[] = [];

		adaptSdkLogger(recordingLogger(calls)).error("Could not parse", "data", { x: 1 });

		assert.deepEqual(calls, [{ level: "error", args: ["Could not parse", { sdk: ["data", { x: 1 }] }] }]);
	});

	it.each(["info", "warn", "debug"] as const)("passes %s through unchanged", (level) => {
		const calls: Call[] = [];

		adaptSdkLogger(recordingLogger(calls))[level]("message", "extra", { x: 1 });

		assert.deepEqual(calls, [{ level, args: ["message", "extra", { x: 1 }] }]);
	});
});
