import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { findPopoverFocusGaps } from "@packages/web-test-harness";
import {
	SHARING_OFF_POPOVER_ID,
	renderSharingOffDialog,
	renderSharingOffNote,
} from "./sharing-off-dialog.component";

const TITLE = "Sharing and EPUB download are off";
const BODY =
	"This issue is an email sent to you, so only you can open it. It has no public link to share or download.";

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

describe("renderSharingOffDialog", () => {
	it("titles the dialog with what is off and gives the reason in its body", () => {
		const dialog = parse(renderSharingOffDialog()).querySelector("[data-test-confirm-popover]");
		assert(dialog, "the dialog must render");

		expect([
			dialog.id,
			dialog.getAttribute("role"),
			dialog.getAttribute("data-test-confirm-popover"),
			dialog.querySelector(".confirm-popover__title")?.textContent,
			dialog.querySelector(".confirm-popover__body")?.textContent,
		]).toEqual([SHARING_OFF_POPOVER_ID, "dialog", "sharing-off", TITLE, BODY]);
	});

	it("offers one neutral Close, which takes focus and hides the dialog", () => {
		const doc = parse(renderSharingOffDialog());

		expect(
			Array.from(doc.querySelectorAll("button"), (button) => [
				button.className,
				button.textContent,
				button.getAttribute("popovertarget"),
				button.getAttribute("popovertargetaction"),
				button.hasAttribute("autofocus"),
				button.getAttribute("data-test-action"),
			]),
		).toEqual([["btn btn--neutral", "Close", SHARING_OFF_POPOVER_ID, "hide", true, "sharing-off-close"]]);
	});

	it("leaves no focus gap and links nowhere", () => {
		const html = renderSharingOffDialog();

		expect(findPopoverFocusGaps(html)).toEqual([]);
		expect(parse(html).querySelectorAll("[href]")).toHaveLength(0);
	});
});

describe("renderSharingOffNote", () => {
	it("carries the same title and reason with no id, focus target or button, so each fallback can hold a copy", () => {
		const doc = parse(renderSharingOffNote());
		const note = doc.querySelector(".article-body__sharing-off-note");
		assert(note, "the note must render");

		expect([
			note.querySelector(".confirm-popover__title")?.textContent,
			note.querySelector(".confirm-popover__body")?.textContent,
			doc.querySelectorAll("[id]").length,
			doc.querySelectorAll("[autofocus]").length,
			doc.querySelectorAll("button").length,
		]).toEqual([TITLE, BODY, 0, 0, 0]);
	});
});
