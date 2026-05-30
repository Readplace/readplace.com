import { JSDOM } from "jsdom";
import {
	computeCadenceMs,
	initBootstrap,
	markPrerenderedContent,
	sanitizeChunkInto,
	walkAndWrap,
} from "./reader-stream-bootstrap.iframe";

function setupIframeDom(initialContent = "") {
	const dom = new JSDOM(
		`<!doctype html><html><body><article id="content">${initialContent}</article></body></html>`,
	);
	return dom.window.document;
}

describe("sanitizeChunkInto", () => {
	it("inserts HTML into the parent element", () => {
		const document = setupIframeDom();
		const parent = document.createElement("div");
		sanitizeChunkInto(parent, "<p>hello</p>");
		expect(parent.innerHTML).toContain("hello");
	});

	it("strips <script> elements (defence-in-depth against forged postMessage chunks)", () => {
		const document = setupIframeDom();
		const parent = document.createElement("div");
		sanitizeChunkInto(parent, "<p>safe</p><script>window.exploit=true</script>");
		expect(parent.querySelectorAll("script")).toHaveLength(0);
		expect(parent.textContent).toContain("safe");
	});

	it("strips inline on* event-handler attributes from all elements", () => {
		const document = setupIframeDom();
		const parent = document.createElement("div");
		sanitizeChunkInto(
			parent,
			'<img src="x" onerror="alert(1)"><p onclick="steal()" onmouseover="track()">safe text</p>',
		);
		const allElements = parent.querySelectorAll("*");
		for (const el of Array.from(allElements)) {
			const onAttrs = el.getAttributeNames().filter((n) => /^on/i.test(n));
			expect(onAttrs).toEqual([]);
		}
		expect(parent.textContent).toContain("safe text");
		expect(parent.querySelector("img")).toBeTruthy();
	});

	it("strips <iframe>, <object>, <embed>, <style> in the same pass", () => {
		const document = setupIframeDom();
		const parent = document.createElement("div");
		sanitizeChunkInto(
			parent,
			"<style>* { display: none }</style><iframe></iframe><object></object><embed>",
		);
		expect(parent.querySelectorAll("style, iframe, object, embed")).toHaveLength(0);
	});
});

describe("walkAndWrap", () => {
	it("wraps each whitespace-delimited word in a <span class='rp-word'>", () => {
		const document = setupIframeDom("<p>Hello world example</p>");
		const root = document.getElementById("content");
		if (!root) throw new Error("content missing");
		const collected: HTMLSpanElement[] = [];
		walkAndWrap(root, collected, document);
		expect(collected.length).toBe(3);
		expect(collected.map((s) => s.textContent)).toEqual(["Hello", "world", "example"]);
		for (const span of collected) expect(span.className).toBe("rp-word");
	});

	it("preserves the surrounding HTML structure (inline elements survive)", () => {
		const document = setupIframeDom("<p>Hello <strong>bold</strong> world</p>");
		const root = document.getElementById("content");
		if (!root) throw new Error("content missing");
		const collected: HTMLSpanElement[] = [];
		walkAndWrap(root, collected, document);
		// 3 words: "Hello", "bold", "world"
		expect(collected.length).toBe(3);
		// <strong> wrapper survives — its child text node was wrapped, the
		// element itself is untouched.
		const strong = root.querySelector("strong");
		if (!strong) throw new Error("strong element must survive walkAndWrap");
		expect(strong.textContent).toBe("bold");
	});

	it("does not descend into BLOCKED_TAGS subtrees (defence-in-depth)", () => {
		const document = setupIframeDom("<p>safe</p><script>danger words here</script>");
		const root = document.getElementById("content");
		if (!root) throw new Error("content missing");
		const collected: HTMLSpanElement[] = [];
		walkAndWrap(root, collected, document);
		// Only "safe" wrapped — words inside <script> stay raw and untouched.
		expect(collected.map((s) => s.textContent)).toEqual(["safe"]);
	});

	it("preserves whitespace between words", () => {
		const document = setupIframeDom("<p>a  b</p>");
		const root = document.getElementById("content");
		if (!root) throw new Error("content missing");
		const collected: HTMLSpanElement[] = [];
		walkAndWrap(root, collected, document);
		expect(collected.length).toBe(2);
		const p = root.querySelector("p");
		expect(p?.textContent).toBe("a  b");
	});

	it("skips empty text nodes (createTextNode(\"\") edge case)", () => {
		const document = setupIframeDom();
		const root = document.getElementById("content");
		if (!root) throw new Error("content missing");
		root.appendChild(document.createTextNode(""));
		const collected: HTMLSpanElement[] = [];
		walkAndWrap(root, collected, document);
		expect(collected).toEqual([]);
	});

	it("handles a text node with no whitespace as a single word", () => {
		const document = setupIframeDom("<p>oneword</p>");
		const root = document.getElementById("content");
		if (!root) throw new Error("content missing");
		const collected: HTMLSpanElement[] = [];
		walkAndWrap(root, collected, document);
		expect(collected.length).toBe(1);
		expect(collected[0].textContent).toBe("oneword");
	});
});

