import { noopLogger } from "@packages/hutch-logger";
import { initProgressThrottle } from "./init-progress-throttle";
import type { MarkCrawlProgress } from "../../providers/article-crawl/mark-crawl-progress";

type Recorded = { url: string; partCurrent: number; partTotal: number };

function recordWriter(): {
	markCrawlProgress: MarkCrawlProgress;
	calls: Recorded[];
} {
	const calls: Recorded[] = [];
	const markCrawlProgress: MarkCrawlProgress = async (params) => {
		calls.push(params);
	};
	return { markCrawlProgress, calls };
}

const URL = "https://example.com/x.pdf";

describe("initProgressThrottle", () => {
	it("writes the first report immediately so the bar moves as soon as the first part completes", async () => {
		const { markCrawlProgress, calls } = recordWriter();
		const throttle = initProgressThrottle({
			markCrawlProgress,
			intervalMs: 1500,
			now: () => 0,
			logger: noopLogger,
		});

		throttle.report({ url: URL, partCurrent: 1, partTotal: 100 });
		await Promise.resolve();
		await throttle.flush({ url: URL });

		expect(calls).toEqual([{ url: URL, partCurrent: 1, partTotal: 100 }]);
	});

	it("collapses rapid reports inside the throttle window down to a single write", async () => {
		let nowMs = 0;
		const { markCrawlProgress, calls } = recordWriter();
		const throttle = initProgressThrottle({
			markCrawlProgress,
			intervalMs: 1500,
			now: () => nowMs,
			logger: noopLogger,
		});

		// First report at t=0 — writes (initial value).
		throttle.report({ url: URL, partCurrent: 1, partTotal: 100 });
		// 9 more reports inside the throttle window — should not produce writes.
		for (let i = 2; i <= 10; i += 1) {
			nowMs += 100;
			throttle.report({ url: URL, partCurrent: i, partTotal: 100 });
		}
		await Promise.resolve();

		expect(calls).toEqual([{ url: URL, partCurrent: 1, partTotal: 100 }]);
	});

	it("writes again once the throttle window has elapsed since the last write", async () => {
		let nowMs = 0;
		const { markCrawlProgress, calls } = recordWriter();
		const throttle = initProgressThrottle({
			markCrawlProgress,
			intervalMs: 1500,
			now: () => nowMs,
			logger: noopLogger,
		});

		throttle.report({ url: URL, partCurrent: 1, partTotal: 100 });
		nowMs = 1500;
		throttle.report({ url: URL, partCurrent: 5, partTotal: 100 });
		nowMs = 3000;
		throttle.report({ url: URL, partCurrent: 9, partTotal: 100 });
		await Promise.resolve();

		expect(calls).toEqual([
			{ url: URL, partCurrent: 1, partTotal: 100 },
			{ url: URL, partCurrent: 5, partTotal: 100 },
			{ url: URL, partCurrent: 9, partTotal: 100 },
		]);
	});

	it("flush emits the latest stashed value when reports arrived after the most recent write", async () => {
		let nowMs = 0;
		const { markCrawlProgress, calls } = recordWriter();
		const throttle = initProgressThrottle({
			markCrawlProgress,
			intervalMs: 1500,
			now: () => nowMs,
			logger: noopLogger,
		});

		throttle.report({ url: URL, partCurrent: 1, partTotal: 100 });
		nowMs = 500;
		throttle.report({ url: URL, partCurrent: 50, partTotal: 100 });
		nowMs = 1000;
		throttle.report({ url: URL, partCurrent: 100, partTotal: 100 });
		await throttle.flush({ url: URL });

		expect(calls).toEqual([
			{ url: URL, partCurrent: 1, partTotal: 100 },
			{ url: URL, partCurrent: 100, partTotal: 100 },
		]);
	});

	it("flush is a no-op when nothing has changed since the last write", async () => {
		const { markCrawlProgress, calls } = recordWriter();
		const throttle = initProgressThrottle({
			markCrawlProgress,
			intervalMs: 1500,
			now: () => 0,
			logger: noopLogger,
		});

		throttle.report({ url: URL, partCurrent: 1, partTotal: 1 });
		await Promise.resolve();
		await throttle.flush({ url: URL });
		await throttle.flush({ url: URL });

		expect(calls).toEqual([{ url: URL, partCurrent: 1, partTotal: 1 }]);
	});

	it("flush is a no-op when no reports have been made for the URL", async () => {
		const { markCrawlProgress, calls } = recordWriter();
		const throttle = initProgressThrottle({
			markCrawlProgress,
			intervalMs: 1500,
			now: () => 0,
			logger: noopLogger,
		});

		await throttle.flush({ url: URL });

		expect(calls).toEqual([]);
	});

	it("logs a warning when the underlying write fails but does not throw — best-effort beacon", async () => {
		const warn = jest.fn();
		const failing: MarkCrawlProgress = async () => {
			throw new Error("DynamoDB throttled");
		};
		const throttle = initProgressThrottle({
			markCrawlProgress: failing,
			intervalMs: 1500,
			now: () => 0,
			logger: { ...noopLogger, warn },
		});

		throttle.report({ url: URL, partCurrent: 1, partTotal: 1 });
		await throttle.flush({ url: URL });

		expect(warn).toHaveBeenCalledTimes(2);
		expect(warn).toHaveBeenCalledWith(
			"[progress-throttle] write failed",
			expect.objectContaining({ url: URL, error: "Error: DynamoDB throttled" }),
		);
	});

	it("flush retries and succeeds when the initial fire-and-forget write failed", async () => {
		const warn = jest.fn();
		let callCount = 0;
		const calls: Recorded[] = [];
		const failOnce: MarkCrawlProgress = async (params) => {
			callCount += 1;
			if (callCount === 1) throw new Error("DynamoDB throttled");
			calls.push(params);
		};
		const throttle = initProgressThrottle({
			markCrawlProgress: failOnce,
			intervalMs: 1500,
			now: () => 0,
			logger: { ...noopLogger, warn },
		});

		throttle.report({ url: URL, partCurrent: 1, partTotal: 1 });
		await throttle.flush({ url: URL });

		expect(warn).toHaveBeenCalledTimes(1);
		expect(calls).toEqual([{ url: URL, partCurrent: 1, partTotal: 1 }]);
	});
});
