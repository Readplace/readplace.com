import assert from "node:assert/strict";
import { buildGmailUrl, confirmGmailReadlists, parseGmailPickerState } from "./gmail.url";

describe("Gmail page URL state", () => {
	it("reads the Add newsletters popup as open only for add=1", () => {
		assert.equal(parseGmailPickerState({ add: "1" }).add, "1");
		assert.equal(parseGmailPickerState({ add: "yes" }).add, undefined);
	});

	it("writes add right after edit, ahead of discovery", () => {
		assert.equal(
			buildGmailUrl({ discovery: "started", add: "1", edit: "1", search: "tl" }),
			"/newsletters/gmail?search=tl&edit=1&add=1&discovery=started",
		);
	});

	it("keeps an Edit popup open when its readlists are applied", () => {
		const confirmed = confirmGmailReadlists({ sender: ["dan@tldr.tech"], readlist_choice_for: "dan@tldr.tech", edit: "1" });
		assert.deepEqual(confirmed, { sender: ["dan@tldr.tech"], readlist_choice_for: undefined, edit: "1" });
	});
});