describe("markPrerenderedContent", () => {
	it("marks already-rendered words as rp-word--prerendered with opacity 1 (no fade-in for server-baked content)", () => {
		const document = setupIframeDom("<p>server baked content</p>");
		const root = document.getElementById("content");
		if (!root) throw new Error("content missing");

		markPrerenderedContent(root);

		const spans = root.querySelectorAll(".rp-word");
		expect(spans.length).toBe(3);
		for (const span of Array.from(spans)) {
			expect(span.classList.contains("rp-word--prerendered")).toBe(true);
			expect((span as HTMLElement).style.opacity).toBe("1");
		}
	});
});

describe("computeCadenceMs", () => {
	it("targets finishing just before the next chunk arrives (cadence = available time / total words)", () => {
		// 100ms available, 10 words → 10ms/word.
		const cadence = computeCadenceMs({
			pendingCount: 0,
			newWordCount: 10,
			nextSlotMs: 1000,
			interChunkEmaMs: 1000 / 0.9, // makes targetFinishMs = 1000 + ema*0.9 = 2000
			nowMs: 1000,
		});
		// targetFinishMs ≈ 2000; (2000-1000)/10 = 100, but clamped against the
		// floor — let's pick numbers that fall in the legal range.
		expect(cadence).toBeGreaterThanOrEqual(15);
		expect(cadence).toBeLessThanOrEqual(120);
	});

	it("clamps below the floor when the queue is far too big for the remaining time", () => {
		const cadence = computeCadenceMs({
			pendingCount: 0,
			newWordCount: 1000,
			nextSlotMs: 1000,
			interChunkEmaMs: 200, // very short — definitely below floor per word
			nowMs: 1000,
		});
		expect(cadence).toBe(15);
	});

	it("clamps above the ceiling when there is a single word but lots of time", () => {
		const cadence = computeCadenceMs({
			pendingCount: 0,
			newWordCount: 1,
			nextSlotMs: 1000,
			interChunkEmaMs: 10_000,
			nowMs: 1000,
		});
		expect(cadence).toBe(120);
	});

	it("falls back to the floor when there are no words to schedule (edge case)", () => {
		const cadence = computeCadenceMs({
			pendingCount: 0,
			newWordCount: 0,
			nextSlotMs: 0,
			interChunkEmaMs: 250,
			nowMs: 0,
		});
		expect(cadence).toBe(15);
	});
});

