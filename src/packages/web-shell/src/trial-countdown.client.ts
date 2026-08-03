import {
	deriveTrialEscalation,
	formatCancellationEndsLabel,
	formatTrialDisplay,
	formatTrialRemaining,
} from "./trial-countdown.format";
import type { TrialDisplay, TrialEscalation } from "./trial-countdown.format";

interface TrialCountdownDeps {
	document: Document;
	now: () => number;
	timeZone: () => string;
	setIntervalFn: (cb: () => void, ms: number) => number;
	clearIntervalFn: (id: number) => void;
	addSwapListener: (cb: () => void) => void;
}

interface TrialCountdownController {
	attach(): void;
	stop(): void;
}

const SELECTOR = ".trial-countdown";
const TICK_INTERVAL_MS = 1000;
const ESCALATIONS: readonly TrialEscalation[] = [
	"soft",
	"moderate",
	"urgent",
	"critical",
];

function requiredAttribute(el: Element, name: string): string {
	const value = el.getAttribute(name);
	if (!value) throw new Error(`${SELECTOR} must carry ${name}`);
	return value;
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

	const endsAtIso = requiredAttribute(el, "data-trial-ends-at-iso");
	const skewMs = readSkewMs(deps, el);

	let intervalId: number | undefined;
	let expired = el.getAttribute("data-trial-state") === "expired";
	/** The cancellation-scheduled chip is a static "Ends <date>" label — the user
	 * inside their paid period or trial keeps full access until the date arrives,
	 * after which a fresh server render flips them to inactive/expired. No
	 * per-second tick is meaningful, so it renders once and never ticks. */
	const cancellationScheduled =
		el.getAttribute("data-trial-state") === "cancellation-scheduled";

	function tick(): void {
		const skewedNow = new Date(deps.now() + skewMs);
		const remaining = formatTrialRemaining(endsAtIso, skewedNow);
		if (remaining.totalMs <= 0) {
			if (!expired) {
				const display: TrialDisplay = { state: "expired" };
				el.textContent = formatTrialDisplay(display, deps.timeZone());
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
			endsAtIso,
			serverNowIso: skewedNow.toISOString(),
			remaining,
			escalation,
		};
		el.textContent = formatTrialDisplay(display, deps.timeZone());
		setEscalationClass(el, escalation);
	}

	function renderCancellationScheduled(): void {
		const timeZone = deps.timeZone();
		const display: TrialDisplay = {
			state: "cancellation-scheduled",
			endsAtIso,
			serverNowIso: new Date(deps.now() + skewMs).toISOString(),
		};
		el.textContent = formatTrialDisplay(display, timeZone);
		const label = formatCancellationEndsLabel({
			endsAtIso,
			timeZone,
		});
		el.setAttribute("aria-label", label);
		el.setAttribute("title", label);
	}

	function startInterval(): void {
		if (intervalId !== undefined) return;
		if (expired) return;
		if (cancellationScheduled) return;
		intervalId = deps.setIntervalFn(tick, TICK_INTERVAL_MS);
	}

	function stopInterval(): void {
		if (intervalId === undefined) return;
		deps.clearIntervalFn(intervalId);
		intervalId = undefined;
	}

	function render(): void {
		if (cancellationScheduled) {
			renderCancellationScheduled();
			return;
		}
		tick();
	}

	function onVisibilityChange(): void {
		if (deps.document.hidden) {
			stopInterval();
			return;
		}
		if (cancellationScheduled) return;
		tick();
		startInterval();
	}

	function attach(): void {
		render();
		startInterval();
		deps.document.addEventListener("visibilitychange", onVisibilityChange);
		deps.addSwapListener(render);
	}

	function stop(): void {
		stopInterval();
		deps.document.removeEventListener("visibilitychange", onVisibilityChange);
	}

	return { attach, stop };
}
