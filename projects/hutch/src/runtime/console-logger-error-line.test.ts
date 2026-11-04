import assert from "node:assert/strict";
import { consoleLogger, formatErrorLogLine, noopLogger } from "@packages/logger";

describe("consoleLogger.error", () => {
	let consoleError: jest.SpyInstance;

	beforeEach(() => {
		consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		consoleError.mockRestore();
	});

	function writtenLine(): string {
		assert.equal(consoleError.mock.calls.length, 1);
		const [args] = consoleError.mock.calls;
		assert.equal(args.length, 1);
		const [line] = args;
		assert.equal(typeof line, "string");
		return line;
	}

	it("writes one JSON line carrying the envelope, the details and the error's name and stack", () => {
		consoleLogger.error("x failed", { messageId: "m", error: new TypeError("t") });

		const parsed = JSON.parse(writtenLine());
		assert.equal(parsed.level, "ERROR");
		assert.equal(parsed.message, "x failed");
		assert.equal(parsed.messageId, "m");
		assert.equal(parsed.name, "TypeError");
		assert.equal(typeof parsed.stack, "string");
		assert.equal(new Date(parsed.timestamp).toISOString(), parsed.timestamp);
	});

	it("keeps the error's code and its immediate cause", () => {
		const cause = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
		const error = Object.assign(new Error("fetch failed", { cause }), { code: "UND_ERR" });

		consoleLogger.error("x failed", { error });

		const parsed = JSON.parse(writtenLine());
		assert.equal(parsed.code, "UND_ERR");
		assert.equal(parsed.cause.name, "Error");
		assert.equal(parsed.cause.message, "socket hang up");
		assert.equal(typeof parsed.cause.stack, "string");
		assert.equal(parsed.cause.code, "ECONNRESET");
	});

	it("keeps the error's own message, which a Firefox stack does not carry", () => {
		consoleLogger.error("x failed", { error: new TypeError("t") });

		assert.equal(JSON.parse(writtenLine()).errorMessage, "t");
	});

	it("serialises a thrown plain object as JSON", () => {
		consoleLogger.error("x failed", { error: { message: "x" } });

		assert.equal(JSON.parse(writtenLine()).thrown, '{"message":"x"}');
	});

	it("names a thrown cyclic object by its string form", () => {
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;

		consoleLogger.error("x failed", { error: cyclic });

		assert.equal(JSON.parse(writtenLine()).thrown, "[object Object]");
	});

	it("names a thrown non-Error value", () => {
		consoleLogger.error("x failed", { error: "boom" });

		assert.equal(JSON.parse(writtenLine()).thrown, "boom");
	});

	it("does not let a details field overwrite the envelope", () => {
		consoleLogger.error("x failed", { level: "INFO", message: "other", timestamp: "x" });

		const parsed = JSON.parse(writtenLine());
		assert.equal(parsed.level, "ERROR");
		assert.equal(parsed.message, "x failed");
		assert.notEqual(parsed.timestamp, "x");
	});

	it("writes a message without details unchanged", () => {
		const line = formatErrorLogLine({ message: "m", now: () => new Date("2026-07-20T07:15:50.745Z") });

		consoleLogger.error(line);

		assert.equal(writtenLine(), line);
	});
});

describe("noopLogger.error", () => {
	it("writes nothing", () => {
		const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

		noopLogger.error("m", { error: 1 });

		assert.equal(consoleError.mock.calls.length, 0);
		consoleError.mockRestore();
	});
});