describe("initBootstrap", () => {
	function makeWindow(initialContent: string) {
		const dom = new JSDOM(
			`<!doctype html><html><body><article id="content">${initialContent}</article></body></html>`,
		);
		const { window } = dom;
		const parentPosts: Array<{ data: unknown; targetOrigin: string }> = [];
		const fakeParent = {
			postMessage: (data: unknown, targetOrigin: string) => {
				parentPosts.push({ data, targetOrigin });
			},
		} as unknown as Window;
		let nowMs = 0;
		const rafCallbacks: Array<() => void> = [];

		const deps = {
			document: window.document,
			parent: fakeParent,
			addEventListener: window.addEventListener.bind(window) as Window["addEventListener"],
			performance: { now: () => nowMs },
			requestAnimationFrame: ((cb: () => void) => {
				rafCallbacks.push(cb);
				return 0;
			}) as unknown as Window["requestAnimationFrame"],
		};

		return {
			window,
			deps,
			parentPosts,
			rafCallbacks,
			setNow: (ms: number) => { nowMs = ms; },
			drainOneRaf: () => {
				const cb = rafCallbacks.shift();
				if (cb) cb();
			},
		};
	}

	it("posts {type:'readplace-ready'} to parent on init so the parent knows the listener is mounted", () => {
		const harness = makeWindow("");
		initBootstrap(harness.deps);
		expect(harness.parentPosts).toEqual([
			{ data: { type: "readplace-ready" }, targetOrigin: "*" },
		]);
	});

	it("ignores message events whose e.source is not window.parent (cross-frame poisoning defence)", () => {
		const harness = makeWindow("");
		const bootstrap = initBootstrap(harness.deps);
		const wordCountBefore = harness.window.document.querySelectorAll(".rp-word").length;
		harness.window.dispatchEvent(
			new harness.window.MessageEvent("message", {
				source: null,
				data: { type: "readplace-chunk", html: "<p>injected words</p>" },
			}),
		);
		expect(harness.window.document.querySelectorAll(".rp-word").length).toBe(wordCountBefore);
		expect(bootstrap.state.pendingWords.length).toBe(0);
	});

	it("ignores messages whose data.type is not 'readplace-chunk' (random parent chatter does not appear in the reader)", () => {
		const harness = makeWindow("");
		const bootstrap = initBootstrap(harness.deps);
		harness.window.dispatchEvent(
			new harness.window.MessageEvent("message", {
				source: harness.deps.parent,
				data: { type: "something-else", html: "<p>nope</p>" },
			}),
		);
		expect(bootstrap.state.pendingWords.length).toBe(0);
	});

	it("appends new chunk content to the iframe and queues its words for reveal", () => {
		const harness = makeWindow("");
		const bootstrap = initBootstrap(harness.deps);
		bootstrap.onChunk("<p>three new words</p>");
		expect(bootstrap.state.pendingWords.length).toBe(3);
		const spans = harness.window.document.querySelectorAll(".rp-word");
		// 3 newly-streamed words wrapped (no prerendered content to skip).
		expect(spans.length).toBe(3);
	});

	it("does NOT schedule reveals or kick the rAF loop when an incoming chunk yields zero new words", () => {
		const harness = makeWindow("");
		const bootstrap = initBootstrap(harness.deps);
		const rafBefore = harness.rafCallbacks.length;
		// A chunk with no text content (just empty wrapping markup).
		bootstrap.onChunk("<div></div>");
		expect(bootstrap.state.pendingWords.length).toBe(0);
		expect(harness.rafCallbacks.length).toBe(rafBefore);
	});

	it("re-queues itself via requestAnimationFrame while words remain pending (tick loop continues until queue drains)", () => {
		const harness = makeWindow("");
		const bootstrap = initBootstrap(harness.deps);
		bootstrap.onChunk("<p>a b c d e</p>");
		expect(harness.rafCallbacks.length).toBeGreaterThan(0);

		harness.setNow(1); // not enough time for any word to reveal
		harness.drainOneRaf();
		// Pending words still > 0 → tick should have queued another rAF.
		expect(bootstrap.state.pendingWords.length).toBeGreaterThan(0);
		expect(harness.rafCallbacks.length).toBeGreaterThan(0);
	});

	it("reveals queued words when their revealAtMs elapses (tick drains the front of the queue)", () => {
		const harness = makeWindow("");
		const bootstrap = initBootstrap(harness.deps);
		bootstrap.onChunk("<p>a b c d e</p>");
		const totalPending = bootstrap.state.pendingWords.length;
		expect(totalPending).toBeGreaterThan(0);

		// Fast-forward to a time after all words should have revealed.
		harness.setNow(10_000);
		// Tick repeatedly until the queue drains.
		while (bootstrap.state.pendingWords.length > 0) {
			bootstrap.tick();
		}
		const revealedCount = Array.from(
			harness.window.document.querySelectorAll(".rp-word"),
		).filter((s) => (s as HTMLElement).style.opacity === "1").length;
		expect(revealedCount).toBe(totalPending);
	});

	it("updates the EMA inter-chunk gap when a second chunk arrives", () => {
		const harness = makeWindow("");
		const bootstrap = initBootstrap(harness.deps);
		harness.setNow(0);
		bootstrap.onChunk("<p>a b</p>");
		const initialEma = bootstrap.state.interChunkEmaMs;
		harness.setNow(500);
		bootstrap.onChunk("<p>c d</p>");
		expect(bootstrap.state.interChunkEmaMs).not.toBe(initialEma);
	});

	it("treats already-rendered content (server-baked) as prerendered and skips fade-in for it", () => {
		const harness = makeWindow("<p>baked content here</p>");
		initBootstrap(harness.deps);
		const prerendered = harness.window.document.querySelectorAll(".rp-word--prerendered");
		expect(prerendered.length).toBe(3);
		for (const span of Array.from(prerendered)) {
			expect((span as HTMLElement).style.opacity).toBe("1");
		}
	});

	it("throws on init if the #content element is missing (invariant: bootstrap must run inside the correct srcdoc)", () => {
		const dom = new JSDOM(`<!doctype html><html><body></body></html>`);
		const { window } = dom;
		const deps = {
			document: window.document,
			parent: window as unknown as Window,
			addEventListener: window.addEventListener.bind(window) as Window["addEventListener"],
			performance: { now: () => 0 },
			requestAnimationFrame: ((_cb: () => void) => 0) as unknown as Window["requestAnimationFrame"],
		};
		expect(() => initBootstrap(deps)).toThrow(/#content/);
	});

	it("ignores messages with no data payload (defensive against postMessage from unrelated sources)", () => {
		const harness = makeWindow("");
		const bootstrap = initBootstrap(harness.deps);
		harness.window.dispatchEvent(
			new harness.window.MessageEvent("message", {
				source: harness.deps.parent,
				data: null,
			}),
		);
		expect(bootstrap.state.pendingWords.length).toBe(0);
	});

	it("ignores readplace-chunk messages with a non-string html field (zod-shaped boundary)", () => {
		const harness = makeWindow("");
		const bootstrap = initBootstrap(harness.deps);
		harness.window.dispatchEvent(
			new harness.window.MessageEvent("message", {
				source: harness.deps.parent,
				data: { type: "readplace-chunk", html: 42 },
			}),
		);
		expect(bootstrap.state.pendingWords.length).toBe(0);
	});

	it("processes valid readplace-chunk messages via the message dispatch path (end-to-end)", () => {
		const harness = makeWindow("");
		const bootstrap = initBootstrap(harness.deps);
		harness.window.dispatchEvent(
			new harness.window.MessageEvent("message", {
				source: harness.deps.parent,
				data: { type: "readplace-chunk", html: "<p>real chunk</p>" },
			}),
		);
		expect(bootstrap.state.pendingWords.length).toBe(2);
	});
});
