import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { initHeadlineRotator, initScrollHint } from "./home.client";

function makeWindow(html: string): JSDOM["window"] {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window;
}

function clickEvent(window: JSDOM["window"]): Event {
	return new window.Event("click", { cancelable: true });
}

interface FakeTimer {
	id: number;
	cb: () => void;
	delay: number;
}

function createFakeTimers() {
	const timers: FakeTimer[] = [];
	let nextId = 1;
	const setTimeoutFn = (cb: () => void, delay: number): unknown => {
		const id = nextId++;
		timers.push({ id, cb, delay });
		return id;
	};
	const clearTimeoutFn = (id: unknown): void => {
		const idx = timers.findIndex((t) => t.id === id);
		if (idx !== -1) timers.splice(idx, 1);
	};
	const runOnce = (): void => {
		const next = timers.shift();
		assert(next, "a timer must be pending");
		next.cb();
	};
	const pendingCount = (): number => timers.length;
	return { setTimeoutFn, clearTimeoutFn, runOnce, pendingCount };
}

const ROTATOR_HTML = `<h2><span class="hero-headline__rotator">articles</span></h2>`;

describe("initHeadlineRotator", () => {
	it("is a no-op when no .hero-headline__rotator element is present", () => {
		const doc = makeWindow(`<h2>No rotator here</h2>`).document;
		const timers = createFakeTimers();
		let visibilityListener: (() => void) | undefined;
		initHeadlineRotator({
			document: doc,
			prefersReducedMotion: () => false,
			setTimeoutFn: timers.setTimeoutFn,
			clearTimeoutFn: timers.clearTimeoutFn,
			addVisibilityListener: (cb) => {
				visibilityListener = cb;
			},
			isHidden: () => false,
		});
		assert.equal(timers.pendingCount(), 0);
		assert.equal(visibilityListener, undefined);
	});

	it("enhances the rotator and settles on the first word when reduced motion is preferred", () => {
		const doc = makeWindow(ROTATOR_HTML).document;
		const timers = createFakeTimers();
		initHeadlineRotator({
			document: doc,
			prefersReducedMotion: () => true,
			setTimeoutFn: timers.setTimeoutFn,
			clearTimeoutFn: timers.clearTimeoutFn,
			addVisibilityListener: () => {},
			isHidden: () => false,
		});

		const rotator = doc.querySelector(".hero-headline__rotator");
		assert(rotator, "rotator must remain in the DOM");
		assert.equal(rotator.classList.contains("hero-headline__rotator--enhanced"), true);
		const visible = rotator.querySelector(".hero-headline__word--visible");
		assert(visible, "first word slot must be visible");
		assert.equal(visible.textContent, "articles");
		assert.equal(timers.pendingCount(), 0);
	});

	it("rotates to the next word on tick and re-schedules", () => {
		const doc = makeWindow(ROTATOR_HTML).document;
		const timers = createFakeTimers();
		initHeadlineRotator({
			document: doc,
			prefersReducedMotion: () => false,
			setTimeoutFn: timers.setTimeoutFn,
			clearTimeoutFn: timers.clearTimeoutFn,
			addVisibilityListener: () => {},
			isHidden: () => false,
		});

		assert.equal(timers.pendingCount(), 1);
		// Run the scheduled tick, then both swap timers it queues, then the
		// re-scheduled tick so the rotation comes back to rest.
		timers.runOnce();
		timers.runOnce();
		timers.runOnce();

		const rotator = doc.querySelector(".hero-headline__rotator");
		assert(rotator, "rotator must remain in the DOM");
		const words = Array.from(rotator.querySelectorAll(".hero-headline__word")).map(
			(el) => el.textContent,
		);
		assert.equal(words.includes("news"), true);
	});

	it("pauses the rotation when the page becomes hidden and resumes when visible", () => {
		const doc = makeWindow(ROTATOR_HTML).document;
		const timers = createFakeTimers();
		let visibilityListener: (() => void) | undefined;
		let hidden = false;
		initHeadlineRotator({
			document: doc,
			prefersReducedMotion: () => false,
			setTimeoutFn: timers.setTimeoutFn,
			clearTimeoutFn: timers.clearTimeoutFn,
			addVisibilityListener: (cb) => {
				visibilityListener = cb;
			},
			isHidden: () => hidden,
		});
		assert(visibilityListener, "a visibility listener must be registered");
		assert.equal(timers.pendingCount(), 1);

		hidden = true;
		visibilityListener();
		assert.equal(timers.pendingCount(), 0);

		// A second hidden event with nothing scheduled is a harmless no-op.
		visibilityListener();
		assert.equal(timers.pendingCount(), 0);

		hidden = false;
		visibilityListener();
		assert.equal(timers.pendingCount(), 1);
	});

	it("does not re-schedule on a visible event while a rotation is mid-flight", () => {
		const doc = makeWindow(ROTATOR_HTML).document;
		const timers = createFakeTimers();
		let visibilityListener: (() => void) | undefined;
		initHeadlineRotator({
			document: doc,
			prefersReducedMotion: () => false,
			setTimeoutFn: timers.setTimeoutFn,
			clearTimeoutFn: timers.clearTimeoutFn,
			addVisibilityListener: (cb) => {
				visibilityListener = cb;
			},
			isHidden: () => false,
		});
		assert(visibilityListener, "a visibility listener must be registered");

		// Run the initial scheduled tick, then run only the fade-in timer so the
		// settle timer is still pending and `inTick` remains true.
		timers.runOnce();
		timers.runOnce();
		assert.equal(timers.pendingCount(), 1);

		visibilityListener();
		assert.equal(timers.pendingCount(), 1);
	});
});

