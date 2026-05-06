/**
 * Client-side animation for the unified article-body progress bar.
 *
 * The bar is a single element with id="article-body-progress" carrying
 *   data-progress-pct      (latest percentage from the server)
 *   data-progress-tick-at  (ISO timestamp of the latest server tick)
 *   data-progress-stage    (stage name; opaque to the bar)
 *
 * The server emits a fresh bar via `hx-swap-oob` on every reader/summary
 * poll response (every 3s). Between swaps the bar would be static; this
 * module records (tickAt, pct) and extrapolates linearly so the fill
 * advances smoothly at the observed rate.
 *
 * One bar covers both the crawl and summary pipelines — see
 * progress-mapping.ts for the unified percentage scale.
 */

export interface BarTick {
	tickAtMs: number;
	pct: number;
}

/**
 * Inline assertion. Cannot use `node:assert` because esbuild bundles this
 * module for the browser and `node:assert` is not resolvable in a browser
 * target.
 */
function assert(cond: unknown, message: string): asserts cond {
	if (!cond) throw new Error(message);
}

/**
 * Linear rate between two ticks, floored at 0 so a regression (worker
 * redelivery) doesn't pull the bar backwards mid-frame.
 */
export function computeRate(prev: BarTick, next: BarTick): number {
	const dt = next.tickAtMs - prev.tickAtMs;
	if (dt <= 0) return 0;
	const rate = (next.pct - prev.pct) / dt;
	return rate > 0 ? rate : 0;
}

/**
 * Project a percentage forward from the last observed tick, capped so the
 * bar never crowds 100% before the server confirms summary-complete.
 */
export function projectPct(args: {
	lastPct: number;
	rate: number;
	elapsedMs: number;
	cap: number;
}): number {
	const projected = args.lastPct + args.rate * args.elapsedMs;
	if (projected > args.cap) return args.cap;
	if (projected < args.lastPct) return args.lastPct;
	return projected;
}

export interface ProgressBarAttrs {
	pct: number;
	tickAtMs: number | undefined;
}

/**
 * Read the data-progress-* attributes off the bar element. Returns
 * `tickAtMs: undefined` when the SSR fallback used an empty tickAt — in that
 * case the client should not extrapolate, only render the static SSR pct
 * until the first poll lands a real timestamp.
 */
export function readProgressAttrs(
	bar: Element,
): ProgressBarAttrs | undefined {
	const pctRaw = bar.getAttribute("data-progress-pct");
	if (pctRaw === null) return undefined;
	const pct = Number.parseFloat(pctRaw);
	if (!Number.isFinite(pct)) return undefined;
	const tickAtRaw = bar.getAttribute("data-progress-tick-at");
	if (tickAtRaw === null || tickAtRaw === "") {
		return { pct, tickAtMs: undefined };
	}
	const tickAtMs = Date.parse(tickAtRaw);
	if (!Number.isFinite(tickAtMs)) return { pct, tickAtMs: undefined };
	return { pct, tickAtMs };
}

/** Narrow shape of the fill element. Avoids referring to the global
 * `HTMLElement` constructor which is not available in Jest's Node env. */
interface BarFill {
	style: { width: string };
}

interface BarState {
	prev: BarTick | undefined;
	last: BarTick;
	rate: number;
	fill: BarFill;
}

interface ProgressBarDeps {
	document: Document;
	now: () => number;
	requestAnimationFrame: (cb: () => void) => number;
	cancelAnimationFrame: (id: number) => void;
	addSwapListener: (listener: () => void) => void;
}

interface ProgressBarController {
	scan(): void;
	stop(): void;
}

const PROGRESS_CAP = 99;

export function initProgressBars(deps: ProgressBarDeps): ProgressBarController {
	const states = new WeakMap<Element, BarState>();
	const tracked: Element[] = [];
	let rafId: number | undefined;
	let stopped = false;

	function findBars(): Element[] {
		return Array.from(deps.document.querySelectorAll("[data-progress-bar]"));
	}

	function syncBar(bar: Element): void {
		const attrs = readProgressAttrs(bar);
		assert(attrs, "bar must carry data-progress-pct (template invariant)");
		const fill: BarFill | null = bar.querySelector<HTMLElement>(
			":scope > [data-progress-fill]",
		);
		assert(fill, "bar must contain a [data-progress-fill] child");

		const existing = states.get(bar);
		const incomingTickMs = attrs.tickAtMs;

		if (existing === undefined) {
			// First time seeing this bar. Anchor at the SSR-supplied pct. If the
			// server did not emit a real timestamp (empty SSR fallback), anchor
			// against deps.now() so a later real tick still produces a positive
			// elapsed window for computeRate.
			const anchorTickAtMs = incomingTickMs ?? deps.now();
			states.set(bar, {
				prev: undefined,
				last: { pct: attrs.pct, tickAtMs: anchorTickAtMs },
				rate: 0,
				fill,
			});
			tracked.push(bar);
			return;
		}

		// Re-scan saw no real server tick (still on SSR fallback) — leave the
		// existing anchor in place.
		if (incomingTickMs === undefined) return;

		// Same server tick we already absorbed (re-scan without a real swap).
		if (incomingTickMs === existing.last.tickAtMs) return;

		const newTick: BarTick = { pct: attrs.pct, tickAtMs: incomingTickMs };
		states.set(bar, {
			prev: existing.last,
			last: newTick,
			rate: computeRate(existing.last, newTick),
			fill,
		});
	}

	function tick(): void {
		if (stopped) return;
		const now = deps.now();
		// Iterate a stable snapshot — DOM mutations can splice the live list.
		for (let i = tracked.length - 1; i >= 0; i -= 1) {
			const bar = tracked[i];
			if (!bar.isConnected) {
				tracked.splice(i, 1);
				continue;
			}
			const state = states.get(bar);
			assert(state, "tracked bar must have a state entry");
			const elapsed = now - state.last.tickAtMs;
			const projected = projectPct({
				lastPct: state.last.pct,
				rate: state.rate,
				elapsedMs: elapsed,
				cap: PROGRESS_CAP,
			});
			state.fill.style.width = `${projected}%`;
		}
		rafId = deps.requestAnimationFrame(tick);
	}

	function scan(): void {
		const bars = findBars();
		for (const bar of bars) syncBar(bar);
	}

	deps.addSwapListener(scan);
	scan();
	rafId = deps.requestAnimationFrame(tick);

	return {
		scan,
		stop(): void {
			stopped = true;
			if (rafId !== undefined) deps.cancelAnimationFrame(rafId);
		},
	};
}
