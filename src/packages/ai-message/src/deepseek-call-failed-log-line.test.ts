import { describeAiProviderError, deepseekCallFailedLogLine } from "./deepseek-call-failed-log-line";

function asLoggedJson(value: unknown): Record<string, unknown> {
	return JSON.parse(JSON.stringify(value));
}

describe("describeAiProviderError", () => {
	it("calls DeepSeek's 402 balance error an http failure with its status and code", () => {
		const thrown = Object.assign(new Error("402 Insufficient Balance"), {
			status: 402,
			code: "invalid_request_error",
			requestID: null,
		});

		expect(describeAiProviderError(thrown)).toEqual(
			expect.objectContaining({
				kind: "http",
				status: 402,
				code: "invalid_request_error",
				message: "402 Insufficient Balance",
			}),
		);
	});

	it("leaves the code out of a 503 that carries a null code", () => {
		const thrown = Object.assign(new Error("503 Service Unavailable"), { status: 503, code: null });

		const described = asLoggedJson(describeAiProviderError(thrown));

		expect(described.kind).toBe("http");
		expect(described.status).toBe(503);
		expect(described).not.toHaveProperty("code");
	});

	it("gives an http failure with no message an empty message", () => {
		expect(describeAiProviderError({ status: 502 })).toEqual({
			kind: "http",
			status: 502,
			code: undefined,
			message: "",
			stack: undefined,
		});
	});

	it("calls the SDK's client timeout a timeout", () => {
		expect(describeAiProviderError(new Error("Request timed out.")).kind).toBe("timeout");
	});

	it("calls the SDK's aborted request a timeout", () => {
		expect(describeAiProviderError(new Error("Request was aborted.")).kind).toBe("timeout");
	});

	it("calls an AbortError DOMException a timeout and keeps its numeric code", () => {
		const described = describeAiProviderError(new DOMException("This operation was aborted", "AbortError"));

		expect(described).toEqual(expect.objectContaining({ kind: "timeout", code: 20 }));
		expect(asLoggedJson(described)).not.toHaveProperty("status");
	});

	it("does not call an AWS SDK socket reset named TimeoutError a DeepSeek timeout", () => {
		const thrown = Object.assign(new Error("socket hang up"), { name: "TimeoutError", code: "ECONNRESET" });

		expect(describeAiProviderError(thrown)).toEqual({ kind: "unknown" });
	});

	it("calls the SDK's connection error a connection failure", () => {
		const thrown = Object.assign(new Error("Connection error."), { cause: new TypeError("fetch failed") });

		expect(describeAiProviderError(thrown).kind).toBe("connection");
	});

	it("calls a TypeError with a cause a connection failure", () => {
		const thrown = new TypeError("terminated", { cause: new Error("other side closed") });

		expect(describeAiProviderError(thrown).kind).toBe("connection");
	});

	it("does not call an error that only carries a cause a connection failure", () => {
		const thrown = Object.assign(new Error("superseded", { cause: new Error("newer selection") }), {
			name: "SelectionSupersededError",
		});

		expect(describeAiProviderError(thrown)).toEqual({ kind: "unknown" });
	});

	it("does not call a TypeError with no cause a connection failure", () => {
		expect(describeAiProviderError(new TypeError("x is not a function"))).toEqual({ kind: "unknown" });
	});

	it("does not describe a plain error", () => {
		expect(describeAiProviderError(new Error("boom"))).toEqual({ kind: "unknown" });
	});

	it("does not describe a thrown string", () => {
		expect(describeAiProviderError("boom")).toEqual({ kind: "unknown" });
	});
});

describe("deepseekCallFailedLogLine", () => {
	const failure = {
		kind: "http" as const,
		status: 402,
		code: "invalid_request_error",
		message: "402 Insufficient Balance",
		stack: "Error: 402 Insufficient Balance",
	};

	it("writes the level, event, feature, kind, record fields and the given ids", () => {
		const line = asLoggedJson(
			deepseekCallFailedLogLine({
				feature: "filter-email-links",
				failure,
				receiveCount: 2,
				messageId: "message-1",
				ids: { userId: "user-1", receivedAtMessageId: "received-1", readlist: "work" },
			}),
		);

		expect(line).toEqual({
			level: "ERROR",
			event: "deepseek-call-failed",
			feature: "filter-email-links",
			kind: "http",
			status: 402,
			code: "invalid_request_error",
			message: "402 Insufficient Balance",
			stack: "Error: 402 Insufficient Balance",
			receiveCount: 2,
			messageId: "message-1",
			userId: "user-1",
			receivedAtMessageId: "received-1",
			readlist: "work",
		});
		expect(line).not.toHaveProperty("url");
		expect(line).not.toHaveProperty("requestId");
	});

	it("writes no receive count or message id when there is no SQS record", () => {
		const line = asLoggedJson(
			deepseekCallFailedLogLine({ feature: "triage-email-links", failure, ids: { userId: "user-1" } }),
		);

		expect(line).not.toHaveProperty("receiveCount");
		expect(line).not.toHaveProperty("messageId");
	});
});
