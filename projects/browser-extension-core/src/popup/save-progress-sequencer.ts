import type { SavePhase } from "./save-progress";

export type Scheduler = {
	setTimer: (callback: () => void, delayMs: number) => void;
	now: () => number;
};

export type SaveProgressSequencer = {
	enqueue: (phase: SavePhase) => void;
	finish: () => Promise<void>;
};

/**
 * Save milestones can arrive faster than a render frame: a small page serialises
 * in under a millisecond, so the background crosses "capturing" → "uploading"
 * almost instantly. Applied straight to the DOM, "Reading page…" is overwritten
 * by "Saving…" before it ever paints. This sequencer holds each phase on screen
 * for at least `minDwellMs` before the next is applied, queueing rapid
 * transitions in order so no milestone is skipped.
 */
export function initSaveProgressSequencer(deps: {
	apply: (phase: SavePhase) => void;
	scheduler: Scheduler;
	minDwellMs: number;
}): SaveProgressSequencer {
	const { apply, scheduler, minDwellMs } = deps;
	const queue: SavePhase[] = [];
	const finishResolvers: Array<() => void> = [];
	// Negative infinity means no phase has been shown yet, so the first enqueue
	// applies immediately (its remaining dwell is always negative).
	let appliedAt = Number.NEGATIVE_INFINITY;
	let timerPending = false;

	function applyHead(phase: SavePhase): void {
		queue.shift();
		apply(phase);
		appliedAt = scheduler.now();
	}

	function scheduleNext(): void {
		const phase = queue[0];
		if (phase === undefined) {
			finishResolvers.splice(0).forEach((resolve) => {
				resolve();
			});
			return;
		}
		const remaining = minDwellMs - (scheduler.now() - appliedAt);
		if (remaining <= 0) {
			applyHead(phase);
			scheduleNext();
			return;
		}
		timerPending = true;
		scheduler.setTimer(() => {
			timerPending = false;
			applyHead(phase);
			scheduleNext();
		}, remaining);
	}

	return {
		enqueue(phase: SavePhase): void {
			queue.push(phase);
			if (!timerPending) scheduleNext();
		},
		finish(): Promise<void> {
			if (queue.length === 0) return Promise.resolve();
			return new Promise<void>((resolve) => {
				finishResolvers.push(resolve);
			});
		},
	};
}
