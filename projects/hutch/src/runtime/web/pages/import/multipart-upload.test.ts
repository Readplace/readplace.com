import type { Request } from "express";
import { initMultipartUpload } from "./multipart-upload";

const { parseRequest } = initMultipartUpload({ maxBytes: 1024 * 1024 });

function fakeRequest(headers: Record<string, string | undefined>, body: unknown): Request {
	return { headers, body } as unknown as Request;
}

function buildBody(parts: { name: string; filename?: string; content: Buffer | string }[], boundary: string): Buffer {
	const segments: Buffer[] = [];
	for (const part of parts) {
		const headers = part.filename !== undefined
			? `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: application/octet-stream`
			: `Content-Disposition: form-data; name="${part.name}"`;
		segments.push(Buffer.from(`--${boundary}\r\n${headers}\r\n\r\n`));
		segments.push(typeof part.content === "string" ? Buffer.from(part.content) : part.content);
		segments.push(Buffer.from("\r\n"));
	}
	segments.push(Buffer.from(`--${boundary}--\r\n`));
	return Buffer.concat(segments);
}

describe("multipart-upload parseRequest", () => {
	it("returns invalid-multipart when Content-Type is missing", () => {
		const result = parseRequest(fakeRequest({}, Buffer.from("")));

		expect(result).toEqual({ ok: false, reason: "invalid-multipart" });
	});

	it("returns invalid-multipart when Content-Type is not multipart", () => {
		const result = parseRequest(fakeRequest({ "content-type": "application/json" }, Buffer.from("")));

		expect(result).toEqual({ ok: false, reason: "invalid-multipart" });
	});

	it("returns invalid-multipart when the body is not a Buffer", () => {
		const result = parseRequest(
			fakeRequest({ "content-type": "multipart/form-data; boundary=AAA" }, "not-a-buffer"),
		);

		expect(result).toEqual({ ok: false, reason: "invalid-multipart" });
	});

	it("accepts a quoted boundary parameter", () => {
		const boundary = "QuotedBoundary";
		const body = buildBody([{ name: "file", filename: "x.txt", content: "hi" }], boundary);

		const result = parseRequest(
			fakeRequest({ "content-type": `multipart/form-data; boundary="${boundary}"` }, body),
		);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.file.filename).toBe("x.txt");
			expect(result.file.content.toString()).toBe("hi");
		}
	});

	it("returns no-file when the body has no file parts", () => {
		const boundary = "B";
		const body = buildBody([{ name: "field-a", content: "value" }], boundary);

		const result = parseRequest(fakeRequest({ "content-type": `multipart/form-data; boundary=${boundary}` }, body));

		expect(result).toEqual({ ok: false, reason: "no-file" });
	});

	it("skips non-file parts and returns the first file part it finds", () => {
		const boundary = "B";
		const body = buildBody(
			[
				{ name: "intro", content: "hello" },
				{ name: "file", filename: "expected.txt", content: "expected-bytes" },
				{ name: "file2", filename: "second.txt", content: "second-bytes" },
			],
			boundary,
		);

		const result = parseRequest(fakeRequest({ "content-type": `multipart/form-data; boundary=${boundary}` }, body));

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.file.filename).toBe("expected.txt");
			expect(result.file.content.toString()).toBe("expected-bytes");
		}
	});

	it("treats an empty filename as undefined", () => {
		const boundary = "B";
		const body = buildBody([{ name: "file", filename: "", content: "no-name-bytes" }], boundary);

		const result = parseRequest(fakeRequest({ "content-type": `multipart/form-data; boundary=${boundary}` }, body));

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.file.filename).toBeUndefined();
		}
	});

	it("returns no-file for a body with no boundary occurrence", () => {
		const result = parseRequest(
			fakeRequest({ "content-type": "multipart/form-data; boundary=B" }, Buffer.from("not-multipart-body")),
		);

		expect(result).toEqual({ ok: false, reason: "no-file" });
	});

	it("returns no-file for a body that ends right at the close marker", () => {
		const result = parseRequest(
			fakeRequest({ "content-type": "multipart/form-data; boundary=B" }, Buffer.from("--B--\r\n")),
		);

		expect(result).toEqual({ ok: false, reason: "no-file" });
	});

	it("returns no-file when a boundary line is not followed by CRLF", () => {
		const result = parseRequest(
			fakeRequest({ "content-type": "multipart/form-data; boundary=B" }, Buffer.from("--BXX")),
		);

		expect(result).toEqual({ ok: false, reason: "no-file" });
	});

	it("returns no-file when headers are not terminated", () => {
		const result = parseRequest(
			fakeRequest(
				{ "content-type": "multipart/form-data; boundary=B" },
				Buffer.from(
					"--B\r\nContent-Disposition: form-data; name=file; filename=\"x.txt\"\r\n",
				),
			),
		);

		expect(result).toEqual({ ok: false, reason: "no-file" });
	});

	it("returns no-file when the body has no closing boundary", () => {
		const result = parseRequest(
			fakeRequest(
				{ "content-type": "multipart/form-data; boundary=B" },
				Buffer.from(
					"--B\r\nContent-Disposition: form-data; name=\"file\"; filename=\"x.txt\"\r\n\r\nbytes-without-end",
				),
			),
		);

		expect(result).toEqual({ ok: false, reason: "no-file" });
	});
});
