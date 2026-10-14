import assert from "node:assert/strict";
import { initAnnounceCaptureStarted } from "./announce-capture-started";

type PageNode = { parentNode: PageNode | null };

function createHarness() {
	const body: PageNode = { parentNode: null };
	const listeners = new Map<string, (event: { target: unknown }) => void>();
	let notice: PageNode | null = null;
	let dispatched = 0;

	const announce = initAnnounceCaptureStarted({
		document: {
			addEventListener(type, listener) {
				listeners.set(type, listener);
			},
			querySelector: (selectors) => (selectors === "[data-reader-rescue-url]" ? notice : null),
		},
		dispatch: () => {
			dispatched += 1;
		},
	});

	return {
		announce,
		body,
		showNotice(parentNode: PageNode): PageNode {
			notice = { parentNode };
			return notice;
		},
		htmxLoaded: (target: PageNode) => listeners.get("htmx:load")?.({ target }),
		dispatched: () => dispatched,
	};
}

describe("initAnnounceCaptureStarted", () => {
	it("a capture started before htmx is live is announced once htmx has loaded the page holding the notice", () => {
		const harness = createHarness();
		harness.showNotice(harness.body);

		harness.announce();
		assert.equal(harness.dispatched(), 0);
		harness.htmxLoaded(harness.body);

		assert.equal(harness.dispatched(), 1);
	});

	it("a capture started after htmx has loaded the notice is announced at once", () => {
		const harness = createHarness();
		harness.showNotice(harness.body);

		harness.htmxLoaded(harness.body);
		assert.equal(harness.dispatched(), 0);
		harness.announce();

		assert.equal(harness.dispatched(), 1);
	});

	it("a capture started while no notice is on the page waits until htmx has loaded one", () => {
		const harness = createHarness();

		harness.announce();
		assert.equal(harness.dispatched(), 0);
		harness.htmxLoaded(harness.body);
		assert.equal(harness.dispatched(), 0);
		harness.htmxLoaded(harness.showNotice(harness.body));

		assert.equal(harness.dispatched(), 1);
	});

	it("a capture started for a notice swapped in by a poll waits until htmx has loaded that notice", () => {
		const harness = createHarness();
		harness.showNotice(harness.body);
		harness.htmxLoaded(harness.body);
		const swappedSection: PageNode = { parentNode: harness.body };
		const swappedNotice = harness.showNotice(swappedSection);

		harness.announce();
		harness.htmxLoaded({ parentNode: harness.body });
		assert.equal(harness.dispatched(), 0);
		harness.htmxLoaded(swappedSection);
		harness.htmxLoaded(swappedNotice);

		assert.equal(harness.dispatched(), 1);
	});
});