const SCROLL_HTML = `
	<header class="header"></header>
	<a class="home-try__scroll-hint" href="#about">scroll</a>
	<section id="about">About</section>
`;

function createFakeRaf() {
	const callbacks: Array<(now: number) => void> = [];
	const requestAnimationFrame = (cb: (now: number) => void): void => {
		callbacks.push(cb);
	};
	const flush = (now: number): void => {
		const cb = callbacks.shift();
		assert(cb, "a rAF callback must be pending");
		cb(now);
	};
	const pending = (): number => callbacks.length;
	return { requestAnimationFrame, flush, pending };
}

describe("initScrollHint", () => {
	it("is a no-op when reduced motion is preferred (native anchor jump)", () => {
		const window = makeWindow(SCROLL_HTML);
		const raf = createFakeRaf();
		initScrollHint({
			document: window.document,
			prefersReducedMotion: () => true,
			scrollTo: () => {},
			pageYOffset: () => 0,
			now: () => 0,
			requestAnimationFrame: raf.requestAnimationFrame,
			computedHeaderTop: () => 0,
		});

		const hint = window.document.querySelector(".home-try__scroll-hint");
		assert(hint, "hint must be present");
		hint.dispatchEvent(clickEvent(window));
		assert.equal(raf.pending(), 0);
	});

	it("is a no-op when the scroll hint is absent", () => {
		const window = makeWindow(`<header class="header"></header>`);
		const raf = createFakeRaf();
		initScrollHint({
			document: window.document,
			prefersReducedMotion: () => false,
			scrollTo: () => {},
			pageYOffset: () => 0,
			now: () => 0,
			requestAnimationFrame: raf.requestAnimationFrame,
			computedHeaderTop: () => 0,
		});
		assert.equal(raf.pending(), 0);
	});

	it("is a no-op when the sticky header is absent", () => {
		const window = makeWindow(`<a class="home-try__scroll-hint" href="#about">scroll</a>`);
		const raf = createFakeRaf();
		initScrollHint({
			document: window.document,
			prefersReducedMotion: () => false,
			scrollTo: () => {},
			pageYOffset: () => 0,
			now: () => 0,
			requestAnimationFrame: raf.requestAnimationFrame,
			computedHeaderTop: () => 0,
		});
		const hint = window.document.querySelector(".home-try__scroll-hint");
		assert(hint, "hint must be present");
		hint.dispatchEvent(clickEvent(window));
		assert.equal(raf.pending(), 0);
	});

	it("leaves the native anchor jump intact when the hint has no href", () => {
		const window = makeWindow(`
			<header class="header"></header>
			<a class="home-try__scroll-hint">scroll</a>
		`);
		const raf = createFakeRaf();
		const scrolledTo: number[] = [];
		initScrollHint({
			document: window.document,
			prefersReducedMotion: () => false,
			scrollTo: (y) => {
				scrolledTo.push(y);
			},
			pageYOffset: () => 0,
			now: () => 0,
			requestAnimationFrame: raf.requestAnimationFrame,
			computedHeaderTop: () => 0,
		});
		const hint = window.document.querySelector(".home-try__scroll-hint");
		assert(hint, "hint must be present");
		const event = clickEvent(window);
		hint.dispatchEvent(event);
		assert.equal(event.defaultPrevented, false);
		assert.equal(scrolledTo.length, 0);
		assert.equal(raf.pending(), 0);
	});

	it("leaves the native anchor jump intact when the target anchor is missing", () => {
		const window = makeWindow(`
			<header class="header"></header>
			<a class="home-try__scroll-hint" href="#nowhere">scroll</a>
		`);
		const raf = createFakeRaf();
		const scrolledTo: number[] = [];
		initScrollHint({
			document: window.document,
			prefersReducedMotion: () => false,
			scrollTo: (y) => {
				scrolledTo.push(y);
			},
			pageYOffset: () => 0,
			now: () => 0,
			requestAnimationFrame: raf.requestAnimationFrame,
			computedHeaderTop: () => 0,
		});
		const hint = window.document.querySelector(".home-try__scroll-hint");
		assert(hint, "hint must be present");
		const event = clickEvent(window);
		hint.dispatchEvent(event);
		assert.equal(event.defaultPrevented, false);
		assert.equal(scrolledTo.length, 0);
		assert.equal(raf.pending(), 0);
	});

	it("smooth-scrolls to the anchor target, stepping until the animation completes", () => {
		const window = makeWindow(SCROLL_HTML);
		const raf = createFakeRaf();
		const scrolledTo: number[] = [];
		let nowMs = 1000;
		initScrollHint({
			document: window.document,
			prefersReducedMotion: () => false,
			scrollTo: (y) => {
				scrolledTo.push(y);
			},
			pageYOffset: () => 0,
			now: () => nowMs,
			requestAnimationFrame: raf.requestAnimationFrame,
			computedHeaderTop: () => 0,
		});

		const hint = window.document.querySelector(".home-try__scroll-hint");
		assert(hint, "hint must be present");
		const event = clickEvent(window);
		hint.dispatchEvent(event);
		assert.equal(event.defaultPrevented, true);
		assert.equal(raf.pending(), 1);

		// Mid-flight frame: t < 1, schedules another frame.
		nowMs = 1100;
		raf.flush(1100);
		assert.equal(raf.pending(), 1);

		// Final frame: t >= 1, no further frames scheduled.
		raf.flush(1500);
		assert.equal(raf.pending(), 0);
		assert.equal(scrolledTo.length, 2);
	});
});
