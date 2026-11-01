const INSPECTED_LEADING_BYTES = 16_384;
const CHALLENGE_PAGE_MARKERS = ["<title>Client Challenge</title>", "/_fs-ch-"];

export async function isFastlyClientChallenge(response: Response): Promise<boolean> {
	if (!response.ok) return false;
	if (!response.headers.get("content-type")?.includes("text/html")) return false;
	const { body } = response.clone();
	if (body === null) return false;
	return hasFastlyChallengeMarkers(await readLeadingText(body));
}

export function isBufferedFastlyClientChallenge(params: { response: Response; buffer: Buffer }): boolean {
	const { response, buffer } = params;
	if (!response.ok) return false;
	if (!response.headers.get("content-type")?.includes("text/html")) return false;
	return hasFastlyChallengeMarkers(buffer.subarray(0, INSPECTED_LEADING_BYTES).toString("utf8"));
}

export function hasFastlyChallengeMarkers(html: string): boolean {
	return CHALLENGE_PAGE_MARKERS.every((marker) => html.includes(marker));
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
