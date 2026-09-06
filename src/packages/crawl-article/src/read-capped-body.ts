import assert from "node:assert";

/** Thrown by {@link readBodyWithCap} when a streamed response body exceeds the
 * byte cap. A distinct type so a caller can map it to its own "too large"
 * outcome while letting genuine network errors fall through unchanged. */
export class BodyTooLargeError extends Error {
	readonly bytes: number;
	readonly maxBytes: number;
	constructor(params: { bytes: number; maxBytes: number }) {
		super(`Response body exceeds ${params.maxBytes} bytes`);
		this.name = "BodyTooLargeError";
		this.bytes = params.bytes;
		this.maxBytes = params.maxBytes;
	}
}

/**
 * Read a response body into a Buffer while enforcing the byte cap
 * incrementally. `Response.arrayBuffer()` buffers the entire stream first and
 * only then reports its size, so a chunked / Content-Length-less origin can
 * exhaust process memory before the cap is ever checked. This cancels the
 * stream and throws {@link BodyTooLargeError} the moment the running total
 * exceeds `maxBytes`, so at most `maxBytes` (plus one chunk) is ever held.
 */
export async function readBodyWithCap(response: Response, maxBytes: number): Promise<Buffer> {
	assert(response.body, "response passed to readBodyWithCap must have a readable body");
	const reader = response.body.getReader();
	const chunks: Buffer[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel();
			throw new BodyTooLargeError({ bytes: total, maxBytes });
		}
		chunks.push(Buffer.from(value));
	}
	return Buffer.concat(chunks);
}
