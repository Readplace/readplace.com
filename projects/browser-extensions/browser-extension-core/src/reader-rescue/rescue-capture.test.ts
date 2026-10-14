import assert from "node:assert/strict";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import type { CaptureHtmlAnswer, HiddenTab, TabLoad } from "./hidden-tab";
import { type RescueCaptureResult, initRescueCapture } from "./rescue-capture";

const ARTICLE_URL = "https://example.com/a";
const LOAD_TIMEOUT_MS = 30_000;

const ARTICLE: CaptureHtmlAnswer = { rawHtml: "<html>article</html>", title: "The article", responseStatus: 200 };

interface Script {
	loads: TabLoad[];
	answers: (CaptureHtmlAnswer | undefined)[];
	closeFails?: boolean;
}

function createHarness(script: Script) {
	let fireDeadline: () => void = () => {};
	const deadline = new Promise<"timeout">((resolve) => {
		fireDeadline = () => resolve("timeout");
	});
	const deadlines: number[] = [];
	const opened: { url: string; openerTabId?: number }[] = [];
	const calls = { nextLoad: 0, captureHtml: 0, close: 0 };
	const infos: string[] = [];
	const debugs: string[] = [];

	const tab: HiddenTab = {
		tabId: 42,
		nextLoad: () => {
			calls.nextLoad += 1;
			const load = script.loads.shift();
			if (load) return Promise.resolve(load);
			fireDeadline();
			return new Promise(() => {});
		},
		captureHtml: async () => {
			calls.captureHtml += 1;
			return script.answers.shift();
		},
		close: async () => {
			calls.close += 1;
			if (script.closeFails) throw new Error("No tab with id: 42.");
		},
	};

	const capture = initRescueCapture({
		openHiddenTab: async (params) => {
			opened.push(params);
			return tab;
		},
		timers: {
			after: (ms) => {
				deadlines.push(ms);
				return deadline;
			},
		},
		loadTimeoutMs: LOAD_TIMEOUT_MS,
		logger: HutchLogger.from({
			...noopLogger,
			info: (...args) => infos.push(String(args[0])),
			debug: (...args) => debugs.push(String(args[0])),
		}),
	});

	return { capture, opened, calls, deadlines, infos, debugs };
}

function described(result: RescueCaptureResult) {
	if (result.kind === "no-capture") return result;
	return {
		kind: result.kind,
		title: result.title,
		mediaType: result.content.mediaType,
		html: new TextDecoder().decode(result.content.bytes),
	};
}

describe("initRescueCapture", () => {
	it("captures a 2xx document", async () => {
		const harness = createHarness({ loads: ["complete"], answers: [ARTICLE] });

		const result = await harness.capture({ url: ARTICLE_URL, openerTabId: 7 });

		assert.deepEqual(harness.opened, [{ url: ARTICLE_URL, openerTabId: 7 }]);
		assert.deepEqual(harness.deadlines, [LOAD_TIMEOUT_MS]);
		assert.deepEqual(described(result), {
			kind: "captured",
			title: "The article",
			mediaType: "text/html",
			html: "<html>article</html>",
		});
	});

	it("captures when the status is unknown", async () => {
		const harness = createHarness({
			loads: ["complete"],
			answers: [{ rawHtml: "<html>article</html>", title: "The article" }],
		});

		const result = await harness.capture({ url: ARTICLE_URL });

		assert.deepEqual(described(result), {
			kind: "captured",
			title: "The article",
			mediaType: "text/html",
			html: "<html>article</html>",
		});
	});

	it("refuses a non-2xx document and keeps waiting for the next load", async () => {
		const harness = createHarness({
			loads: ["complete"],
			answers: [{ rawHtml: "<html>reCAPTCHA</html>", title: "archive.today", responseStatus: 429 }],
		});

		const result = await harness.capture({ url: ARTICLE_URL });

		assert.deepEqual(result, { kind: "no-capture", reason: "blocked-status" });
		assert.equal(harness.calls.nextLoad, 2);
		assert.deepEqual(harness.deadlines, [LOAD_TIMEOUT_MS]);
		assert.ok(harness.infos.some((line) => line.includes(ARTICLE_URL) && line.includes("429")));
	});

	it("captures the article a challenge page navigated to", async () => {
		const harness = createHarness({
			loads: ["complete", "complete"],
			answers: [{ rawHtml: "<html>Just a moment...</html>", title: "Just a moment...", responseStatus: 503 }, ARTICLE],
		});

		const result = await harness.capture({ url: ARTICLE_URL });

		assert.deepEqual(harness.deadlines, [LOAD_TIMEOUT_MS]);
		assert.deepEqual(described(result), {
			kind: "captured",
			title: "The article",
			mediaType: "text/html",
			html: "<html>article</html>",
		});
	});

	it("gives up at the load deadline with timeout", async () => {
		const harness = createHarness({ loads: [], answers: [] });

		const result = await harness.capture({ url: ARTICLE_URL });

		assert.deepEqual(result, { kind: "no-capture", reason: "timeout" });
		assert.equal(harness.calls.captureHtml, 0);
	});

	it("gives up when the tab is closed", async () => {
		const harness = createHarness({ loads: ["removed"], answers: [] });

		const result = await harness.capture({ url: ARTICLE_URL });

		assert.deepEqual(result, { kind: "no-capture", reason: "closed" });
		assert.equal(harness.calls.captureHtml, 0);
	});

	it("treats an empty rawHtml as unreadable", async () => {
		const harness = createHarness({
			loads: ["complete"],
			answers: [{ rawHtml: "", title: "document.pdf", responseStatus: 200 }],
		});

		const result = await harness.capture({ url: ARTICLE_URL });

		assert.deepEqual(result, { kind: "no-capture", reason: "unreadable" });
	});

	it("treats a tab whose content script never answered as unreadable", async () => {
		const harness = createHarness({ loads: ["complete"], answers: [undefined] });

		const result = await harness.capture({ url: ARTICLE_URL });

		assert.deepEqual(result, { kind: "no-capture", reason: "unreadable" });
	});

	const ENDINGS: { ending: string; script: Script }[] = [
		{ ending: "captured", script: { loads: ["complete"], answers: [ARTICLE] } },
		{ ending: "timeout", script: { loads: [], answers: [] } },
		{ ending: "closed", script: { loads: ["removed"], answers: [] } },
		{ ending: "unreadable", script: { loads: ["complete"], answers: [undefined] } },
		{
			ending: "blocked-status",
			script: { loads: ["complete"], answers: [{ rawHtml: "<html>403</html>", title: "", responseStatus: 403 }] },
		},
	];

	it.each(ENDINGS)("closes the tab exactly once when the rescue ends as $ending", async ({ ending, script }) => {
		const harness = createHarness({ loads: [...script.loads], answers: [...script.answers] });

		const result = await harness.capture({ url: ARTICLE_URL });

		assert.equal(result.kind === "captured" ? result.kind : result.reason, ending);
		assert.equal(harness.calls.close, 1);
	});

	it("keeps the capture when the tab was already gone by the time it closes", async () => {
		const harness = createHarness({ loads: ["complete"], answers: [ARTICLE], closeFails: true });

		const result = await harness.capture({ url: ARTICLE_URL });

		assert.equal(result.kind, "captured");
		assert.ok(harness.debugs.some((line) => line.includes(ARTICLE_URL)));
	});
});
