/**
 * Runs inside the streaming reader iframe (sandbox: allow-scripts +
 * allow-same-origin). Receives HTML chunks from the parent via postMessage,
 * splits each chunk into word-level `<span class="rp-word">` wrappers, and
 * reveals them at an adaptive cadence that drains the queue just before the
 * next chunk arrives — producing a continuous "always streaming" feel even
 * though the underlying transport delivers in bursts.
 *
 * Compiled by `build-client-bundles.js` and inlined into the iframe's
 * srcdoc by `reader-streaming-iframe-srcdoc.ts` (the iframe is created from
 * the parent's HTML, so the script must be present in the srcdoc itself —
 * the sandboxed origin has no relative path to fetch a separate file from).
 *
 * Boundary contract:
 *   - Listens for `message` events where `e.source === window.parent` AND
 *     `e.data?.type === "readplace-chunk"` carrying a string `html`.
 *   - Posts `{ type: "readplace-ready" }` to `window.parent` on load so the
 *     parent only opens its EventSource once the listener is mounted.
 *   - Strips `<script>` / `<style>` / `<iframe>` / `<object>` / `<embed>`
 *     and inline `on*` event-handler attributes from every incoming chunk
 *     before insertion as a defence-in-depth pass (the partial content has
 *     already been sanitised upstream).
 */

interface BootstrapWindow {
	document: Document;
	parent: Window;
	addEventListener: Window["addEventListener"];
	performance: { now(): number };
	requestAnimationFrame: Window["requestAnimationFrame"];
}

interface PendingWord {
	span: HTMLSpanElement;
	revealAtMs: number;
}

interface BootstrapState {
	pendingWords: PendingWord[];
	lastChunkAtMs: number;
	/* Tracks "have we recorded a previous chunk yet" separately from
	 * `lastChunkAtMs`. Truthiness alone on a millisecond timestamp would
	 * misfire when `performance.now()` legitimately returns 0 at iframe
	 * load time. */
	hasPriorChunk: boolean;
	interChunkEmaMs: number;
	rafQueued: boolean;
}

const BLOCKED_TAGS = new Set([
	"SCRIPT",
	"STYLE",
	"IFRAME",
	"OBJECT",
	"EMBED",
]);

const MIN_CADENCE_MS = 15;
const MAX_CADENCE_MS = 120;
const EMA_ALPHA = 0.3;
const TARGET_FINISH_FRACTION = 0.9;
const INITIAL_EMA_MS = 250;

/**
 * Mark every text-bearing word in already-rendered content as
 * "prerendered" (opacity 1, no animation). Called once on init so the
 * server-baked snapshot doesn't fade in — only newly-streamed words get
 * the reveal animation.
 */
export function markPrerenderedContent(root: Element): void {
	const collected: HTMLSpanElement[] = [];
	walkAndWrap(root, collected, root.ownerDocument);
	for (const span of collected) {
		span.classList.add("rp-word--prerendered");
		span.style.opacity = "1";
	}
}

/**
 * Sanitise an HTML chunk by stripping script-bearing / framing elements
 * before parsing it into the iframe DOM. The defense lives here as well
 * as upstream because the iframe processes raw `postMessage` payloads that
 * could in principle be forged by another script in the parent context.
 */
export function sanitizeChunkInto(parent: HTMLElement, html: string): void {
	parent.innerHTML = html;
	const blocked = parent.querySelectorAll("script, style, iframe, object, embed");
	for (let i = 0; i < blocked.length; i++) {
		const node = blocked[i];
		const p = node.parentNode;
		// `parentNode` of a node returned by `querySelectorAll` against the
		// just-set innerHTML is always defined (the node lives inside parent).
		assert(p, "node returned by querySelectorAll must have a parent");
		p.removeChild(node);
	}
	const allElements = parent.querySelectorAll("*");
	for (let i = 0; i < allElements.length; i++) {
		const el = allElements[i];
		for (const name of el.getAttributeNames()) {
			if (/^on/i.test(name)) el.removeAttribute(name);
		}
	}
}

/** Walk a subtree wrapping each whitespace-delimited token in `<span
 * class="rp-word">`. Whitespace and BLOCKED_TAGS-housed subtrees are
 * preserved as-is. `collected` is appended with the spans in source order. */
export function walkAndWrap(
	root: Node,
	collected: HTMLSpanElement[],
	document: Document,
): void {
	const stack: Node[] = [root];
	let head = stack.pop();
	while (head !== undefined) {
		const children: Node[] = [];
		let child = head.firstChild;
		while (child) {
			children.push(child);
			child = child.nextSibling;
		}
		for (const c of children) {
			if (c.nodeType === 3) {
				wrapWordsInTextNode(c as Text, collected, document);
			} else if (c.nodeType === 1) {
				const el = c as Element;
				if (!BLOCKED_TAGS.has(el.tagName)) stack.push(el);
			}
		}
		head = stack.pop();
	}
}

