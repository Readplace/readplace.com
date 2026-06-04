import { captureActiveTabBytes } from "./capture-active-tab-bytes";

function fakeFetch(body: ArrayBuffer, headers: Record<string, string> = {}, ok = true): typeof fetch {
	return async (_url, _init) =>
		({
			ok,
			headers: new Headers(headers),
			arrayBuffer: async () => body,
		}) as Response;
}

const PDF_HEADER = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

describe("captureActiveTabBytes", () => {
	it("returns bytes and mediaType for application/pdf", async () => {
		const body = PDF_HEADER.buffer;
		const result = await captureActiveTabBytes(
			"https://example.com/doc.pdf",
			fakeFetch(body, { "content-type": "application/pdf" }),
		);
		expect(result).toEqual({ bytes: body, mediaType: "application/pdf" });
	});

	it("returns bytes and mediaType for text/plain", async () => {
		const body = new TextEncoder().encode("hello").buffer;
		const result = await captureActiveTabBytes(
			"https://example.com/file.txt",
			fakeFetch(body, { "content-type": "text/plain" }),
		);
		expect(result).toEqual({ bytes: body, mediaType: "text/plain" });
	});

	it("strips charset params from content-type", async () => {
		const body = new TextEncoder().encode("<html></html>").buffer;
		const result = await captureActiveTabBytes(
			"https://example.com/page",
			fakeFetch(body, { "content-type": "text/html; charset=utf-8" }),
		);
		expect(result?.mediaType).toBe("text/html");
	});

	it("returns undefined when response is not ok", async () => {
		const body = PDF_HEADER.buffer;
		const result = await captureActiveTabBytes(
			"https://example.com/doc.pdf",
			fakeFetch(body, { "content-type": "application/pdf" }, false),
		);
		expect(result).toBeUndefined();
	});

	it("returns undefined when buffer is empty", async () => {
		const result = await captureActiveTabBytes(
			"https://example.com/doc.pdf",
			fakeFetch(new ArrayBuffer(0), { "content-type": "application/pdf" }),
		);
		expect(result).toBeUndefined();
	});

	it("returns undefined when buffer exceeds 500 MiB", async () => {
		const oversizeBuffer = { byteLength: 500 * 1024 * 1024 + 1 } as ArrayBuffer;
		const result = await captureActiveTabBytes(
			"https://example.com/doc.pdf",
			async () =>
				({
					ok: true,
					headers: new Headers({ "content-type": "application/pdf" }),
					arrayBuffer: async () => oversizeBuffer,
				}) as Response,
		);
		expect(result).toBeUndefined();
	});

	it("returns undefined when content-type header is missing", async () => {
		const body = PDF_HEADER.buffer;
		const result = await captureActiveTabBytes(
			"https://example.com/doc",
			fakeFetch(body),
		);
		expect(result).toBeUndefined();
	});

	it("returns undefined on network error", async () => {
		const result = await captureActiveTabBytes(
			"https://example.com/doc.pdf",
			async () => { throw new Error("network error"); },
		);
		expect(result).toBeUndefined();
	});

	it("passes credentials include to fetch", async () => {
		const calls: RequestInit[] = [];
		const body = PDF_HEADER.buffer;
		await captureActiveTabBytes(
			"https://example.com/doc.pdf",
			async (_url, init) => {
				calls.push(init ?? {});
				return {
					ok: true,
					headers: new Headers({ "content-type": "application/pdf" }),
					arrayBuffer: async () => body,
				} as Response;
			},
		);
		expect(calls[0]?.credentials).toBe("include");
	});

	it("passes abort signal to fetch", async () => {
		const calls: RequestInit[] = [];
		const body = PDF_HEADER.buffer;
		await captureActiveTabBytes(
			"https://example.com/doc.pdf",
			async (_url, init) => {
				calls.push(init ?? {});
				return {
					ok: true,
					headers: new Headers({ "content-type": "application/pdf" }),
					arrayBuffer: async () => body,
				} as Response;
			},
		);
		expect(calls[0]?.signal).toBeDefined();
	});
});
