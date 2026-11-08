import assert from "node:assert";
import { isPDF } from "./pdf-detect";
import { TransportLadderFailure } from "./transport-ladder-failure";

export type RejectDocumentLandingPage = typeof rejectDocumentLandingPage;

export class DocumentLandingPageError extends Error {
	readonly requestedUrl: string;
	readonly landingPageUrl: string;

	constructor(params: { requestedUrl: string; landingPageUrl: string }) {
		super("PDF request redirected to an HTML landing page");
		this.requestedUrl = params.requestedUrl;
		this.landingPageUrl = params.landingPageUrl;
	}
}

function isDocumentLandingPage(url: string, response: Response): boolean {
	const requested = URL.parse(url);
	const terminal = URL.parse(response.url);
	if (requested === null || terminal === null) return false;
	if (requested.protocol !== "http:" && requested.protocol !== "https:") return false;
	if (!isPDF({ pathname: requested.pathname })) return false;
	if (terminal.origin !== requested.origin || terminal.search !== "" || terminal.hash !== "") return false;
	const directory = terminal.pathname.endsWith("/") ? terminal.pathname : `${terminal.pathname}/`;
	if (!requested.pathname.startsWith(directory)) return false;
	const mediaType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
	return response.ok && (mediaType === "text/html" || mediaType === "application/xhtml+xml");
}

export async function rejectDocumentLandingPage(url: string, response: Response, bytes?: Buffer): Promise<void> {
	if (!isDocumentLandingPage(url, response)) return;
	let prefix = bytes;
	if (prefix === undefined && response.body !== null) {
		const clone = response.clone();
		assert(clone.body);
		const reader = clone.body.getReader();
		const chunks: Uint8Array[] = [];
		let length = 0;
		try {
			while (length < 5) {
				const next = await reader.read();
				if (next.done) break;
				chunks.push(next.value.subarray(0, 5 - length));
				length += next.value.length;
			}
			prefix = Buffer.concat(chunks);
		} finally {
			void reader.cancel().catch(() => undefined);
		}
	}
	if (prefix !== undefined && isPDF({ bodyBytes: prefix })) return;
	if (bytes === undefined) await response.body?.cancel();
	throw new DocumentLandingPageError({ requestedUrl: url, landingPageUrl: response.url });
}

export function documentLandingPageFailure(error: unknown): DocumentLandingPageError | undefined {
	if (error instanceof DocumentLandingPageError) return error;
	if (error instanceof TransportLadderFailure) {
		for (const attempt of [...error.previousErrors, error.cause].reverse()) {
			const found = documentLandingPageFailure(attempt);
			if (found !== undefined) return found;
		}
	}
	return undefined;
}
