import assert from "node:assert";
import type { Request } from "express";
import express from "express";

const BoundaryRegex = /^multipart\/form-data\s*;.*boundary=(?:"([^"]+)"|([^;\s]+))/i;
const FilenameRegex = /filename="([^"]*)"/i;

export interface UploadedFile {
	readonly filename: string | undefined;
	readonly content: Buffer;
}

export type MultipartUploadResult =
	| { ok: true; file: UploadedFile }
	| { ok: false; reason: "invalid-multipart" | "no-file" };

export function initMultipartUpload(deps: { maxBytes: number }): {
	rawBodyParser: express.RequestHandler;
	parseRequest: (req: Request) => MultipartUploadResult;
} {
	return {
		rawBodyParser: express.raw({
			type: "multipart/form-data",
			limit: deps.maxBytes,
		}),
		parseRequest: (req) => {
			const contentType = req.headers["content-type"];
			if (typeof contentType !== "string") {
				return { ok: false, reason: "invalid-multipart" };
			}

			const match = BoundaryRegex.exec(contentType);
			if (!match) return { ok: false, reason: "invalid-multipart" };
			const boundary = match[1] ?? match[2];
			assert(boundary, "BoundaryRegex match guarantees one capture group");

			const body = req.body;
			if (!Buffer.isBuffer(body)) {
				return { ok: false, reason: "invalid-multipart" };
			}

			const file = extractFirstFilePart(body, boundary);
			if (!file) return { ok: false, reason: "no-file" };
			return { ok: true, file };
		},
	};
}

function extractFirstFilePart(buffer: Buffer, boundary: string): UploadedFile | undefined {
	const dashBoundary = Buffer.from(`--${boundary}`);
	let cursor = buffer.indexOf(dashBoundary);
	if (cursor === -1) return undefined;

	while (cursor < buffer.length) {
		cursor += dashBoundary.length;
		// Either \r\n (next part) or -- (end of message)
		if (buffer[cursor] === 0x2d && buffer[cursor + 1] === 0x2d) return undefined;
		if (buffer[cursor] !== 0x0d || buffer[cursor + 1] !== 0x0a) return undefined;
		cursor += 2;

		const headerEnd = buffer.indexOf("\r\n\r\n", cursor);
		if (headerEnd === -1) return undefined;
		const headers = buffer.slice(cursor, headerEnd).toString("utf8");
		const bodyStart = headerEnd + 4;

		const nextBoundary = buffer.indexOf(dashBoundary, bodyStart);
		if (nextBoundary === -1) return undefined;
		// Body ends at \r\n before the boundary line
		const bodyEnd = nextBoundary - 2;

		const filenameMatch = FilenameRegex.exec(headers);
		if (filenameMatch) {
			return {
				filename: filenameMatch[1] || undefined,
				content: buffer.slice(bodyStart, bodyEnd),
			};
		}

		cursor = nextBoundary;
	}

	return undefined;
}
