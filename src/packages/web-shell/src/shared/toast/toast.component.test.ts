import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderToast } from "./toast.component";

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

describe("renderToast", () => {
	it("renders the message and exposes the dismiss delay as data-dismiss", () => {
		const doc = parse(
			renderToast({ message: "Marked as read", dismissMs: 10000, actions: [] }),
		);
		const toast = doc.querySelector("[data-test-toast]");
		assert(toast, "toast must render");
		expect(toast.getAttribute("data-dismiss")).toBe("10000");
		// Focusable but out of the tab order, so the global focus manager can land
		// keyboard focus here when the acted-on element didn't survive the swap.
		expect(toast.getAttribute("tabindex")).toBe("-1");
		expect(toast.querySelector("[data-test-toast-message]")?.textContent).toBe(
			"Marked as read",
		);
	});

	it("carries no live-region attributes: the shell's persistent #toast-live-region announces, so a self-announcing toast would double-speak", () => {
		const doc = parse(
			renderToast({ message: "Marked as read", dismissMs: 10000, actions: [] }),
		);
		const toast = doc.querySelector("[data-test-toast]");
		assert(toast, "toast must render");
		expect(toast.getAttribute("role")).toBeNull();
		expect(toast.getAttribute("aria-live")).toBeNull();
	});

	it("renders each action as a boosted form posting its hidden fields", () => {
		const doc = parse(
			renderToast({
				message: "Marked as read",
				dismissMs: 10000,
				actions: [
					{
						method: "POST",
						url: "/queue/abc/status",
						label: "Undo",
						fields: [{ name: "status", value: "unread" }],
					},
				],
			}),
		);
		const button = doc.querySelector("[data-test-toast-action]");
		assert(button, "action button must render");
		expect(button.textContent).toBe("Undo");
		const form = button.closest("form");
		assert(form, "action must be wrapped in a form");
		expect(form.getAttribute("method")).toBe("POST");
		expect(form.getAttribute("action")).toBe("/queue/abc/status");
		expect(
			form.querySelector("input[name='status']")?.getAttribute("value"),
		).toBe("unread");
	});

	it("gives the action button the in-flight loader affordance and disables it during the request", () => {
		const doc = parse(
			renderToast({
				message: "Marked as read",
				dismissMs: 10000,
				actions: [
					{
						method: "POST",
						url: "/queue/abc/status",
						label: "Undo",
						fields: [{ name: "status", value: "unread" }],
					},
				],
			}),
		);
		const button = doc.querySelector("[data-test-toast-action]");
		assert(button, "action button must render");

		const label = button.querySelector(".toast__action-label");
		assert(label, "action button must wrap its label in a label span");
		expect(label.textContent).toBe("Undo");
		expect(button.querySelectorAll(".toast__action-loader span").length).toBe(3);
		// Mid-request the label is visibility:hidden (dropped from the a11y tree)
		// and the loader is aria-hidden, so aria-label carries the button's
		// accessible name while it is disabled and in flight. aria-label (not
		// title) avoids a hover tooltip that would merely repeat the visible label.
		expect(button.getAttribute("aria-label")).toBe("Undo");

		expect(button.closest("form")?.getAttribute("hx-disabled-elt")).toBe("find button");
	});

	it("renders no action forms when the toast has no actions", () => {
		const doc = parse(renderToast({ message: "Saved", dismissMs: 4000, actions: [] }));
		const toast = doc.querySelector("[data-test-toast]");
		assert(toast, "toast must render");
		const actions = Array.from(toast.querySelectorAll("[data-test-toast-action]"));
		expect(actions.length).toBe(0);
	});
});
