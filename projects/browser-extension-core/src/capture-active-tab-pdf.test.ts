import { captureActiveTabPdf } from "./capture-active-tab-pdf";

function fakeFetch(body: ArrayBuffer, headers: Record<string, string> = {}, ok = true): typeof fetch {
	return async (_url, _init) =>
		({
			ok,
			headers: new Headers(headers),
			arrayBuffer: async () => body,
		}) as Response;
}

const PDF_HEADER = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

describe("captureActiveTabPdf", () => {
	it("returns PDF bytes when content-type is application/pdf", async () => {
		const body = PDF_HEADER.buffer;
		const result = await captureActiveTabPdf(
			"https://example.com/doc.pdf",
			fakeFetch(body, { "content-type": "application/pdf" }),
		);
		expect(result).toBe(body);
	});

	it("returns PDF bytes when content-type is application/x-pdf", async () => {
		const body = PDF_HEADER.buffer;
		const result = await captureActiveTabPdf(
			"https://example.com/doc.pdf",
			fakeFetch(body, { "content-type": "application/x-pdf" }),
		);
		expect(result).toBe(body);
	});

	it("returns PDF bytes when magic bytes match regardless of content-type", async () => {
		const body = PDF_HEADER.buffer;
		const result = await captureActiveTabPdf(
			"https://example.com/doc",
			fakeFetch(body, { "content-type": "application/octet-stream" }),
		);
		expect(result).toBe(body);
	});

	it("returns undefined when response is not ok", async () => {
		const body = PDF_HEADER.buffer;
		const result = await captureActiveTabPdf(
			"https://example.com/doc.pdf",
			fakeFetch(body, { "content-type": "application/pdf" }, false),
		);
		expect(result).toBeUndefined();
	});

	it("returns undefined when buffer is empty", async () => {
		const result = await captureActiveTabPdf(
			"https://example.com/doc.pdf",
			fakeFetch(new ArrayBuffer(0), { "content-type": "application/pdf" }),
		);
		expect(result).toBeUndefined();
	});

	it("returns undefined when buffer exceeds 500 MiB", async () => {
		const oversizeBuffer = { byteLength: 500 * 1024 * 1024 + 1 } as ArrayBuffer;
		const result = await captureActiveTabPdf(
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

	it("returns undefined when buffer is shorter than magic bytes and content-type is not PDF", async () => {
		const tinyBuffer = new Uint8Array([0x00, 0x01]).buffer;
		const result = await captureActiveTabPdf(
			"https://example.com/doc",
			fakeFetch(tinyBuffer, { "content-type": "application/octet-stream" }),
		);
		expect(result).toBeUndefined();
	});

	it("falls back to empty string when content-type header is missing", async () => {
		const body = PDF_HEADER.buffer;
		const result = await captureActiveTabPdf(
			"https://example.com/doc",
			fakeFetch(body),
		);
		expect(result).toBe(body);
	});

	it("returns undefined when content is not PDF", async () => {
		const htmlBytes = new TextEncoder().encode("<html></html>");
		const result = await captureActiveTabPdf(
			"https://example.com/page",
			fakeFetch(htmlBytes.buffer, { "content-type": "text/html" }),
		);
		expect(result).toBeUndefined();
	});

	it("returns undefined on network error", async () => {
		const result = await captureActiveTabPdf(
			"https://example.com/doc.pdf",
			async () => { throw new Error("network error"); },
		);
		expect(result).toBeUndefined();
	});

	it("passes credentials include to fetch", async () => {
		const calls: RequestInit[] = [];
		const body = PDF_HEADER.buffer;
		await captureActiveTabPdf(
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
		await captureActiveTabPdf(
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
