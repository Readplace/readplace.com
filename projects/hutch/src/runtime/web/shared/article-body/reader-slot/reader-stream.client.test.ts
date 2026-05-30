import { JSDOM } from "jsdom";
import { initReaderStream } from "./reader-stream.client";

interface FakeEventSource {
	url: string;
	withCredentials: boolean;
	listeners: Record<string, Array<(event: MessageEvent) => void>>;
	closed: boolean;
	addEventListener: (type: string, listener: (event: MessageEvent) => void) => void;
	dispatch: (type: string, data?: string) => void;
	close: () => void;
}

function setupHarness(
	slotHtml: string,
	options: { autoReadyIframe?: boolean; reload?: () => void } = {},
) {
	const { autoReadyIframe = true, reload = jest.fn() } = options;
	const dom = new JSDOM(
		`<!doctype html><html><body><main>${slotHtml}</main></body></html>`,
	);
	const { window } = dom;
	const eventSources: FakeEventSource[] = [];
	const FakeEventSourceCtor = function (this: FakeEventSource, url: string, init?: EventSourceInit) {
		this.url = url;
		this.withCredentials = init?.withCredentials ?? false;
		this.listeners = {};
		this.closed = false;
		this.addEventListener = (type, listener) => {
			if (!this.listeners[type]) this.listeners[type] = [];
			this.listeners[type].push(listener);
		};
		this.dispatch = (type, data) => {
			const list = this.listeners[type] ?? [];
			for (const listener of list) listener({ data } as MessageEvent);
		};
		this.close = () => { this.closed = true; };
		eventSources.push(this);
	} as unknown as typeof EventSource;

	const swapListeners: Array<(root: Element) => void> = [];
	const setTimeoutFns: Array<{ fn: () => void; ms: number; id: number }> = [];
	let nextTimerId = 1;

	const deps = {
		document: window.document,
		window: window as unknown as Window & typeof globalThis,
		EventSourceCtor: FakeEventSourceCtor,
		now: () => Date.now(),
		setTimeoutFn: (fn: () => void, ms: number): number => {
			const id = nextTimerId++;
			setTimeoutFns.push({ fn, ms, id });
			return id;
		},
		reload,
		addSwapListener: (listener: (root: Element) => void) => {
			swapListeners.push(listener);
		},
	};

	// Auto-fire the iframe's readplace-ready ping unless the test wants to
	// control timing — every test exercises some post-init flow that
	// requires the iframe to be ready.
	if (autoReadyIframe) {
		queueMicrotask(() => {
			const iframe = window.document.querySelector("iframe");
			if (!iframe) return;
			// Manually dispatch the ready postMessage event so the parent's
			// addEventListener handler fires.
			window.dispatchEvent(
				new window.MessageEvent("message", {
					source: iframe.contentWindow,
					data: { type: "readplace-ready" },
				}),
			);
		});
	}

	return { window, deps, eventSources, swapListeners, setTimeoutFns, reload };
}

const STREAMING_SLOT_HTML = `
	<div id="article-body-reader-slot"
		data-test-reader-slot
		data-reader-status="streaming"
		data-article-url="https://example.com/article"
		data-stream-base-url="https://stream.readplace.com"
		data-prerendered-length="42">
		<iframe data-reader-streaming-iframe srcdoc=""></iframe>
	</div>
`;

const NON_STREAMING_SLOT_HTML = `
	<div id="article-body-reader-slot"
		data-test-reader-slot
		data-reader-status="pending"
		data-article-url="https://example.com/article">
	</div>
`;

