import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { initNextRead } from "./next-read.client";

const ARTICLE_TOP = 0;

function setup(options: { stateClass: string; articleBottom: number }) {
	const dom = new JSDOM(
		`<!doctype html><html><body>
			<div data-article-body></div>
			<div data-next-read class="next-read ${options.stateClass}"></div>
		</body></html>`,
	);
	const document = dom.window.document;

	const article = document.querySelector("[data-article-body]");
	assert(article, "the fixture must render an article body");
	let bottom = options.articleBottom;
	article.getBoundingClientRect = () => ({
		top: ARTICLE_TOP,
		bottom,
		left: 0,
		right: 0,
		width: 0,
		height: bottom,
		x: 0,
		y: ARTICLE_TOP,
		toJSON: () => ({}),
	});

	const scrollListeners: (() => void)[] = [];
	const swapListeners: (() => void)[] = [];

	const controller = initNextRead({
		document,
		viewportHeight: () => 800,
		addScrollListener: (listener) => scrollListeners.push(listener),
		removeScrollListener: (listener) => {
			scrollListeners.splice(scrollListeners.indexOf(listener), 1);
		},
		addSwapListener: (listener) => swapListeners.push(listener),
		removeSwapListener: (listener) => {
			swapListeners.splice(swapListeners.indexOf(listener), 1);
		},
	});

	function wrapClasses() {
		const wrap = document.querySelector("[data-next-read]");
		assert(wrap, "the fixture must render the next-read slot");
		return wrap.classList;
	}

	return {
		controller,
		document,
		wrapClasses,
		scrollListeners,
		swapListeners,
		scrollTo: (nextBottom: number) => {
			bottom = nextBottom;
			for (const listener of scrollListeners) listener();
		},
		swap: () => {
			for (const listener of swapListeners) listener();
		},
	};
}

describe("initNextRead", () => {
	it("keeps the suggestion out of the way until the reader reaches the end of the article", () => {
		const harness = setup({ stateClass: "next-read--ready", articleBottom: 5000 });

		harness.controller.attach();

		expect(harness.wrapClasses().contains("next-read--open")).toBe(false);
	});

	it("reveals the suggestion once the end of the article is on screen", () => {
		const harness = setup({ stateClass: "next-read--ready", articleBottom: 5000 });
		harness.controller.attach();

		harness.scrollTo(780);

		expect(harness.wrapClasses().contains("next-read--open")).toBe(true);
	});

	it("reveals immediately when the article already ends within the viewport", () => {
		const harness = setup({ stateClass: "next-read--ready", articleBottom: 400 });

		harness.controller.attach();

		expect(harness.wrapClasses().contains("next-read--open")).toBe(true);
	});

	it("stays shut for a slot with nothing to suggest, however far the reader scrolls", () => {
		const harness = setup({ stateClass: "next-read--hidden", articleBottom: 5000 });
		harness.controller.attach();

		harness.scrollTo(780);

		expect(harness.wrapClasses().contains("next-read--open")).toBe(false);
	});

	it("reveals a suggestion that arrives by poll after the reader already reached the end", () => {
		const harness = setup({ stateClass: "next-read--hidden", articleBottom: 400 });
		harness.controller.attach();

		const wrap = harness.document.querySelector("[data-next-read]");
		assert(wrap, "the fixture must render the next-read slot");
		wrap.classList.remove("next-read--hidden");
		wrap.classList.add("next-read--ready");
		harness.swap();

		expect(harness.wrapClasses().contains("next-read--open")).toBe(true);
	});

	it("does nothing on a page with no next-read slot", () => {
		const dom = new JSDOM("<!doctype html><html><body></body></html>");
		const controller = initNextRead({
			document: dom.window.document,
			viewportHeight: () => 800,
			addScrollListener: () => {},
			removeScrollListener: () => {},
			addSwapListener: () => {},
			removeSwapListener: () => {},
		});

		expect(() => controller.attach()).not.toThrow();
	});

	it("does nothing on a page whose article body was swapped away", () => {
		const harness = setup({ stateClass: "next-read--ready", articleBottom: 400 });
		const article = harness.document.querySelector("[data-article-body]");
		assert(article, "the fixture must render an article body");
		article.remove();

		harness.controller.attach();

		expect(harness.wrapClasses().contains("next-read--open")).toBe(false);
	});

	it("attaches once, so a second attach does not stack listeners", () => {
		const harness = setup({ stateClass: "next-read--ready", articleBottom: 5000 });

		harness.controller.attach();
		harness.controller.attach();

		expect(harness.scrollListeners.length).toBe(1);
		expect(harness.swapListeners.length).toBe(1);
	});

	it("stops listening once detached", () => {
		const harness = setup({ stateClass: "next-read--ready", articleBottom: 5000 });
		harness.controller.attach();

		harness.controller.detach();

		expect(harness.scrollListeners.length).toBe(0);
		expect(harness.swapListeners.length).toBe(0);
	});

	it("detaching before attaching leaves nothing to clean up", () => {
		const harness = setup({ stateClass: "next-read--ready", articleBottom: 5000 });

		harness.controller.detach();

		expect(harness.scrollListeners.length).toBe(0);
	});
});
