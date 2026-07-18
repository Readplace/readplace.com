import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { captureActiveTabBytes } from "./capture-active-tab-bytes";

function fakeFetch(body: ArrayBuffer, headers: Record<string, string> = {}, status = 200): typeof fetch {
	return async (_url, _init) =>
		({
			ok: status >= 200 && status < 300,
			status,
			headers: new Headers(headers),
			arrayBuffer: async () => body,
		}) as Response;
}

function recordingLogger(): { logger: HutchLogger; warnings: string[]; debugs: string[] } {
	const warnings: string[] = [];
	const debugs: string[] = [];
	const logger = HutchLogger.from({
		...noopLogger,
		warn: (message: unknown) => warnings.push(String(message)),
		debug: (message: unknown) => debugs.push(String(message)),
	});
	return { logger, warnings, debugs };
}

const PDF_HEADER = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const logger = HutchLogger.from(noopLogger);

describe("captureActiveTabBytes", () => {
	it("returns bytes and mediaType for application/pdf", async () => {
		const body = PDF_HEADER.buffer;
		const result = await captureActiveTabBytes({
			tabUrl: "https://example.com/doc.pdf",
			fetchFn: fakeFetch(body, { "content-type": "application/pdf" }),
			logger,
		});
		expect(result).toEqual({ bytes: body, mediaType: "application/pdf" });
	});

	it("returns bytes and mediaType for text/plain", async () => {
		const body = new TextEncoder().encode("hello").buffer;
		const result = await captureActiveTabBytes({
			tabUrl: "https://example.com/file.txt",
			fetchFn: fakeFetch(body, { "content-type": "text/plain" }),
			logger,
		});
		expect(result).toEqual({ bytes: body, mediaType: "text/plain" });
	});

	it("strips charset params from content-type", async () => {
		const body = new TextEncoder().encode("<html></html>").buffer;
		const result = await captureActiveTabBytes({
			tabUrl: "https://example.com/page",
			fetchFn: fakeFetch(body, { "content-type": "text/html; charset=utf-8" }),
			logger,
		});
		expect(result?.mediaType).toBe("text/html");
	});

	it("reports the status when the origin refuses the credentialed fetch", async () => {
		const { logger: recording, warnings } = recordingLogger();
		const result = await captureActiveTabBytes({
			tabUrl: "https://example.com/doc.pdf",
			fetchFn: fakeFetch(PDF_HEADER.buffer, { "content-type": "application/pdf" }, 403),
			logger: recording,
		});
		expect(result).toBeUndefined();
		expect(warnings).toEqual(["Capture failed: origin answered 403"]);
	});

	it("reports an empty body", async () => {
		const { logger: recording, warnings } = recordingLogger();
		const result = await captureActiveTabBytes({
			tabUrl: "https://example.com/doc.pdf",
			fetchFn: fakeFetch(new ArrayBuffer(0), { "content-type": "application/pdf" }),
			logger: recording,
		});
		expect(result).toBeUndefined();
		expect(warnings[0]).toContain("empty application/pdf body");
	});

	it("reports a body too large to buffer", async () => {
		const { logger: recording, warnings } = recordingLogger();
		const oversizeBuffer = { byteLength: 512 * 1024 * 1024 + 1 } as ArrayBuffer;
		const result = await captureActiveTabBytes({
			tabUrl: "https://example.com/doc.pdf",
			fetchFn: async () =>
				({
					ok: true,
					headers: new Headers({ "content-type": "application/pdf" }),
					arrayBuffer: async () => oversizeBuffer,
				}) as Response,
			logger: recording,
		});
		expect(result).toBeUndefined();
		expect(warnings[0]).toContain("too large to buffer");
	});

	it("reports a missing content-type header", async () => {
		const { logger: recording, warnings } = recordingLogger();
		const result = await captureActiveTabBytes({
			tabUrl: "https://example.com/doc",
			fetchFn: fakeFetch(PDF_HEADER.buffer),
			logger: recording,
		});
		expect(result).toBeUndefined();
		expect(warnings).toEqual(["Capture failed: response carries no Content-Type"]);
	});

	it("reports a network error", async () => {
		const { logger: recording, warnings } = recordingLogger();
		const result = await captureActiveTabBytes({
			tabUrl: "https://example.com/doc.pdf",
			fetchFn: async () => { throw new Error("network error"); },
			logger: recording,
		});
		expect(result).toBeUndefined();
		expect(warnings).toEqual(["Capture failed: network error"]);
	});

	it("reports a non-Error throw", async () => {
		const { logger: recording, warnings } = recordingLogger();
		const result = await captureActiveTabBytes({
			tabUrl: "https://example.com/doc.pdf",
			fetchFn: async () => { throw "boom"; },
			logger: recording,
		});
		expect(result).toBeUndefined();
		expect(warnings).toEqual(["Capture failed: boom"]);
	});

	it("skips a non-HTTP tab without warning", async () => {
		const { logger: recording, warnings, debugs } = recordingLogger();
		const body = new TextEncoder().encode("<html></html>").buffer;
		const result = await captureActiveTabBytes({
			tabUrl: "chrome-extension://abc/popup.html",
			fetchFn: fakeFetch(body, { "content-type": "text/html" }),
			logger: recording,
		});
		expect(result).toBeUndefined();
		expect(warnings).toEqual([]);
		expect(debugs).toEqual(["Capture skipped: not an http(s) tab"]);
	});

	it("passes credentials include to fetch", async () => {
		const calls: RequestInit[] = [];
		const body = PDF_HEADER.buffer;
		await captureActiveTabBytes({
			tabUrl: "https://example.com/doc.pdf",
			fetchFn: async (_url, init) => {
				calls.push(init ?? {});
				return {
					ok: true,
					headers: new Headers({ "content-type": "application/pdf" }),
					arrayBuffer: async () => body,
				} as Response;
			},
			logger,
		});
		expect(calls[0]?.credentials).toBe("include");
	});

	it("passes abort signal to fetch", async () => {
		const calls: RequestInit[] = [];
		const body = PDF_HEADER.buffer;
		await captureActiveTabBytes({
			tabUrl: "https://example.com/doc.pdf",
			fetchFn: async (_url, init) => {
				calls.push(init ?? {});
				return {
					ok: true,
					headers: new Headers({ "content-type": "application/pdf" }),
					arrayBuffer: async () => body,
				} as Response;
			},
			logger,
		});
		expect(calls[0]?.signal).toBeDefined();
	});
});
