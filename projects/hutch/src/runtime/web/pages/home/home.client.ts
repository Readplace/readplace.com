/**
 * Client-side enhancements for the home page hero.
 *
 * Two behaviours htmx cannot express, so they ship as a bundled browser
 * IIFE referenced via a same-origin `<script src>` (see the web skill's
 * "Browser JS Is Bundled and Served Same-Origin"):
 *
 *   - the headline word rotator that cross-fades through the synonym list
 *     while keeping the rotator box sized to the current word, and
 *   - the smooth scroll the hero's "keep scrolling" hint performs to the
 *     backstory anchor, offset by the sticky header height.
 *
 * Both honour `prefers-reduced-motion: reduce`: the rotator settles on the
 * first word and the hint falls back to the browser's native anchor jump.
 */

export const HEADLINE_WORDS = [
	"articles",
	"news",
	"blogs",
	"stories",
	"newsletters",
	"posts",
	"reports",
	"interviews",
	"essays",
	"longreads",
];

const ROTATE_INTERVAL_MS = 2500;
const FADE_IN_DELAY_MS = 150;
const SWAP_SETTLE_MS = 700;
const SCROLL_DURATION_MS = 350;

const SLOGAN_INTERVAL_MS = 4000;
const SLOGAN_FADE_MS = 300;

interface SloganRotatorDeps {
	document: Document;
	prefersReducedMotion: () => boolean;
	setTimeoutFn: (cb: () => void, ms: number) => unknown;
	clearTimeoutFn: (id: unknown) => void;
	addVisibilityListener: (listener: () => void) => void;
	isHidden: () => boolean;
}

function parseSlogans(raw: string | null): string[] {
	if (raw === null) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
	} catch {
		/** A malformed attribute leaves the server-rendered slogan in place
		 * rather than blanking the page's main heading. */
		return [];
	}
}

/**
 * Cycles the hero slogan through the server-published list.
 *
 * The server renders the canonical slogan as the heading's own text, so a
 * crawler, a reader with JavaScript off, and a reader who asked for reduced
 * motion all keep the one slogan the page's title and structured data claim.
 * The list rides `data-slogans` so this module holds no second copy to drift.
 */
export function initSloganRotator(deps: SloganRotatorDeps): void {
	const found = deps.document.querySelector<HTMLElement>("[data-slogans]");
	if (found === null) return;
	const heading = found; // TS doesn't propagate narrowing into function-declaration closures
	const slogans = parseSlogans(heading.getAttribute("data-slogans"));
	if (slogans.length < 2) return;
	if (deps.prefersReducedMotion()) return;

	heading.classList.add("home-try__title--rotating");

	let index = slogans.indexOf(heading.textContent?.trim() ?? "");
	if (index < 0) index = 0;
	let scheduled: unknown = null;
	let inTick = false;

	function schedule(): void {
		scheduled = deps.setTimeoutFn(tick, SLOGAN_INTERVAL_MS);
	}

	function tick(): void {
		scheduled = null;
		inTick = true;
		index = (index + 1) % slogans.length;
		heading.classList.add("home-try__title--fading");
		deps.setTimeoutFn(() => {
			heading.textContent = slogans[index];
			heading.classList.remove("home-try__title--fading");
			inTick = false;
			schedule();
		}, SLOGAN_FADE_MS);
	}

	deps.addVisibilityListener(() => {
		if (deps.isHidden()) {
			if (scheduled !== null) {
				deps.clearTimeoutFn(scheduled);
				scheduled = null;
			}
		} else if (scheduled === null && !inTick) {
			schedule();
		}
	});
	schedule();
}

interface HeadlineRotatorDeps {
	document: Document;
	prefersReducedMotion: () => boolean;
	setTimeoutFn: (cb: () => void, ms: number) => unknown;
	clearTimeoutFn: (id: unknown) => void;
	addVisibilityListener: (listener: () => void) => void;
	isHidden: () => boolean;
}

