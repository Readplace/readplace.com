import type { ScreenResponsePhases, ScreenResponseSample } from "./screen-response-latency";
import type { ElementCondition, ScreenResponsePredicate } from "./screen-response-ops";

export interface ScreenResponseArm {
	trigger: string;
	predicate: ScreenResponsePredicate;
}

export interface ScreenResponseProbeKeys {
	armKey: string;
	pendingKey: string;
	offClockSelector: string;
}

declare global {
	interface Window {
		readplaceScreenResponse?: ScreenResponseSample;
	}
}

export function installScreenResponseProbe(keys: ScreenResponseProbeKeys): void {
	const documentId = `${performance.timeOrigin}:${Math.random()}`;
	const nowAbsMs = () => performance.timeOrigin + performance.now();

	interface Pending {
		clickAbsMs: number;
		documentId: string;
		predicate: ScreenResponsePredicate;
		phases: ScreenResponsePhases;
		historyCacheHit: boolean;
	}

	let pending: Pending | null = null;

	function savePending(state: Pending): void {
		window.sessionStorage.setItem(keys.pendingKey, JSON.stringify(state));
	}

	function matches(condition: ElementCondition): boolean {
		const element = document.querySelector(condition.selector);
		if (element === null) return false;
		if (!condition.laidOut) return true;
		return element.getBoundingClientRect().height > 0;
	}

	function satisfiedBy(predicate: ScreenResponsePredicate): string | null {
		for (const condition of predicate.required) {
			if (!matches(condition)) return null;
		}
		for (const condition of predicate.oneOf) {
			if (matches(condition)) return condition.selector;
		}
		return null;
	}

	function documentHop(): {
		responseStartMs: number;
		activationStartMs?: number;
		fcpMs?: number;
	} {
		const [entry] = performance.getEntriesByType("navigation");
		if (!(entry instanceof PerformanceNavigationTiming)) {
			throw new Error("a cross-document response must expose a navigation timing entry");
		}
		const paint = performance
			.getEntriesByType("paint")
			.find((candidate) => candidate.name === "first-contentful-paint");
		const contentful = paint === undefined ? {} : { fcpMs: paint.startTime };
		const prerender = Reflect.get(entry, "activationStart");
		const activation = typeof prerender === "number" ? { activationStartMs: prerender } : {};
		return { responseStartMs: entry.responseStart, ...activation, ...contentful };
	}

	function record(state: Pending, matchedOneOf: string): void {
		window.sessionStorage.removeItem(keys.pendingKey);
		window.sessionStorage.removeItem(keys.armKey);
		pending = null;
		const common = {
			elapsedMs: nowAbsMs() - state.clickAbsMs,
			matchedOneOf,
			historyCacheHit: state.historyCacheHit,
			phases: state.phases,
		};
		window.readplaceScreenResponse =
			state.documentId === documentId
				? { ...common, sameDocument: true }
				: { ...common, sameDocument: false, ...documentHop() };
	}

	function check(): void {
		const state = pending;
		if (state === null) return;
		const matchedOneOf = satisfiedBy(state.predicate);
		if (matchedOneOf === null) return;
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				if (pending !== state) return;
				record(state, matchedOneOf);
			});
		});
	}

	function stampPhase(phase: keyof ScreenResponsePhases, event: Event): void {
		const state = pending;
		if (state === null) return;
		if (state.phases[phase] !== undefined) return;
		/** The queue's counts span fires its own request on load, inside the
		 * measurement window; without this its beforeRequest/afterSwap would be
		 * recorded as the navigation's own phases, and a stale settle from the
		 * previous sample would land in the next one. */
		const source = event.target;
		if (source instanceof Element && source.closest(keys.offClockSelector) !== null) return;
		state.phases[phase] = nowAbsMs() - state.clickAbsMs;
		savePending(state);
	}

	new MutationObserver(check).observe(document, {
		attributes: true,
		childList: true,
		subtree: true,
	});

	document.addEventListener("htmx:beforeRequest", (event) =>
		stampPhase("beforeRequestMs", event),
	);
	document.addEventListener("htmx:afterSwap", (event) => stampPhase("afterSwapMs", event));
	document.addEventListener("htmx:afterSettle", (event) => {
		stampPhase("afterSettleMs", event);
		check();
	});
	document.addEventListener("htmx:historyCacheHit", () => {
		const state = pending;
		if (state === null) return;
		state.historyCacheHit = true;
		savePending(state);
	});

	const carried = window.sessionStorage.getItem(keys.pendingKey);
	if (carried !== null) {
		pending = JSON.parse(carried);
		check();
	}

	document.addEventListener(
		"click",
		(event) => {
			if (pending !== null) return;
			const raw = window.sessionStorage.getItem(keys.armKey);
			if (raw === null) return;
			const arm: ScreenResponseArm = JSON.parse(raw);
			const target = event.target;
			if (!(target instanceof Element)) return;
			if (target.closest(arm.trigger) === null) return;
			const started: Pending = {
				clickAbsMs: performance.timeOrigin + event.timeStamp,
				documentId,
				predicate: arm.predicate,
				phases: {},
				historyCacheHit: false,
			};
			savePending(started);
			pending = started;
			check();
		},
		true,
	);
}