function wrapWordsInTextNode(
	textNode: Text,
	collected: HTMLSpanElement[],
	document: Document,
): void {
	const content = textNode.textContent;
	// DOM spec: Text.textContent returns the node's data verbatim — never
	// null. Asserting eliminates the ?? branch V8 reports as uncovered.
	assert(content !== null, "Text.textContent must be a string");
	if (content === "") return;
	const parts = content.split(/(\s+)/);
	if (parts.length <= 1 && !/\s/.test(content)) {
		const span = document.createElement("span");
		span.className = "rp-word";
		span.textContent = content;
		textNode.parentNode?.replaceChild(span, textNode);
		collected.push(span);
		return;
	}
	const frag = document.createDocumentFragment();
	for (const part of parts) {
		if (part === "") continue;
		if (/^\s+$/.test(part)) {
			frag.appendChild(document.createTextNode(part));
		} else {
			const span = document.createElement("span");
			span.className = "rp-word";
			span.textContent = part;
			frag.appendChild(span);
			collected.push(span);
		}
	}
	textNode.parentNode?.replaceChild(frag, textNode);
}

/**
 * Compute the per-word reveal cadence for a chunk. The aim is to finish
 * draining the queue just before the next chunk is predicted to arrive
 * (using the EMA of inter-chunk gaps), so the reveal feels continuous
 * even though chunks arrive in bursts. Clamped to `[15, 120]` ms — below
 * 15ms the eye can't track; above 120ms the stream stutters.
 */
export function computeCadenceMs(args: {
	pendingCount: number;
	newWordCount: number;
	nextSlotMs: number;
	interChunkEmaMs: number;
	nowMs: number;
}): number {
	const targetFinishMs = args.nowMs + args.interChunkEmaMs * TARGET_FINISH_FRACTION;
	const total = args.pendingCount + args.newWordCount;
	if (total === 0) return MIN_CADENCE_MS;
	const raw = (targetFinishMs - args.nextSlotMs) / total;
	if (raw < MIN_CADENCE_MS) return MIN_CADENCE_MS;
	if (raw > MAX_CADENCE_MS) return MAX_CADENCE_MS;
	return raw;
}

function assert(cond: unknown, message: string): asserts cond {
	if (!cond) throw new Error(message);
}

export function initBootstrap(deps: BootstrapWindow): {
	onChunk: (html: string) => void;
	tick: () => void;
	state: BootstrapState;
} {
	const contentOrNull = deps.document.getElementById("content");
	assert(contentOrNull, "streaming bootstrap: #content element missing");
	const content: HTMLElement = contentOrNull;
	markPrerenderedContent(content);
	const state: BootstrapState = {
		pendingWords: [],
		lastChunkAtMs: 0,
		hasPriorChunk: false,
		interChunkEmaMs: INITIAL_EMA_MS,
		rafQueued: false,
	};

	function onChunk(html: string): void {
		const nowMs = deps.performance.now();
		const scratch = deps.document.createElement("div");
		sanitizeChunkInto(scratch, html);
		const newWords: HTMLSpanElement[] = [];
		walkAndWrap(scratch, newWords, deps.document);
		while (scratch.firstChild) content.appendChild(scratch.firstChild);

		if (state.hasPriorChunk) {
			state.interChunkEmaMs =
				(1 - EMA_ALPHA) * state.interChunkEmaMs +
				EMA_ALPHA * (nowMs - state.lastChunkAtMs);
		}
		state.lastChunkAtMs = nowMs;
		state.hasPriorChunk = true;

		if (newWords.length === 0) return;

		const nextSlotMs =
			state.pendingWords.length > 0
				? state.pendingWords[state.pendingWords.length - 1].revealAtMs
				: nowMs;
		const cadenceMs = computeCadenceMs({
			pendingCount: state.pendingWords.length,
			newWordCount: newWords.length,
			nextSlotMs,
			interChunkEmaMs: state.interChunkEmaMs,
			nowMs,
		});

		let slot = nextSlotMs;
		for (const span of newWords) {
			slot += cadenceMs;
			state.pendingWords.push({ span, revealAtMs: slot });
		}

		if (!state.rafQueued) {
			state.rafQueued = true;
			deps.requestAnimationFrame(tick);
		}
	}

	function tick(): void {
		const nowMs = deps.performance.now();
		while (
			state.pendingWords.length > 0 &&
			state.pendingWords[0].revealAtMs <= nowMs
		) {
			const head = state.pendingWords.shift();
			// We just observed `pendingWords.length > 0` in the loop guard, so
			// `shift()` is guaranteed to return the head — asserting eliminates
			// the `if (head)` V8 branch.
			assert(head, "shift after length>0 must return the head");
			head.span.style.opacity = "1";
		}
		if (state.pendingWords.length > 0) {
			deps.requestAnimationFrame(tick);
		} else {
			state.rafQueued = false;
		}
	}

	deps.addEventListener("message", (event) => {
		if (event.source !== deps.parent) return;
		const data = event.data as { type?: string; html?: string } | undefined;
		if (!data || data.type !== "readplace-chunk") return;
		if (typeof data.html !== "string") return;
		onChunk(data.html);
	});
	deps.parent.postMessage({ type: "readplace-ready" }, "*");

	return { onChunk, tick, state };
}
