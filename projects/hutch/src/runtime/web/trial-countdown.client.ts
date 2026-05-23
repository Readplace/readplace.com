import {
	deriveTrialEscalation,
	formatTrialDisplay,
	formatTrialRemaining,
	type TrialDisplay,
	type TrialEscalation,
} from "./trial-countdown.format";

interface TrialCountdownDeps {
	document: Document;
	now: () => number;
	setIntervalFn: (cb: () => void, ms: number) => number;
	clearIntervalFn: (id: number) => void;
	addSwapListener: (cb: () => void) => void;
}

interface TrialCountdownController {
	attach(): void;
	stop(): void;
}

const SELECTOR = "[data-test-trial-countdown]";
const TICK_INTERVAL_MS = 1000;
const ESCALATIONS: readonly TrialEscalation[] = [
	"soft",
	"moderate",
	"urgent",
	"critical",
];

function assert(cond: unknown, message: string): asserts cond {
	if (!cond) throw new Error(message);
}

function readSkewMs(deps: TrialCountdownDeps, el: Element): number {
	const serverNowIso = el.getAttribute("data-server-now-iso");
	if (serverNowIso === null || serverNowIso === "") return 0;
	const serverNowMs = Date.parse(serverNowIso);
	if (!Number.isFinite(serverNowMs)) return 0;
	return serverNowMs - deps.now();
}

function setEscalationClass(el: Element, escalation: TrialEscalation | "expired"): void {
	for (const e of ESCALATIONS) {
		el.classList.remove(`trial-countdown--${e}`);
	}
	el.classList.remove("trial-countdown--expired");
	el.classList.add(`trial-countdown--${escalation}`);
}

export function initTrialCountdown(
	deps: TrialCountdownDeps,
): TrialCountdownController {
	const root = deps.document.querySelector(SELECTOR);
	if (!root) return { attach() {}, stop() {} };
	const el: Element = root;

	const endsAtIso = el.getAttribute("data-trial-ends-at-iso");
	assert(endsAtIso, `${SELECTOR} must carry data-trial-ends-at-iso`);
	const skewMs = readSkewMs(deps, el);

	let intervalId: number | undefined;
	let expired = el.getAttribute("data-trial-state") === "expired";

	function tick(): void {
		const skewedNow = new Date(deps.now() + skewMs);
		const remaining = formatTrialRemaining(endsAtIso ?? "", skewedNow);
		if (remaining.totalMs <= 0) {
			if (!expired) {
				const display: TrialDisplay = { state: "expired" };
				el.textContent = formatTrialDisplay(display);
				el.setAttribute("data-trial-state", "expired");
				el.setAttribute("aria-live", "polite");
				setEscalationClass(el, "expired");
				expired = true;
			}
			if (intervalId !== undefined) {
				deps.clearIntervalFn(intervalId);
				intervalId = undefined;
			}
			return;
		}
		const escalation = deriveTrialEscalation(remaining);
		const display: TrialDisplay = {
			state: "active",
			endsAtIso: endsAtIso ?? "",
			serverNowIso: skewedNow.toISOString(),
			remaining,
			escalation,
		};
		el.textContent = formatTrialDisplay(display);
		setEscalationClass(el, escalation);
	}

	function startInterval(): void {
		if (intervalId !== undefined) return;
		if (expired) return;
		intervalId = deps.setIntervalFn(tick, TICK_INTERVAL_MS);
	}

	function stopInterval(): void {
		if (intervalId === undefined) return;
		deps.clearIntervalFn(intervalId);
		intervalId = undefined;
	}

	function onVisibilityChange(): void {
		if (deps.document.hidden) {
			stopInterval();
			return;
		}
		tick();
		startInterval();
	}

	function attach(): void {
		tick();
		startInterval();
		deps.document.addEventListener("visibilitychange", onVisibilityChange);
		deps.addSwapListener(() => {
			tick();
		});
	}

	function stop(): void {
		stopInterval();
		deps.document.removeEventListener("visibilitychange", onVisibilityChange);
	}

	return { attach, stop };
}
