import assert from "node:assert/strict";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import type { CaptureTrigger, TabContent } from "../reading-list/reading-list.types";
import { initReaderRescue } from "./reader-rescue";
import type { RescueCaptureResult } from "./rescue-capture";

const ARTICLE_URL = "https://example.com/a";
const ARTICLE_CONTENT: TabContent = {
	bytes: new TextEncoder().encode("<html>article</html>").buffer,
	mediaType: "text/html",
};

function createHarness(
	options: { claim?: "first" | "repeat"; capture?: () => Promise<RescueCaptureResult> } = {},
) {
	const events: string[] = [];
	const enqueued: { url: string; title?: string; content: TabContent; trigger: CaptureTrigger }[] = [];
	const infos: string[] = [];
	const errors: string[] = [];

	const rescue = initReaderRescue({
		attempts: {
			claim: async (articleId) => {
				events.push(`claim ${articleId}`);
				return options.claim ?? "first";
			},
		},
		capture: async ({ url, openerTabId }) => {
			events.push(`capture ${url} beside ${openerTabId}`);
			return options.capture ? options.capture() : { kind: "captured", content: ARTICLE_CONTENT, title: "The article" };
		},
		enqueueCaptured: async (captured) => {
			events.push(`enqueue ${captured.url}`);
			enqueued.push(captured);
		},
		logger: HutchLogger.from({
			...noopLogger,
			info: (...args) => infos.push(String(args[0])),
			error: (...args) => errors.push(String(args[0])),
		}),
	});

	return { rescue, events, enqueued, infos, errors };
}

describe("initReaderRescue", () => {
	it("an automatic rescue claims the article id before the tab opens", async () => {
		const harness = createHarness();

		const { answer, completion } = await harness.rescue({
			url: ARTICLE_URL,
			articleId: "article-1",
			trigger: "automatic",
			openerTabId: 7,
		});
		await completion;

		assert.deepEqual(answer, { outcome: "started" });
		assert.deepEqual(harness.events, ["claim article-1", `capture ${ARTICLE_URL} beside 7`, `enqueue ${ARTICLE_URL}`]);
	});

	it("a repeated automatic rescue of the same article id is skipped without opening a tab", async () => {
		const harness = createHarness({ claim: "repeat" });

		const { answer, completion } = await harness.rescue({
			url: ARTICLE_URL,
			articleId: "article-1",
			trigger: "automatic",
		});
		await completion;

		assert.deepEqual(answer, { outcome: "skipped", reason: "already-attempted" });
		assert.deepEqual(harness.events, ["claim article-1"]);
	});

	it("a manual rescue ignores the memory", async () => {
		const harness = createHarness({ claim: "repeat" });

		const { answer, completion } = await harness.rescue({
			url: ARTICLE_URL,
			articleId: "article-1",
			trigger: "manual",
		});
		await completion;

		assert.deepEqual(answer, { outcome: "started" });
		assert.deepEqual(harness.events, [`capture ${ARTICLE_URL} beside undefined`, `enqueue ${ARTICLE_URL}`]);
	});

	it("a captured page is enqueued with its trigger", async () => {
		const harness = createHarness();

		await (await harness.rescue({ url: ARTICLE_URL, articleId: "article-1", trigger: "automatic" })).completion;
		await (await harness.rescue({ url: ARTICLE_URL, articleId: "article-1", trigger: "manual" })).completion;

		assert.deepEqual(harness.enqueued, [
			{ url: ARTICLE_URL, title: "The article", content: ARTICLE_CONTENT, trigger: "automatic" },
			{ url: ARTICLE_URL, title: "The article", content: ARTICLE_CONTENT, trigger: "manual" },
		]);
	});

	it("a refused capture enqueues nothing and resolves completion", async () => {
		const harness = createHarness({ capture: async () => ({ kind: "no-capture", reason: "blocked-status" }) });

		const { completion } = await harness.rescue({ url: ARTICLE_URL, articleId: "article-1", trigger: "automatic" });
		await completion;

		assert.deepEqual(harness.enqueued, []);
		assert.ok(harness.infos.some((line) => line.includes(ARTICLE_URL) && line.includes("blocked-status")));
	});

	it("a capture that fails is logged, enqueues nothing and resolves completion", async () => {
		const harness = createHarness({
			capture: async () => {
				throw new Error("Tabs cannot be edited right now (user may be dragging a tab).");
			},
		});

		const { answer, completion } = await harness.rescue({
			url: ARTICLE_URL,
			articleId: "article-1",
			trigger: "automatic",
		});
		await completion;

		assert.deepEqual(answer, { outcome: "started" });
		assert.deepEqual(harness.enqueued, []);
		assert.ok(harness.errors.some((line) => line.includes(ARTICLE_URL)));
	});
});
