import assert from "node:assert/strict";
import { EmailLinkOrdinalSchema, type InboxEmailLinkEntry } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { toInboxExcludedLinkViewModel } from "./inbox-excluded-link.viewmodel";

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
		anchorText: undefined,
		...overrides,
	};
}

function build(input: { link?: InboxEmailLinkEntry }) {
	return toInboxExcludedLinkViewModel({ link: input.link ?? link(), emailId: SK });
}

function saveActionOf(vm: ReturnType<typeof build>) {
	const [action, ...rest] = vm.actions;
	assert(action, "a saveable skipped row must offer its save action");
	assert.equal(rest.length, 0, "a skipped row offers its save and nothing else");
	return action;
}

describe("toInboxExcludedLinkViewModel", () => {
	it("names the row and its save button with ids stable across a swap", () => {
		const vm = build({ link: link({ ordinal: EmailLinkOrdinalSchema.parse("0007") }) });

		expect(vm.domId).toBe("inbox-skipped-0007");
		expect(saveActionOf(vm).buttonId).toBe("inbox-skipped-0007-save");
		expect(saveActionOf(vm).inPlaceTargetId).toBe("inbox-skipped-0007");
	});

	it("labels the row with the reason the classifier recorded", () => {
		expect(build({ link: link({ skipReason: "list-unsubscribe" }) }).reasonLabel).toBe(
			"Unsubscribe link",
		);
	});

	it("names a social link as one that is not saved automatically, and still offers its save", () => {
		const vm = build({
			link: link({ skipReason: "social-host", url: "https://www.linkedin.com/posts/someone" }),
		});

		expect(vm.reasonLabel).toBe("Social link — not saved automatically");
		expect(vm.url).toBe("https://www.linkedin.com/posts/someone");
		expect(saveActionOf(vm).method).toBe("POST");
	});

	it("labels a row with no recorded reason generically", () => {
		expect(build({ link: link({ skipReason: undefined }) }).reasonLabel).toBe("Not an article");
	});

	it("offers the save action for a saveable url", () => {
		const action = saveActionOf(build({}));
		expect(action.href).toBe(
			`/inbox/${encodeURIComponent(SK)}/links/0000/save?utm_source=inbox-excluded-link&utm_medium=internal&utm_content=save-link`,
		);
		expect(action.method).toBe("POST");
	});

	it("withholds the save action from a url the save pipeline would reject", () => {
		expect(build({ link: link({ url: "https://localhost/private" }) }).actions).toEqual([]);
	});

	it("withholds the save action from a private item identity", () => {
		expect(build({ link: link({ url: "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef" }) }).actions).toEqual([]);
	});

	it("offers to save the link as an article", () => {
		expect(saveActionOf(build({}))).toEqual(
			expect.objectContaining({
				label: "Save as article",
				ariaLabel: `Save as article: ${URL}`,
				saveState: "unsaved",
				iconName: undefined,
			}),
		);
	});
});
