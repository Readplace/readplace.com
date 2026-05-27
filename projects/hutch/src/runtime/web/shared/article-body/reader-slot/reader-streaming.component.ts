import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "../../../render";
import { buildReaderStreamingIframeSrcdoc } from "./reader-streaming-iframe-srcdoc";

const TEMPLATE = readFileSync(
	join(__dirname, "reader-streaming.template.html"),
	"utf-8",
);

export interface ReaderStreamingInput {
	/** The crawled partial HTML so far. Baked into the iframe srcdoc so the
	 * reader sees current content on first paint, before EventSource opens. */
	initialPartialHtml: string;
	/** Article URL — the parent-side client uses it to build the SSE URL. */
	articleUrl: string;
	/** Base URL for the SSE Lambda's Function URL (e.g.
	 * `https://stream.<canonical-domain>`). */
	streamBaseUrl: string;
	/** HTMX poll URL — stays armed underneath the EventSource so the slot
	 * still progresses to terminal if the stream fails. */
	pollUrl: string;
	/** Optional secondary line rendered below the iframe (PDF accuracy
	 * hint). Same field shape as the pending variant. */
	loadingHint?: string;
	oob?: boolean;
}

export function renderReaderStreaming(input: ReaderStreamingInput): string {
	const srcdoc = buildReaderStreamingIframeSrcdoc({
		initialPartialHtml: input.initialPartialHtml,
	});
	return render(TEMPLATE, {
		srcdoc,
		articleUrl: input.articleUrl,
		streamBaseUrl: input.streamBaseUrl,
		prerenderedLength: input.initialPartialHtml.length,
		pollUrl: input.pollUrl,
		loadingHint: input.loadingHint,
		oob: input.oob === true,
	});
}
