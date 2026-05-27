/**
 * Parent-side EventSource client that drives the streaming reader iframe.
 *
 * The iframe owns nothing about the network — its sandbox makes it a
 * black box for content rendering. The parent owns the EventSource (it
 * has to: cookies on the streaming Function URL only flow from the
 * parent's same-site origin) and forwards each chunk into the iframe
 * via `postMessage`. On terminal (`event: done`) the parent reloads the
 * page so the canonical `reader-ready` iframe replaces the streaming
 * one in one atomic swap — no flicker mid-stream.
 *
 * HTMX `hx-get="…" hx-trigger="every 3s"` on the slot wrapper stays
 * armed underneath this client. If EventSource fails after retries, the
 * poll path drives the slot to terminal via the existing chain.
 */

interface ReaderStreamDeps {
	document: Document;
	window: Window & typeof globalThis;
	EventSourceCtor: typeof EventSource;
	now: () => number;
	setTimeoutFn: (fn: () => void, ms: number) => number;
	/** Page reload — invoked on the SSE `done` event so the canonical
	 * `reader-ready` iframe replaces the streaming one in a single atomic
	 * swap. Injected as a dep (not `window.location.reload`) because
	 * JSDOM's `window.location` is non-configurable in tests. */
	reload: () => void;
	addSwapListener: (listener: (root: Element) => void) => void;
}

const STREAMING_SLOT_SELECTOR = '[data-reader-status="streaming"]';
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

/* Tracks which slot elements already have a live EventSource attached so a
 * repeated HTMX `afterSwap` (e.g. a poll firing while the streaming session
 * is in flight) doesn't open a second EventSource against the same slot.
 * WeakMap so removed slots get GC'd along with their session state. */
const liveSessions = new WeakMap<Element, true>();

export function initReaderStream(deps: ReaderStreamDeps): {
	scan: (root: Element) => void;
} {
	function scan(root: Element): void {
		// Re-scan after every HTMX swap. A reader-slot that flipped from
		// pending → streaming gets a fresh session; one that flipped
		// streaming → ready / failed / unsupported leaves its slot
		// element behind for GC (the swap replaces the slot wrapper).
		const slot = root.matches(STREAMING_SLOT_SELECTOR)
			? root
			: root.querySelector(STREAMING_SLOT_SELECTOR);
		if (!slot) return;
		if (liveSessions.has(slot)) return;
		const opened = openSession(deps, slot);
		if (opened) liveSessions.set(slot, true);
	}

	deps.addSwapListener(scan);
	scan(deps.document.body);
	return { scan };
}

function openSession(deps: ReaderStreamDeps, slot: Element): boolean {
	const iframeOrNull = slot.querySelector<HTMLIFrameElement>(
		"iframe[data-reader-streaming-iframe]",
	);
	if (!iframeOrNull) return false;
	const articleUrlOrNull = slot.getAttribute("data-article-url");
	const streamBaseUrlOrNull = slot.getAttribute("data-stream-base-url");
	if (!articleUrlOrNull) return false;
	if (!streamBaseUrlOrNull) return false;
	const iframe: HTMLIFrameElement = iframeOrNull;
	const articleUrl: string = articleUrlOrNull;
	const streamBaseUrl: string = streamBaseUrlOrNull;
	const prerenderedLength = Number(slot.getAttribute("data-prerendered-length") ?? "0");

	let from = Number.isFinite(prerenderedLength) ? prerenderedLength : 0;
	let retries = 0;
	let pendingChunks: string[] = [];
	let iframeReady = false;
	let terminated = false;

	function flushPending(): void {
		const target = iframe.contentWindow;
		if (!target) return;
		for (const html of pendingChunks) {
			target.postMessage({ type: "readplace-chunk", html }, "*");
		}
		pendingChunks = [];
	}

	function sendChunk(html: string): void {
		const target = iframe.contentWindow;
		if (!iframeReady || !target) {
			pendingChunks.push(html);
			return;
		}
		target.postMessage({ type: "readplace-chunk", html }, "*");
	}

	function handleReadyMessage(event: MessageEvent): void {
		if (event.source !== iframe.contentWindow) return;
		const data = event.data as { type?: string } | undefined;
		if (!data || data.type !== "readplace-ready") return;
		iframeReady = true;
		flushPending();
	}

	function open(): void {
		if (terminated) return;
		const url =
			`${streamBaseUrl}/view/reader/stream` +
			`?url=${encodeURIComponent(articleUrl)}` +
			`&from=${from}`;
		const es = new deps.EventSourceCtor(url, { withCredentials: true });
		es.addEventListener("chunk", (event) => {
			try {
				const html = JSON.parse((event as MessageEvent).data) as string;
				if (typeof html === "string" && html.length > 0) {
					from += html.length;
					sendChunk(html);
				}
			} catch {
				// Malformed chunk frame — skip rather than poisoning the session.
			}
		});
		es.addEventListener("done", () => {
			terminated = true;
			es.close();
			// Canonical reload swaps the streaming iframe for the reader-ready
			// canonical iframe in one atomic transition. The page renders the
			// polished final HTML; the in-progress reveal animation is irrelevant
			// past this point.
			deps.reload();
		});
		es.addEventListener("error", () => {
			es.close();
			if (terminated) return;
			retries += 1;
			if (retries > MAX_RETRIES) {
				// Surrender to the HTMX poll path — it stays armed via
				// `hx-trigger="every 3s"` on the slot wrapper and will
				// progress to terminal via the standard chain.
				terminated = true;
				return;
			}
			deps.setTimeoutFn(open, RETRY_BASE_MS * retries);
		});
	}

	deps.window.addEventListener("message", handleReadyMessage);
	open();
	return true;
}
