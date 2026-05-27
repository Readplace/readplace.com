import type { HutchLogger } from "@packages/hutch-logger";
import type { MarkCrawlPartial } from "../../providers/article-crawl/mark-crawl-partial";

interface PendingPartial {
	html: string;
	lastWrittenLength: number;
	lastWriteAtMs: number;
}

export interface PartialContentThrottle {
	report: (params: { url: string; html: string }) => void;
	flush: (params: { url: string; html?: string }) => Promise<void>;
}

/**
 * Collapses the OCR partial-content firehose to ~1 DynamoDB write per
 * `intervalMs`. The PDF Tesseract path can complete chunks at >5/sec on a
 * dense PDF, but the streaming endpoint polls at 250ms and the human reading
 * speed bottlenecks downstream — anything faster than a write per second is
 * wasted I/O and risks contending with the aggregate's terminal-transition
 * REMOVE clauses.
 *
 * Synchronous "should I write now?" check rather than setTimeout-based
 * debouncing (Lambda freezes between invocations; a deferred timer either
 * never fires or fires on an unrelated future invocation). An explicit
 * `flush` after the fan-out returns guarantees the terminal value lands.
 *
 * Mirrors the shape of `init-progress-throttle.ts` so reviewers and tests can
 * reason about both throttles uniformly.
 */
export function initPartialContentThrottle(deps: {
	markCrawlPartial: MarkCrawlPartial;
	intervalMs: number;
	now: () => number;
	logger: HutchLogger;
}): PartialContentThrottle {
	const { markCrawlPartial, intervalMs, now, logger } = deps;
	const pending = new Map<string, PendingPartial>();

	const writeNow = async (url: string, entry: PendingPartial): Promise<void> => {
		const writtenLength = entry.html.length;
		entry.lastWriteAtMs = now();
		try {
			await markCrawlPartial({ url, content: entry.html });
			entry.lastWrittenLength = writtenLength;
		} catch (error) {
			logger.warn("[partial-content-throttle] write failed", {
				url,
				error: String(error),
			});
		}
	};

	const report: PartialContentThrottle["report"] = ({ url, html }) => {
		const existing = pending.get(url);
		const nowMs = now();
		if (!existing) {
			const entry: PendingPartial = {
				html,
				lastWrittenLength: -1,
				lastWriteAtMs: nowMs,
			};
			pending.set(url, entry);
			void writeNow(url, entry);
			return;
		}
		if (html.length === existing.lastWrittenLength) return;
		existing.html = html;
		if (nowMs - existing.lastWriteAtMs >= intervalMs) {
			void writeNow(url, existing);
		}
	};

	const flush: PartialContentThrottle["flush"] = async ({ url, html }) => {
		const existing = pending.get(url);
		if (html !== undefined && existing) existing.html = html;
		if (!existing) {
			if (html === undefined) return;
			const entry: PendingPartial = {
				html,
				lastWrittenLength: -1,
				lastWriteAtMs: now(),
			};
			pending.set(url, entry);
			await writeNow(url, entry);
			return;
		}
		if (existing.lastWrittenLength === existing.html.length) return;
		await writeNow(url, existing);
	};

	return { report, flush };
}
