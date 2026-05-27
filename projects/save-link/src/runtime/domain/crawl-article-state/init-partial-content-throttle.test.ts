import { noopLogger } from "@packages/hutch-logger";
import { initPartialContentThrottle } from "./init-partial-content-throttle";
import type { MarkCrawlPartial } from "../../providers/article-crawl/mark-crawl-partial";

type Recorded = { url: string; content: string };

function recordWriter(): {
	markCrawlPartial: MarkCrawlPartial;
	calls: Recorded[];
} {
	const calls: Recorded[] = [];
	const markCrawlPartial: MarkCrawlPartial = async (params) => {
		calls.push(params);
	};
	return { markCrawlPartial, calls };
}

const URL = "https://example.com/x.pdf";

describe("initPartialContentThrottle", () => {
	it("writes the first report immediately so the reader sees content as soon as it exists", async () => {
		const { markCrawlPartial, calls } = recordWriter();
		const throttle = initPartialContentThrottle({
			markCrawlPartial,
			intervalMs: 1000,
			now: () => 0,
			logger: noopLogger,
		});

		throttle.report({ url: URL, html: "<p>first</p>" });
		await Promise.resolve();
		await throttle.flush({ url: URL });

		expect(calls).toEqual([{ url: URL, content: "<p>first</p>" }]);
	});

	it("collapses rapid reports inside the throttle window down to a single write", async () => {
		let nowMs = 0;
		const { markCrawlPartial, calls } = recordWriter();
		const throttle = initPartialContentThrottle({
			markCrawlPartial,
			intervalMs: 1000,
			now: () => nowMs,
			logger: noopLogger,
		});

		throttle.report({ url: URL, html: "<p>a</p>" });
		for (let i = 0; i < 10; i += 1) {
			nowMs += 50;
			throttle.report({ url: URL, html: `<p>a</p><p>${i}</p>` });
		}
		await Promise.resolve();

		expect(calls).toEqual([{ url: URL, content: "<p>a</p>" }]);
	});

	it("writes again once the throttle window has elapsed since the last write", async () => {
		let nowMs = 0;
		const { markCrawlPartial, calls } = recordWriter();
		const throttle = initPartialContentThrottle({
			markCrawlPartial,
			intervalMs: 1000,
			now: () => nowMs,
			logger: noopLogger,
		});

		throttle.report({ url: URL, html: "<p>1</p>" });
		nowMs = 1000;
		throttle.report({ url: URL, html: "<p>1</p><p>2</p>" });
		nowMs = 2000;
		throttle.report({ url: URL, html: "<p>1</p><p>2</p><p>3</p>" });
		await Promise.resolve();

		expect(calls).toEqual([
			{ url: URL, content: "<p>1</p>" },
			{ url: URL, content: "<p>1</p><p>2</p>" },
			{ url: URL, content: "<p>1</p><p>2</p><p>3</p>" },
		]);
	});

	it("skips reports that match the last written length (no-op when nothing actually changed)", async () => {
		let nowMs = 0;
		const { markCrawlPartial, calls } = recordWriter();
		const throttle = initPartialContentThrottle({
			markCrawlPartial,
			intervalMs: 1000,
			now: () => nowMs,
			logger: noopLogger,
		});

		throttle.report({ url: URL, html: "<p>abc</p>" });
		await Promise.resolve();
		nowMs = 5000;
		// Same length as last write — should not produce another write.
		throttle.report({ url: URL, html: "<p>xyz</p>" });
		await Promise.resolve();

		expect(calls).toEqual([{ url: URL, content: "<p>abc</p>" }]);
	});

	it("flush emits the latest stashed value when reports arrived after the most recent write", async () => {
		let nowMs = 0;
		const { markCrawlPartial, calls } = recordWriter();
		const throttle = initPartialContentThrottle({
			markCrawlPartial,
			intervalMs: 1000,
			now: () => nowMs,
			logger: noopLogger,
		});

		throttle.report({ url: URL, html: "<p>1</p>" });
		nowMs = 500;
		throttle.report({ url: URL, html: "<p>1</p><p>2</p>" });
		await throttle.flush({ url: URL });

		expect(calls).toEqual([
			{ url: URL, content: "<p>1</p>" },
			{ url: URL, content: "<p>1</p><p>2</p>" },
		]);
	});

	it("flush is a no-op when nothing has changed since the last write", async () => {
		const { markCrawlPartial, calls } = recordWriter();
		const throttle = initPartialContentThrottle({
			markCrawlPartial,
			intervalMs: 1000,
			now: () => 0,
			logger: noopLogger,
		});

		throttle.report({ url: URL, html: "<p>only</p>" });
		await Promise.resolve();
		await throttle.flush({ url: URL });
		await throttle.flush({ url: URL });

		expect(calls).toEqual([{ url: URL, content: "<p>only</p>" }]);
	});

	it("flush with an explicit html writes that html (terminal value belt-and-braces)", async () => {
		const { markCrawlPartial, calls } = recordWriter();
		const throttle = initPartialContentThrottle({
			markCrawlPartial,
			intervalMs: 1000,
			now: () => 0,
			logger: noopLogger,
		});

		throttle.report({ url: URL, html: "<p>partial</p>" });
		await Promise.resolve();
		await throttle.flush({ url: URL, html: "<p>partial</p><p>more</p>" });

		expect(calls).toEqual([
			{ url: URL, content: "<p>partial</p>" },
			{ url: URL, content: "<p>partial</p><p>more</p>" },
		]);
	});

	it("flush with an explicit html on a never-reported url still writes that html", async () => {
		const { markCrawlPartial, calls } = recordWriter();
		const throttle = initPartialContentThrottle({
			markCrawlPartial,
			intervalMs: 1000,
			now: () => 0,
			logger: noopLogger,
		});

		await throttle.flush({ url: URL, html: "<p>only the final</p>" });

		expect(calls).toEqual([{ url: URL, content: "<p>only the final</p>" }]);
	});

	it("flush is a no-op when no reports have been made for the URL and no explicit html is provided", async () => {
		const { markCrawlPartial, calls } = recordWriter();
		const throttle = initPartialContentThrottle({
			markCrawlPartial,
			intervalMs: 1000,
			now: () => 0,
			logger: noopLogger,
		});

		await throttle.flush({ url: URL });

		expect(calls).toEqual([]);
	});

	it("logs a warning when the underlying write fails but does not throw — best-effort beacon", async () => {
		const warn = jest.fn();
		const failing: MarkCrawlPartial = async () => {
			throw new Error("DynamoDB throttled");
		};
		const throttle = initPartialContentThrottle({
			markCrawlPartial: failing,
			intervalMs: 1000,
			now: () => 0,
			logger: { ...noopLogger, warn },
		});

		throttle.report({ url: URL, html: "<p>x</p>" });
		await throttle.flush({ url: URL });

		expect(warn).toHaveBeenCalledWith(
			"[partial-content-throttle] write failed",
			expect.objectContaining({ url: URL, error: "Error: DynamoDB throttled" }),
		);
	});
});