describe("initReaderStream", () => {
	it("opens an EventSource against the configured stream base URL when the slot is in the streaming variant", async () => {
		const harness = setupHarness(STREAMING_SLOT_HTML, { autoReadyIframe: false });
		initReaderStream(harness.deps);

		expect(harness.eventSources).toHaveLength(1);
		expect(harness.eventSources[0].url).toBe(
			"https://stream.readplace.com/view/reader/stream?url=https%3A%2F%2Fexample.com%2Farticle&from=42",
		);
		expect(harness.eventSources[0].withCredentials).toBe(true);
	});

	it("does NOT open an EventSource for non-streaming slots (pending dots loader, ready iframe, etc.)", () => {
		const harness = setupHarness(NON_STREAMING_SLOT_HTML);
		initReaderStream(harness.deps);
		expect(harness.eventSources).toHaveLength(0);
	});

	it("does NOT open an EventSource for a streaming slot missing the stream-base-url attribute (degrades to HTMX poll)", () => {
		const harness = setupHarness(`
			<div data-test-reader-slot
				data-reader-status="streaming"
				data-article-url="https://example.com/article">
				<iframe data-reader-streaming-iframe srcdoc=""></iframe>
			</div>
		`);
		initReaderStream(harness.deps);
		expect(harness.eventSources).toHaveLength(0);
	});

	it("does NOT open an EventSource for a streaming slot missing the article-url attribute (defensive)", () => {
		const harness = setupHarness(`
			<div data-test-reader-slot
				data-reader-status="streaming"
				data-stream-base-url="https://stream.readplace.com">
				<iframe data-reader-streaming-iframe srcdoc=""></iframe>
			</div>
		`);
		initReaderStream(harness.deps);
		expect(harness.eventSources).toHaveLength(0);
	});

	it("does NOT open an EventSource for a streaming slot missing the streaming iframe element (rendered HTML is malformed)", () => {
		const harness = setupHarness(`
			<div data-test-reader-slot
				data-reader-status="streaming"
				data-article-url="https://example.com/article"
				data-stream-base-url="https://stream.readplace.com">
			</div>
		`);
		initReaderStream(harness.deps);
		expect(harness.eventSources).toHaveLength(0);
	});

	it("forwards chunk events to the iframe via postMessage once the iframe announces ready", async () => {
		const harness = setupHarness(STREAMING_SLOT_HTML, { autoReadyIframe: false });
		initReaderStream(harness.deps);
		const es = harness.eventSources[0];

		const iframe = harness.window.document.querySelector("iframe");
		if (!iframe) throw new Error("iframe missing");
		const posted: unknown[] = [];
		const fakeContentWindow = {
			postMessage: (data: unknown) => { posted.push(data); },
		};
		Object.defineProperty(iframe, "contentWindow", {
			value: fakeContentWindow,
			configurable: true,
		});

		// Chunk arrives BEFORE readplace-ready — should buffer.
		es.dispatch("chunk", JSON.stringify("<p>early chunk</p>"));
		expect(posted).toHaveLength(0);

		// Iframe announces ready — buffered chunk flushes.
		harness.window.dispatchEvent(
			new harness.window.MessageEvent("message", {
				source: fakeContentWindow as unknown as Window,
				data: { type: "readplace-ready" },
			}),
		);
		expect(posted).toEqual([{ type: "readplace-chunk", html: "<p>early chunk</p>" }]);

		// Subsequent chunks deliver immediately.
		es.dispatch("chunk", JSON.stringify("<p>later chunk</p>"));
		expect(posted).toEqual([
			{ type: "readplace-chunk", html: "<p>early chunk</p>" },
			{ type: "readplace-chunk", html: "<p>later chunk</p>" },
		]);
	});

	it("advances the from offset by each chunk's length so a reconnect resumes at the right place", () => {
		const harness = setupHarness(STREAMING_SLOT_HTML);
		initReaderStream(harness.deps);
		const es = harness.eventSources[0];

		es.dispatch("chunk", JSON.stringify("<p>abc</p>"));
		es.dispatch("error");

		// Retry timer scheduled, then fired (reconnect URL includes new from).
		expect(harness.setTimeoutFns).toHaveLength(1);
		harness.setTimeoutFns[0].fn();
		expect(harness.eventSources).toHaveLength(2);
		expect(harness.eventSources[1].url).toContain("from=52"); // 42 prerendered + 10 chunk
	});

	it("retries on EventSource error up to 3 times with exponential-ish backoff, then surrenders to the HTMX poll", () => {
		const harness = setupHarness(STREAMING_SLOT_HTML);
		initReaderStream(harness.deps);

		// Initial connection.
		expect(harness.eventSources).toHaveLength(1);

		// 3 errors → 3 retry timers + 3 more connections (4 total).
		for (let attempt = 1; attempt <= 3; attempt++) {
			harness.eventSources[harness.eventSources.length - 1].dispatch("error");
			expect(harness.setTimeoutFns).toHaveLength(attempt);
			harness.setTimeoutFns[attempt - 1].fn();
		}
		expect(harness.eventSources).toHaveLength(4);

		// 4th error → no more retries (surrender to HTMX poll).
		harness.eventSources[3].dispatch("error");
		expect(harness.setTimeoutFns).toHaveLength(3); // no new timer
	});

	it("reloads the page on the 'done' event so the canonical reader-ready iframe replaces the streaming one", () => {
		const reload = jest.fn();
		const harness = setupHarness(STREAMING_SLOT_HTML, { reload });
		initReaderStream(harness.deps);
		harness.eventSources[0].dispatch("done");

		expect(reload).toHaveBeenCalledTimes(1);
		expect(harness.eventSources[0].closed).toBe(true);
	});

	it("scan is idempotent — a second swap with the same slot does not open a duplicate EventSource", () => {
		const harness = setupHarness(STREAMING_SLOT_HTML);
		const { scan } = initReaderStream(harness.deps);

		// Re-fire the swap listener with the body — same slot is still there.
		scan(harness.window.document.body);
		scan(harness.window.document.body);

		expect(harness.eventSources).toHaveLength(1);
	});

	it("skips malformed chunk frames silently rather than poisoning the session", () => {
		const harness = setupHarness(STREAMING_SLOT_HTML);
		initReaderStream(harness.deps);
		const es = harness.eventSources[0];

		const iframe = harness.window.document.querySelector("iframe");
		if (!iframe) throw new Error("iframe missing");
		const posted: unknown[] = [];
		Object.defineProperty(iframe, "contentWindow", {
			value: { postMessage: (data: unknown) => { posted.push(data); } },
			configurable: true,
		});

		es.dispatch("chunk", "not-valid-json{");
		es.dispatch("chunk", JSON.stringify(42)); // not a string
		es.dispatch("chunk", JSON.stringify("")); // empty string

		expect(posted).toHaveLength(0);

		// A valid chunk arriving after the malformed ones still works.
		harness.window.dispatchEvent(
			new harness.window.MessageEvent("message", {
				source: iframe.contentWindow as unknown as Window,
				data: { type: "readplace-ready" },
			}),
		);
		es.dispatch("chunk", JSON.stringify("<p>good</p>"));

		expect(posted).toEqual([{ type: "readplace-chunk", html: "<p>good</p>" }]);
	});

	it("silently drops buffered chunks when the iframe loses its contentWindow before flush (defensive — should never happen in practice)", () => {
		const harness = setupHarness(STREAMING_SLOT_HTML, { autoReadyIframe: false });
		initReaderStream(harness.deps);
		const es = harness.eventSources[0];

		const iframe = harness.window.document.querySelector("iframe");
		if (!iframe) throw new Error("iframe missing");
		// Pretend the iframe got detached: contentWindow becomes null.
		Object.defineProperty(iframe, "contentWindow", {
			value: null,
			configurable: true,
		});

		// Buffer a chunk before ready.
		es.dispatch("chunk", JSON.stringify("<p>buffered</p>"));

		// Now an unrelated source fires a ready message with null contentWindow
		// — handleReadyMessage's source check rejects it; flushPending never runs.
		harness.window.dispatchEvent(
			new harness.window.MessageEvent("message", {
				source: harness.window as unknown as Window,
				data: { type: "readplace-ready" },
			}),
		);
		// No throw, no posting (already covered) — verifying clean handling.
		expect(es.closed).toBe(false);
	});

	it("ignores messages with no data payload (defensive against postMessage from unrelated sources)", () => {
		const harness = setupHarness(STREAMING_SLOT_HTML, { autoReadyIframe: false });
		initReaderStream(harness.deps);
		const iframe = harness.window.document.querySelector("iframe");
		if (!iframe) throw new Error("iframe missing");

		// Fire a ready-shaped message but with null data — handleReadyMessage
		// must early-return rather than throw on `data?.type`.
		harness.window.dispatchEvent(
			new harness.window.MessageEvent("message", {
				source: iframe.contentWindow as unknown as Window,
				data: null,
			}),
		);
		expect(harness.eventSources[0].closed).toBe(false);
	});

	it("a 'done' event during a pending retry timer prevents the retry from re-opening (terminated guard in open)", () => {
		const reload = jest.fn();
		const harness = setupHarness(STREAMING_SLOT_HTML, { reload });
		initReaderStream(harness.deps);
		const firstEs = harness.eventSources[0];

		// Error → retry scheduled.
		firstEs.dispatch("error");
		expect(harness.setTimeoutFns).toHaveLength(1);

		// "done" arrives before the retry timer fires. Since the original
		// EventSource is already closed and a new one isn't yet open, this
		// scenario simulates a race where the user's terminal arrives during
		// backoff. The pending retry timer's fn will then call open() with
		// terminated=true and the early-return short-circuits.
		firstEs.dispatch("done"); // would normally not be possible after close, but tests the guard
		expect(reload).toHaveBeenCalledTimes(1);

		// Now fire the pending retry timer — open() should bail at the
		// terminated guard and NOT create another EventSource.
		harness.setTimeoutFns[0].fn();
		expect(harness.eventSources).toHaveLength(1);
	});

	it("handles a server reconnect event without consuming the retry budget", () => {
		const harness = setupHarness(STREAMING_SLOT_HTML);
		initReaderStream(harness.deps);
		const es1 = harness.eventSources[0];

		es1.dispatch("reconnect", "100");

		expect(es1.closed).toBe(true);
		expect(harness.eventSources).toHaveLength(2);
		expect(harness.eventSources[1].url).toContain("from=100");

		// A subsequent real error still has full retry budget.
		harness.eventSources[1].dispatch("error");
		expect(harness.setTimeoutFns).toHaveLength(1);
		harness.setTimeoutFns[0].fn();
		expect(harness.eventSources).toHaveLength(3);
	});

	it("survives 5 consecutive reconnects exceeding MAX_RETRIES without surrendering", () => {
		const harness = setupHarness(STREAMING_SLOT_HTML);
		initReaderStream(harness.deps);

		for (let i = 0; i < 5; i++) {
			const es = harness.eventSources[harness.eventSources.length - 1];
			es.dispatch("reconnect", String(100 + i * 50));
		}

		expect(harness.eventSources).toHaveLength(6);
		const lastEs = harness.eventSources[5];
		expect(lastEs.closed).toBe(false);
		expect(lastEs.url).toContain("from=300");
	});

	it("does not double-count when reconnect and error fire on the same EventSource", () => {
		const harness = setupHarness(STREAMING_SLOT_HTML);
		initReaderStream(harness.deps);
		const es1 = harness.eventSources[0];

		es1.dispatch("reconnect", "100");
		es1.dispatch("error");

		expect(harness.eventSources).toHaveLength(2);
		expect(harness.setTimeoutFns).toHaveLength(0);

		// Retry budget intact — a real error on the new connection still retries.
		harness.eventSources[1].dispatch("error");
		expect(harness.setTimeoutFns).toHaveLength(1);
	});

	it("ignores readplace-ready messages whose source is not the streaming iframe (cross-frame poisoning defence)", () => {
		const harness = setupHarness(STREAMING_SLOT_HTML, { autoReadyIframe: false });
		initReaderStream(harness.deps);
		const es = harness.eventSources[0];

		const iframe = harness.window.document.querySelector("iframe");
		if (!iframe) throw new Error("iframe missing");
		const posted: unknown[] = [];
		Object.defineProperty(iframe, "contentWindow", {
			value: { postMessage: (data: unknown) => { posted.push(data); } },
			configurable: true,
		});

		es.dispatch("chunk", JSON.stringify("<p>buffered</p>"));

		// Forged ready message from an unrelated source — must not flush.
		harness.window.dispatchEvent(
			new harness.window.MessageEvent("message", {
				source: harness.window as unknown as Window,
				data: { type: "readplace-ready" },
			}),
		);
		expect(posted).toHaveLength(0);

		// Real ready message DOES flush.
		harness.window.dispatchEvent(
			new harness.window.MessageEvent("message", {
				source: iframe.contentWindow as unknown as Window,
				data: { type: "readplace-ready" },
			}),
		);
		expect(posted).toHaveLength(1);
	});
});
