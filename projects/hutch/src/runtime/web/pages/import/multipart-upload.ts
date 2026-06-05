import assert from "node:assert";
import type { Request } from "express";
import express from "express";

const BoundaryRegex = /^multipart\/form-data\s*;.*boundary=(?:"([^"]+)"|([^;\s]+))/i;
const FilenameRegex = /filename="([^"]*)"/i;
const NameRegex = /name="([^"]*)"/i;

export interface UploadedFile {
	readonly filename: string | undefined;
	readonly content: Buffer;
}

export type MultipartUploadResult =
	| { ok: true; file: UploadedFile }
	| { ok: false; reason: "invalid-multipart" | "no-file" };

export interface UploadedPart {
	readonly name: string | undefined;
	readonly filename: string | undefined;
	/** True when the Content-Disposition header declared a `filename=` attribute,
	 * even when its value was empty. Distinguishes a file part (`filename=""`)
	 * from a text field with no `filename=` at all. */
	readonly isFile: boolean;
	readonly content: Buffer;
}

export type MultipartAllPartsResult =
	| { ok: true; parts: UploadedPart[] }
	| { ok: false; reason: "invalid-multipart" };

export function initMultipartUpload(deps: { maxBytes: number }): {
	rawBodyParser: express.RequestHandler;
	parseRequest: (req: Request) => MultipartUploadResult;
	parseAllParts: (req: Request) => MultipartAllPartsResult;
} {
	const getBoundaryAndBody = (
		req: Request,
	):
		| { ok: true; boundary: string; body: Buffer }
		| { ok: false; reason: "invalid-multipart" } => {
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

		return { ok: true, boundary, body };
	};

	return {
		rawBodyParser: express.raw({
			type: "multipart/form-data",
			limit: deps.maxBytes,
		}),
		parseRequest: (req) => {
			const setup = getBoundaryAndBody(req);
			if (!setup.ok) return setup;

			const file = extractFirstFilePart(setup.body, setup.boundary);
			if (!file) return { ok: false, reason: "no-file" };
			return { ok: true, file };
		},
		parseAllParts: (req) => {
			const setup = getBoundaryAndBody(req);
			if (!setup.ok) return setup;

			return { ok: true, parts: extractAllParts(setup.body, setup.boundary) };
		},
	};
}

function extractFirstFilePart(buffer: Buffer, boundary: string): UploadedFile | undefined {
	const parts = extractAllParts(buffer, boundary);
	const filePart = parts.find((part) => part.isFile);
	if (!filePart) return undefined;
	return { filename: filePart.filename, content: filePart.content };
}

function extractAllParts(buffer: Buffer, boundary: string): UploadedPart[] {
	const parts: UploadedPart[] = [];
	const dashBoundary = Buffer.from(`--${boundary}`);
	let cursor = buffer.indexOf(dashBoundary);
	if (cursor === -1) return parts;

	while (cursor < buffer.length) {
		cursor += dashBoundary.length;
		// Either \r\n (next part) or -- (end of message)
		if (buffer[cursor] === 0x2d && buffer[cursor + 1] === 0x2d) return parts;
		if (buffer[cursor] !== 0x0d || buffer[cursor + 1] !== 0x0a) return parts;
		cursor += 2;

		const headerEnd = buffer.indexOf("\r\n\r\n", cursor);
		if (headerEnd === -1) return parts;
		const headers = buffer.slice(cursor, headerEnd).toString("utf8");
		const bodyStart = headerEnd + 4;

		const nextBoundary = buffer.indexOf(dashBoundary, bodyStart);
		if (nextBoundary === -1) return parts;
		// Body ends at \r\n before the boundary line
		const bodyEnd = nextBoundary - 2;

		const filenameMatch = FilenameRegex.exec(headers);
		const nameMatch = NameRegex.exec(headers);
		parts.push({
			name: nameMatch ? nameMatch[1] || undefined : undefined,
			filename: filenameMatch ? filenameMatch[1] || undefined : undefined,
			isFile: filenameMatch !== null,
			content: buffer.slice(bodyStart, bodyEnd),
		});

		cursor = nextBoundary;
	}

	return parts;
}
