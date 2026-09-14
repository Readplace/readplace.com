export const LIST_SKELETON_DELAY_MS = 150;

interface PaintAfterDelayDeps {
	readonly setTimeoutFn: (callback: () => void, ms: number) => number;
	readonly clearTimeoutFn: (id: number) => void;
	readonly delayMs: number;
}

export function initPaintAfterDelay(deps: PaintAfterDelayDeps) {
	return async function paintAfterDelay<T>(input: {
		paint: () => void;
		load: () => Promise<T>;
	}): Promise<T> {
		const timer = deps.setTimeoutFn(input.paint, deps.delayMs);
		try {
			return await input.load();
		} finally {
			deps.clearTimeoutFn(timer);
		}
	};
}
