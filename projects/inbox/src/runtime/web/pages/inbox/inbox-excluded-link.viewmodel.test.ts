import {
	EmailLinkOrdinalSchema,
	type InboxEmailLinkEntry,
	type InboxLinkSaveState,
} from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import {
	type ExcludedLinkPollContext,
	toInboxExcludedLinkViewModel,
} from "./inbox-excluded-link.viewmodel";

const SK = "2026-06-24T09:00:00.000Z#<m@x>";
const URL = "https://sponsor.example.com/deal";

function link(overrides: Partial<InboxEmailLinkEntry> = {}): InboxEmailLinkEntry {
	return {
		userId: UserIdSchema.parse("user-1"),
		receivedAtMessageId: SK,
		ordinal: EmailLinkOrdinalSchema.parse("0000"),
		url: URL,
		resolvedUrl: undefined,
		status: "skipped",
		title: undefined,
		excerpt: undefined,
		siteName: undefined,
		imageUrl: undefined,
		failureReason: undefined,
		skipReason: "llm-ad",
		...overrides,
	};
}

function build(input: {
	link?: InboxEmailLinkEntry;
	saveState?: InboxLinkSaveState;
	pollContext?: ExcludedLinkPollContext;
}) {
	return toInboxExcludedLinkViewModel({
		link: input.link ?? link(),
		emailId: SK,
		linkSaveStates:
			input.saveState === undefined ? new Map() : new Map([[URL, input.saveState]]),
		pollContext: input.pollContext ?? { mode: "static" },
	});
}

const savePoll = (pollCount: number): ExcludedLinkPollContext => ({
	mode: "save-poll",
	pollCount,
	maxPolls: 20,
});

describe("toInboxExcludedLinkViewModel", () => {
	it("names the row and its save button with ids stable across a swap", () => {
		const vm = build({ link: link({ ordinal: EmailLinkOrdinalSchema.parse("0007") }) });

		expect(vm.domId).toBe("inbox-skipped-0007");
		expect(vm.saveButtonId).toBe("inbox-skipped-0007-save");
	});

	it("labels the row with the reason the classifier recorded", () => {
		expect(build({ link: link({ skipReason: "list-unsubscribe" }) }).reasonLabel).toBe(
			"Unsubscribe link",
		);
	});

	it("labels a row with no recorded reason generically", () => {
		expect(build({ link: link({ skipReason: undefined }) }).reasonLabel).toBe("Not an article");
	});

	it("offers the save action for a saveable url", () => {
		expect(build({}).saveAction).toBe(
			`/inbox/${encodeURIComponent(SK)}/links/0000/save?utm_source=inbox-excluded-link&utm_medium=internal&utm_content=save-link`,
		);
	});

	it("withholds the save action from a url the save pipeline would reject", () => {
		expect(build({ link: link({ url: "https://localhost/private" }) }).saveAction).toBeUndefined();
	});

	it("never polls on a page render, where no recorded save means nobody clicked", () => {
		const vm = build({ pollContext: { mode: "static" } });

		expect(vm.pollUrl).toBeUndefined();
		expect(vm.saveButton.saveState).toBe("unsaved");
		expect(vm.saveButton.label).toBe("Save to queue");
	});

	it("renders a page render of an already-saved row as saved, still without polling", () => {
		const vm = build({ saveState: "saved", pollContext: { mode: "static" } });

		expect(vm.pollUrl).toBeUndefined();
		expect(vm.saveButton.saveState).toBe("saved");
		expect(vm.saveButton.label).toBe("Save again");
	});

	it("reads as saving and polls on while an accepted save has not reached the read model", () => {
		const vm = build({ pollContext: savePoll(4) });

		expect(vm.pollUrl).toBe(`/inbox/${encodeURIComponent(SK)}/links/0000/excluded?poll=4`);
		expect(vm.saveButton).toEqual({
			label: "Saving…",
			ariaLabel: `Saving to queue: ${URL}`,
			saveState: "saving",
			iconName: undefined,
		});
	});

	it("stops polling the moment the save is recorded", () => {
		const vm = build({ saveState: "saved", pollContext: savePoll(4) });

		expect(vm.pollUrl).toBeUndefined();
		expect(vm.saveButton.saveState).toBe("saved");
	});

	it("stops polling on a recorded failure and offers the save again", () => {
		const vm = build({ saveState: "failed", pollContext: savePoll(4) });

		expect(vm.pollUrl).toBeUndefined();
		expect(vm.saveButton.saveState).toBe("unsaved");
		expect(vm.saveButton.label).toBe("Save to queue");
	});

	it("gives up rather than claim Saving… forever once the settle budget is spent", () => {
		const vm = build({ pollContext: savePoll(21) });

		expect(vm.pollUrl).toBeUndefined();
		expect(vm.saveButton.saveState).toBe("unsaved");
	});

	it("keeps polling on the last tick the budget allows", () => {
		expect(build({ pollContext: savePoll(20) }).pollUrl).toBe(
			`/inbox/${encodeURIComponent(SK)}/links/0000/excluded?poll=20`,
		);
	});
});
