const INSPECTED_LEADING_BYTES = 16_384;
const CHALLENGE_PAGE_MARKERS = ["<title>Client Challenge</title>", "/_fs-ch-"];

export async function isFastlyClientChallenge(response: Response): Promise<boolean> {
	if (!response.ok) return false;
	if (!response.headers.get("content-type")?.includes("text/html")) return false;
	const { body } = response.clone();
	if (body === null) return false;
	const leadingHtml = await readLeadingText(body);
	return CHALLENGE_PAGE_MARKERS.every((marker) => leadingHtml.includes(marker));
}

async function readLeadingText(body: ReadableStream<Uint8Array>): Promise<string> {
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let bytesRead = 0;
	while (bytesRead < INSPECTED_LEADING_BYTES) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		bytesRead += value.byteLength;
	}
	reader.cancel().catch(() => undefined);
	return Buffer.concat(chunks).toString("utf8");
}
