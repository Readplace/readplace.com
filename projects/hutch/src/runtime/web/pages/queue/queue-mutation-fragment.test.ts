import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	QUEUE_COUNTS_ID,
	STATUS_TOAST_DISMISS_MS,
	STATUS_TOAST_MOUNT_ID,
	renderDeleteMutationFragment,
	renderQueueCountsTrigger,
	renderQueueStatusToast,
	renderStatusMutationFragment,
} from "./queue-mutation-fragment";

function parse(html: string): Document {
	return new JSDOM(`<main>${html}</main>`).window.document;
}

describe("renderQueueStatusToast", () => {
	it("renders the message, the dismiss window, and a working tracked Undo", () => {
		const html = renderQueueStatusToast({
			message: "Marked as read",
			undoUrl: "/queue/abc/status?order=asc",
			undoStatus: "unread",
		});
		const doc = parse(html);

		const toast = doc.querySelector("[data-test-toast]");
		assert(toast, "toast must render");
		expect(toast.getAttribute("data-dismiss")).toBe(String(STATUS_TOAST_DISMISS_MS));
		expect(doc.querySelector("[data-test-toast-message]")?.textContent).toBe("Marked as read");

		const undoForm = doc.querySelector("[data-test-toast-action]")?.closest("form");
		expect(undoForm?.getAttribute("action")).toBe(
			"/queue/abc/status?order=asc&utm_source=queue-toast&utm_medium=internal&utm_content=undo",
		);
		expect(undoForm?.querySelector("input[name='status']")?.getAttribute("value")).toBe("unread");
	});
});

describe("renderQueueCountsTrigger", () => {
	it("renders the inert loader span with the stable id when oob is false", () => {
		const html = renderQueueCountsTrigger({ countsUrl: "/queue/counts?tab=done", oob: false });
		const span = parse(html).querySelector("[data-test-queue-counts]");
		assert(span, "counts trigger span must render");
		expect(span.getAttribute("id")).toBe(QUEUE_COUNTS_ID);
		expect(span.getAttribute("hx-get")).toBe("/queue/counts?tab=done");
		expect(span.getAttribute("hx-trigger")).toBe("load");
		expect(span.getAttribute("hx-swap")).toBe("none");
		expect(span.hasAttribute("hx-swap-oob")).toBe(false);
	});

	it("adds the out-of-band swap marker when oob is true, keeping the load trigger", () => {
		const html = renderQueueCountsTrigger({ countsUrl: "/queue/counts", oob: true });
		const span = parse(html).querySelector("[data-test-queue-counts]");
		assert(span, "counts trigger span must render");
		expect(span.getAttribute("id")).toBe(QUEUE_COUNTS_ID);
		expect(span.getAttribute("hx-swap-oob")).toBe("outerHTML");
		expect(span.getAttribute("hx-trigger")).toBe("load");
	});
});

describe("renderStatusMutationFragment", () => {
	it("wraps the toast in the stable OOB mount and re-arms the counts loader", () => {
		const html = renderStatusMutationFragment({
			flash: { message: "Marked as unread", undoUrl: "/queue/abc/status", undoStatus: "read" },
			countsUrl: "/queue/counts",
		});
		const doc = parse(html);

		const mount = doc.getElementById(STATUS_TOAST_MOUNT_ID);
		assert(mount, "toast mount must be present");
		expect(mount.getAttribute("hx-swap-oob")).toBe("outerHTML");
		expect(mount.querySelector("[data-test-toast-message]")?.textContent).toBe("Marked as unread");

		const counts = doc.getElementById(QUEUE_COUNTS_ID);
		assert(counts, "counts re-arm span must be present");
		expect(counts.getAttribute("hx-swap-oob")).toBe("outerHTML");
		expect(counts.getAttribute("hx-trigger")).toBe("load");

		// Both fragments are out-of-band, so the primary swap content is empty and
		// removes the card htmx targeted.
		const oobIds = Array.from(doc.querySelectorAll("[hx-swap-oob]"), (el) => el.id).sort();
		expect(oobIds).toEqual([QUEUE_COUNTS_ID, STATUS_TOAST_MOUNT_ID].sort());
	});
});

describe("renderDeleteMutationFragment", () => {
	it("re-arms the counts loader only, carrying no toast", () => {
		const html = renderDeleteMutationFragment({ countsUrl: "/queue/counts?tab=done" });
		const doc = parse(html);

		// The only out-of-band element is the counts re-arm — delete has no toast,
		// so the status-toast mount is positively absent from the fragment's ids.
		const oobIds = Array.from(doc.querySelectorAll("[hx-swap-oob]"), (el) => el.id);
		expect(oobIds).toEqual([QUEUE_COUNTS_ID]);

		const counts = doc.getElementById(QUEUE_COUNTS_ID);
		assert(counts, "counts re-arm span must be present");
		expect(counts.getAttribute("hx-swap-oob")).toBe("outerHTML");
		expect(counts.getAttribute("hx-get")).toBe("/queue/counts?tab=done");
	});
});
