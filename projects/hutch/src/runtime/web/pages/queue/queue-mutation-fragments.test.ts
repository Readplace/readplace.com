import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	renderQueueCountsTrigger,
	renderQueueMutationFragment,
	renderStatusToast,
} from "./queue-mutation-fragments";
import type { QueueUrlState } from "./queue.url";

const DEFAULT_FILTERS: QueueUrlState = { tab: "queue", page: 1 };
const DEEP_FILTERS: QueueUrlState = { tab: "done", order: "asc", page: 2 };

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

describe("renderStatusToast", () => {
	it("renders the confirmation message, dismiss delay and a tracked Undo that posts the opposite status", () => {
		const doc = parse(
			renderStatusToast({
				message: "Marked as read",
				undoUrl: "/queue/abc123/status",
				undoStatus: "unread",
			}),
		);

		const toast = doc.querySelector("[data-test-toast]");
		assert(toast, "toast must render");
		assert.equal(toast.getAttribute("data-dismiss"), "6000");
		assert.equal(
			doc.querySelector("[data-test-toast-message]")?.textContent,
			"Marked as read",
		);

		const form = doc.querySelector("[data-test-toast-action]")?.closest("form");
		assert.equal(
			form?.getAttribute("action"),
			"/queue/abc123/status?utm_source=queue-toast&utm_medium=internal&utm_content=undo",
		);
		assert.equal(
			form?.querySelector("input[name='status']")?.getAttribute("value"),
			"unread",
		);
	});
});

describe("renderQueueCountsTrigger", () => {
	it("renders an inert loader span on the page (no OOB attribute)", () => {
		const span = parse(
			renderQueueCountsTrigger({ countsUrl: "/queue/counts?tab=done" }),
		).getElementById("queue-counts");
		assert(span, "counts span must render with a stable id");
		assert.equal(span.getAttribute("hx-get"), "/queue/counts?tab=done");
		assert.equal(span.getAttribute("hx-trigger"), "load");
		assert.equal(span.getAttribute("hx-swap"), "none");
		assert.equal(span.hasAttribute("hx-swap-oob"), false);
		assert.equal(span.hasAttribute("data-test-queue-counts"), true);
	});

	it("re-arms an identical span carrying hx-swap-oob for the mutation response", () => {
		const span = parse(
			renderQueueCountsTrigger({ countsUrl: "/queue/counts", oob: true }),
		).getElementById("queue-counts");
		assert(span, "counts span must render");
		assert.equal(span.getAttribute("hx-swap-oob"), "outerHTML");
		assert.equal(span.getAttribute("hx-trigger"), "load");
	});
});

describe("renderQueueMutationFragment", () => {
	it("carries only the re-armed counts span for a delete (no toast, no primary body)", () => {
		const doc = parse(renderQueueMutationFragment({ filters: DEFAULT_FILTERS }));

		assert.equal(doc.getElementById("status-toast"), null, "delete has no toast");
		const counts = doc.getElementById("queue-counts");
		assert(counts, "counts span must be present");
		assert.equal(counts.getAttribute("hx-swap-oob"), "outerHTML");
		assert.equal(counts.getAttribute("hx-get"), "/queue/counts");
		assert.equal(doc.querySelector(".queue-article"), null, "no card markup in the body");
	});

	it("wraps the toast in the stable #status-toast mount and re-arms counts for an applied status change", () => {
		const doc = parse(
			renderQueueMutationFragment({
				filters: DEFAULT_FILTERS,
				statusFlash: {
					message: "Marked as read",
					undoArticleId: "abc123",
					undoStatus: "unread",
				},
			}),
		);

		const mount = doc.getElementById("status-toast");
		assert(mount, "toast mount must render");
		assert.equal(mount.getAttribute("hx-swap-oob"), "outerHTML");
		assert.equal(
			mount.querySelector("[data-test-toast-message]")?.textContent,
			"Marked as read",
		);
		assert.equal(
			mount.querySelector("[data-test-toast-action]")?.closest("form")?.getAttribute("action"),
			"/queue/abc123/status?utm_source=queue-toast&utm_medium=internal&utm_content=undo",
		);
		assert(doc.getElementById("queue-counts"), "counts span must accompany the toast");
	});

	it("threads the reader's view state into the Undo href for a non-default view", () => {
		const doc = parse(
			renderQueueMutationFragment({
				filters: DEEP_FILTERS,
				statusFlash: {
					message: "Marked as unread",
					undoArticleId: "abc123",
					undoStatus: "read",
				},
			}),
		);

		assert.equal(
			doc.querySelector("[data-test-toast-action]")?.closest("form")?.getAttribute("action"),
			"/queue/abc123/status?tab=done&order=asc&page=2&utm_source=queue-toast&utm_medium=internal&utm_content=undo",
		);
		assert.equal(
			doc.getElementById("queue-counts")?.getAttribute("hx-get"),
			"/queue/counts?tab=done&order=asc&page=2",
		);
	});
});
