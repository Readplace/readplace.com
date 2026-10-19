import assert from "node:assert/strict";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initCaptureHost } from "./capture-host";

type Attributes = Record<string, string>;

function carriesEvery(selectors: string, attributes: Attributes): boolean {
	return selectors
		.slice(1, -1)
		.split("][")
		.every((name) => name in attributes);
}

function elementWith(attributes: Attributes) {
	return { getAttribute: (name: string) => attributes[name] ?? null };
}

function tapOn(ancestry: Attributes[]) {
	return {
		closest(selectors: string) {
			const match = ancestry.find((attributes) => carriesEvery(selectors, attributes));
			return match ? elementWith(match) : null;
		},
	};
}

const OFFERED_NOTICE: Attributes = {
	"data-reader-status": "blocked",
	"data-reader-rescue-url": "https://example.com/a",
	"data-reader-article-id": "article-1",
};

function createHarness(answer: () => Promise<unknown>) {
	const elements: Attributes[] = [];
	const rootAttributes = new Map<string, string>();
	const requests: unknown[] = [];
	const warnings: string[] = [];
	let announcements = 0;
	let failures = 0;

	const host = initCaptureHost({
		document: {
			querySelector(selectors) {
				const match = elements.find((attributes) => carriesEvery(selectors, attributes));
				return match ? elementWith(match) : null;
			},
			documentElement: {
				setAttribute(name, value) {
					rootAttributes.set(name, value);
				},
			},
		},
		requestRescue: (request) => {
			requests.push(request);
			return answer();
		},
		announceCaptureStarted: () => {
			announcements += 1;
		},
		announceCaptureFailed: () => {
			failures += 1;
		},
		logger: HutchLogger.from({ ...noopLogger, warn: (...args) => warnings.push(String(args[0])) }),
	});

	return { host, elements, rootAttributes, requests, warnings, announcements: () => announcements, failures: () => failures };
}

describe("initCaptureHost", () => {
	it("asks the background to rescue an offered notice automatically, once per article", async () => {
		const harness = createHarness(async () => ({ outcome: "started" }));
		harness.elements.push(OFFERED_NOTICE);

		await Promise.all([harness.host.pageChanged(), harness.host.pageChanged()]);
		harness.elements.splice(0, 1, { ...OFFERED_NOTICE, "data-reader-article-id": "article-2" });
		await harness.host.pageChanged();

		assert.deepEqual(harness.requests, [
			{ type: "reader-rescue", url: "https://example.com/a", articleId: "article-1", trigger: "automatic" },
			{ type: "reader-rescue", url: "https://example.com/a", articleId: "article-2", trigger: "automatic" },
		]);
	});

	it("asks nothing of a page whose notice offers no rescue", async () => {
		const harness = createHarness(async () => ({ outcome: "started" }));
		harness.elements.push({ "data-reader-status": "not-found" });

		await harness.host.pageChanged();

		assert.deepEqual(harness.requests, []);
	});

	it("reveals the capture control and announces the capture once the background started the rescue", async () => {
		const harness = createHarness(async () => ({ outcome: "started" }));
		harness.elements.push(OFFERED_NOTICE);

		await harness.host.pageChanged();

		assert.deepEqual([...harness.rootAttributes], [["data-reader-capture-host", ""]]);
		assert.equal(harness.announcements(), 1);
	});

	it("reveals the capture control as the retry, without announcing, when this device already tried the article", async () => {
		const harness = createHarness(async () => ({ outcome: "skipped", reason: "already-attempted" }));
		harness.elements.push(OFFERED_NOTICE);

		await harness.host.pageChanged();

		assert.deepEqual([...harness.rootAttributes], [["data-reader-capture-host", ""]]);
		assert.equal(harness.announcements(), 0);
	});

	it("keeps the capture control hidden and announces nothing while the extension is signed out", async () => {
		const harness = createHarness(async () => ({ outcome: "skipped", reason: "not-logged-in" }));
		harness.elements.push(OFFERED_NOTICE);

		await harness.host.pageChanged();

		assert.deepEqual([...harness.rootAttributes], []);
		assert.equal(harness.announcements(), 0);
	});

	it("does nothing with an answer it cannot read, including no answer at all", async () => {
		const unanswered = createHarness(async () => undefined);
		unanswered.elements.push(OFFERED_NOTICE);
		const refused = createHarness(async () => {
			throw new Error("Extension context invalidated.");
		});
		refused.elements.push(OFFERED_NOTICE);

		await unanswered.host.pageChanged();
		await refused.host.pageChanged();

		assert.deepEqual([...unanswered.rootAttributes, ...refused.rootAttributes], []);
		assert.equal(unanswered.announcements() + refused.announcements(), 0);
		assert.deepEqual(refused.warnings, ["[reader-rescue] the extension did not answer the rescue request"]);
	});

	it("asks for a manual rescue when the reader taps the offered capture control, and announces nothing", async () => {
		const harness = createHarness(async () => ({ outcome: "started" }));

		await harness.host.tapped(tapOn([{ "data-reader-capture": "" }, OFFERED_NOTICE]));

		assert.deepEqual(harness.requests, [
			{ type: "reader-rescue", url: "https://example.com/a", articleId: "article-1", trigger: "manual" },
		]);
		assert.equal(harness.announcements(), 0);
		assert.equal(harness.failures(), 0);
	});

	it("announces the capture failed when a tap is answered signed out", async () => {
		const harness = createHarness(async () => ({ outcome: "skipped", reason: "not-logged-in" }));

		await harness.host.tapped(tapOn([{ "data-reader-capture": "" }, OFFERED_NOTICE]));

		assert.equal(harness.failures(), 1);
	});

	it("announces the capture failed when a tap gets no answer", async () => {
		const harness = createHarness(async () => {
			throw new Error("Extension context invalidated.");
		});

		await harness.host.tapped(tapOn([{ "data-reader-capture": "" }, OFFERED_NOTICE]));

		assert.equal(harness.failures(), 1);
	});

	it("announces the capture failed when the background ends a rescue it was asked for", async () => {
		const tapped = createHarness(async () => ({ outcome: "started" }));
		const offered = createHarness(async () => ({ outcome: "started" }));
		offered.elements.push(OFFERED_NOTICE);

		await tapped.host.tapped(tapOn([{ "data-reader-capture": "" }, OFFERED_NOTICE]));
		await offered.host.pageChanged();
		tapped.host.rescueEnded({ type: "reader-rescue-ended", articleId: "article-1" });
		offered.host.rescueEnded({ type: "reader-rescue-ended", articleId: "article-1" });

		assert.equal(tapped.failures(), 1);
		assert.equal(offered.failures(), 1);
	});

	it("ignores the end of a rescue it never asked for, and messages it cannot read", async () => {
		const harness = createHarness(async () => ({ outcome: "started" }));
		harness.elements.push(OFFERED_NOTICE);
		await harness.host.pageChanged();

		harness.host.rescueEnded({ type: "reader-rescue-ended", articleId: "article-2" });
		harness.host.rescueEnded({ type: "capture-html" });
		harness.host.rescueEnded(undefined);

		assert.equal(harness.failures(), 0);
	});

	it("asks nothing for a tap outside the capture control", async () => {
		const harness = createHarness(async () => ({ outcome: "started" }));

		await harness.host.tapped(tapOn([{ href: "https://example.com/a" }, OFFERED_NOTICE]));

		assert.deepEqual(harness.requests, []);
	});
});
