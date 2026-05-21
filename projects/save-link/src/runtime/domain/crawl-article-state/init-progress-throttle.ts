import type { HutchLogger } from "@packages/hutch-logger";
import type { MarkCrawlProgress } from "../../providers/article-crawl/mark-crawl-progress";

interface PendingProgress {
	partCurrent: number;
	partTotal: number;
	lastWrittenCurrent: number | undefined;
	lastWriteAtMs: number;
}

export interface ProgressThrottle {
	report: (params: {
		url: string;
		partCurrent: number;
		partTotal: number;
	}) => void;
	flush: (params: { url: string }) => Promise<void>;
}

/**
 * Collapses a per-chunk progress firehose down to ~1 DynamoDB write per
 * `intervalMs`. The OCR fan-out can fire 5-10 progress events per second per
 * article in the worst case, but the UI polls at 3s — anything faster than
 * that is wasted I/O.
 *
 * Synchronous "should I write now?" check rather than setTimeout-based
 * debouncing: Lambda freezes between invocations, so a deferred timer either
 * never fires or fires on an unrelated future invocation. An explicit
 * `flush` after the fan-out returns guarantees the terminal value lands.
 */
export function initProgressThrottle(deps: {
	markCrawlProgress: MarkCrawlProgress;
	intervalMs: number;
	now: () => number;
	logger: HutchLogger;
}): ProgressThrottle {
	const { markCrawlProgress, intervalMs, now, logger } = deps;
	const pending = new Map<string, PendingProgress>();

	const writeNow = async (
		url: string,
		entry: PendingProgress,
	): Promise<void> => {
		const writtenCurrent = entry.partCurrent;
		entry.lastWriteAtMs = now();
		try {
			await markCrawlProgress({
				url,
				partCurrent: writtenCurrent,
				partTotal: entry.partTotal,
			});
			entry.lastWrittenCurrent = writtenCurrent;
		} catch (error) {
			logger.warn("[progress-throttle] write failed", {
				url,
				error: String(error),
			});
		}
	};

	const report: ProgressThrottle["report"] = ({
		url,
		partCurrent,
		partTotal,
	}) => {
		const existing = pending.get(url);
		const nowMs = now();
		if (!existing) {
			const entry: PendingProgress = {
				partCurrent,
				partTotal,
				lastWrittenCurrent: undefined,
				lastWriteAtMs: nowMs,
			};
			pending.set(url, entry);
			void writeNow(url, entry);
			return;
		}
		existing.partCurrent = partCurrent;
		existing.partTotal = partTotal;
		if (nowMs - existing.lastWriteAtMs >= intervalMs) {
			void writeNow(url, existing);
		}
	};

	const flush: ProgressThrottle["flush"] = async ({ url }) => {
		const existing = pending.get(url);
		if (!existing) return;
		if (existing.lastWrittenCurrent === existing.partCurrent) return;
		await writeNow(url, existing);
	};

	return { report, flush };
}
