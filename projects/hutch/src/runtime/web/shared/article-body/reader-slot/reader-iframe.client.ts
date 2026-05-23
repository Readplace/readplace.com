/**
 * Client-side auto-height controller for the sandboxed reader iframe.
 *
 * The reader article body is rendered inside an `<iframe srcdoc>` so captured
 * CSS, inline styles, and oversized images cannot escape and overlap the
 * Readplace chrome (sticky CTA, share balloon, header). The iframe must look
 * identical to inline content from the user's perspective: no internal
 * scrollbar, no border, parent-document scroll only.
 *
 * This module measures the iframe's content height and writes it back to the
 * iframe element's inline style on every event that could change it. There is
 * no `overflow: hidden` anywhere — if the height calculation regresses, the
 * resulting internal scrollbar is a visible bug signal we want to surface.
 *
 * Idempotent re-bind on HTMX swap: when a reader poll replaces the iframe
 * element, observers on the old element are disposed and re-attached to the
 * new one.
 */

function assert(cond: unknown, message: string): asserts cond {
	if (!cond) throw new Error(message);
}

interface ResizeObserverLike {
	observe(target: Element): void;
	disconnect(): void;
}

interface MutationObserverLike {
	observe(target: Node, options: { childList: boolean; subtree: boolean }): void;
	disconnect(): void;
}

interface ReaderIframeDeps {
	document: Document;
	ResizeObserver: new (callback: () => void) => ResizeObserverLike;
	MutationObserver: new (callback: () => void) => MutationObserverLike;
	addSwapListener: (listener: () => void) => void;
}

interface IframeBinding {
	iframe: HTMLIFrameElement;
	resizeObserver: ResizeObserverLike;
	mutationObserver: MutationObserverLike;
	imageListeners: Array<{
		image: HTMLImageElement;
		onLoad: () => void;
		onError: () => void;
	}>;
	onLoad: () => void;
}

const SELECTOR = "iframe[data-reader-iframe]";

export function measureContentHeight(doc: Document): number {
	/**
	 * 1. Different browsers disagree on whether documentElement or body carries
	 *    the larger scrollHeight when absolutely-positioned descendants overflow
	 *    the body. Take the max so neither pathway leaves an internal scrollbar.
	 * 2. Math.ceil avoids a sub-pixel rounding gap leaving a 0.5px scrollbar.
	 */
	return Math.ceil(
		Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight), /* 1 */
	); /* 2 */
}

export function initReaderIframes(deps: ReaderIframeDeps): {
	scan: () => void;
	stop: () => void;
} {
	const bindings = new Map<HTMLIFrameElement, IframeBinding>();
	let stopped = false;

	function applyHeight(iframe: HTMLIFrameElement): void {
		const doc = iframe.contentDocument;
		assert(
			doc,
			"reader iframe must be same-origin so contentDocument is reachable",
		);
		iframe.style.height = `${measureContentHeight(doc)}px`;
	}

	function bindImages(binding: IframeBinding): void {
		const doc = binding.iframe.contentDocument;
		assert(doc, "iframe contentDocument must exist before binding images");
		for (const image of Array.from(doc.images)) {
			if (image.complete) continue;
			const onLoad = () => applyHeight(binding.iframe);
			const onError = () => applyHeight(binding.iframe);
			image.addEventListener("load", onLoad, { once: true });
			image.addEventListener("error", onError, { once: true });
			binding.imageListeners.push({ image, onLoad, onError });
		}
	}

	function bind(iframe: HTMLIFrameElement): void {
		const existing = bindings.get(iframe);
		if (existing !== undefined) return;

		const resizeObserver = new deps.ResizeObserver(() => applyHeight(iframe));
		const mutationObserver = new deps.MutationObserver(() =>
			applyHeight(iframe),
		);
		const binding: IframeBinding = {
			iframe,
			resizeObserver,
			mutationObserver,
			imageListeners: [],
			onLoad: () => {
				const doc = iframe.contentDocument;
				assert(
					doc,
					"reader iframe must be same-origin to size against its content",
				);
				resizeObserver.observe(doc.documentElement);
				mutationObserver.observe(doc.body, {
					childList: true,
					subtree: true,
				});
				bindImages(binding);
				applyHeight(iframe);
			},
		};
		bindings.set(iframe, binding);

		iframe.addEventListener("load", binding.onLoad);
		/**
		 * 1. When the iframe element is already loaded by the time we scan
		 *    (HTMX swap inserts a parsed iframe whose `load` may have fired
		 *    before this listener attached), fire the load handler immediately.
		 *    `contentDocument.readyState === 'complete'` is the reliable signal.
		 */
		if (iframe.contentDocument?.readyState === "complete") {
			binding.onLoad(); /* 1 */
		}
	}

	function unbind(iframe: HTMLIFrameElement): void {
		const binding = bindings.get(iframe);
		if (binding === undefined) return;
		binding.resizeObserver.disconnect();
		binding.mutationObserver.disconnect();
		for (const { image, onLoad, onError } of binding.imageListeners) {
			image.removeEventListener("load", onLoad);
			image.removeEventListener("error", onError);
		}
		iframe.removeEventListener("load", binding.onLoad);
		bindings.delete(iframe);
	}

	function scan(): void {
		if (stopped) return;
		const live = new Set(
			Array.from(deps.document.querySelectorAll<HTMLIFrameElement>(SELECTOR)),
		);
		for (const iframe of Array.from(bindings.keys())) {
			if (!live.has(iframe)) unbind(iframe);
		}
		for (const iframe of live) {
			const wasBound = bindings.has(iframe);
			bind(iframe);
			/**
			 * 1. Already-bound iframes still benefit from a re-measure on swap:
			 *    HTMX may have replaced sibling DOM that affects the iframe's
			 *    available width, and the observers do not see width changes
			 *    triggered by the swap itself until layout flushes.
			 */
			if (wasBound && iframe.contentDocument?.readyState === "complete") {
				applyHeight(iframe); /* 1 */
			}
		}
	}

	deps.addSwapListener(scan);
	scan();

	return {
		scan,
		stop(): void {
			stopped = true;
			for (const iframe of Array.from(bindings.keys())) unbind(iframe);
		},
	};
}