function makeSpan(doc: Document, className: string, text: string): HTMLElement {
	const el = doc.createElement("span");
	el.className = className;
	el.textContent = text;
	return el;
}

export function initHeadlineRotator(deps: HeadlineRotatorDeps): void {
	const box = deps.document.querySelector<HTMLElement>(".hero-headline__rotator");
	if (box === null) return;
	const rotator = box; // TS doesn't propagate narrowing into function-declaration closures

	rotator.textContent = "";
	const measurer = makeSpan(deps.document, "hero-headline__measurer", "");
	const slots = [
		makeSpan(deps.document, "hero-headline__word hero-headline__word--visible", HEADLINE_WORDS[0]),
		makeSpan(deps.document, "hero-headline__word", ""),
	];
	rotator.appendChild(makeSpan(deps.document, "hero-headline__sizer", HEADLINE_WORDS[0]));
	rotator.appendChild(measurer);
	rotator.appendChild(slots[0]);
	rotator.appendChild(slots[1]);
	rotator.classList.add("hero-headline__rotator--enhanced");

	function measure(text: string): number {
		measurer.textContent = text;
		return measurer.offsetWidth;
	}

	rotator.style.width = `${measure(HEADLINE_WORDS[0])}px`;
	if (deps.prefersReducedMotion()) return;

	let index = 0;
	let current = 0;
	let scheduled: unknown = null;
	let inTick = false;

	function tick(): void {
		scheduled = null;
		inTick = true;
		const nextIndex = (index + 1) % HEADLINE_WORDS.length;
		const next = 1 - current;
		slots[next].textContent = HEADLINE_WORDS[nextIndex];
		rotator.style.width = `${measure(HEADLINE_WORDS[nextIndex])}px`;
		slots[current].classList.remove("hero-headline__word--visible");
		slots[current].classList.add("hero-headline__word--leaving");
		deps.setTimeoutFn(() => {
			slots[next].classList.add("hero-headline__word--visible");
		}, FADE_IN_DELAY_MS);
		deps.setTimeoutFn(() => {
			slots[current].classList.remove("hero-headline__word--leaving");
			current = next;
			index = nextIndex;
			inTick = false;
			schedule();
		}, SWAP_SETTLE_MS);
	}

	function schedule(): void {
		scheduled = deps.setTimeoutFn(tick, ROTATE_INTERVAL_MS);
	}

	deps.addVisibilityListener(() => {
		if (deps.isHidden()) {
			if (scheduled !== null) {
				deps.clearTimeoutFn(scheduled);
				scheduled = null;
			}
		} else if (scheduled === null && !inTick) {
			schedule();
		}
	});
	schedule();
}

interface ScrollHintDeps {
	document: Document;
	prefersReducedMotion: () => boolean;
	scrollTo: (y: number) => void;
	pageYOffset: () => number;
	now: () => number;
	requestAnimationFrame: (cb: (now: number) => void) => void;
	computedHeaderTop: (header: Element) => number;
}

export function initScrollHint(deps: ScrollHintDeps): void {
	if (deps.prefersReducedMotion()) return;
	const hint = deps.document.querySelector(".home-try__scroll-hint");
	if (hint === null) return;
	const header = deps.document.querySelector(".header");
	if (header === null) return;

	hint.addEventListener("click", (event) => {
		const href = hint.getAttribute("href");
		if (href === null) return;
		const target = deps.document.getElementById(href.slice(1));
		if (target === null) return;
		event.preventDefault();
		const navOffset = header.getBoundingClientRect().height + deps.computedHeaderTop(header);
		const startY = deps.pageYOffset();
		const endY = target.getBoundingClientRect().top + startY - navOffset;
		const startTime = deps.now();
		const step = (frameNow: number): void => {
			const t = Math.min((frameNow - startTime) / SCROLL_DURATION_MS, 1);
			deps.scrollTo(startY + (endY - startY) * (1 - (1 - t) ** 3));
			if (t < 1) deps.requestAnimationFrame(step);
		};
		deps.requestAnimationFrame(step);
	});
}
