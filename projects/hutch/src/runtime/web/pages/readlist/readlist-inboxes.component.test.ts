import assert from "node:assert/strict";
import {
	AliasNameSchema,
	type InboxAddressEntry,
	type InboxAddressPurpose,
	InboxAddressSchema,
	InboxTokenSchema,
} from "@packages/domain/inbox";
import { DEFAULT_READLIST, ReadlistSlugSchema, type ReadlistSlug } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import { JSDOM } from "jsdom";
import { buildReadlistInboxes, renderReadlistInboxes } from "./readlist-inboxes.component";

const READER = UserIdSchema.parse("reader-1");
const WORK: ReadlistSlug = ReadlistSlugSchema.parse("a1b2c3d4");
const LATER: ReadlistSlug = ReadlistSlugSchema.parse("e5f6a7b8");
const DELETED: ReadlistSlug = ReadlistSlugSchema.parse("c9d0e1f2");

function inbox(input: {
	name: string;
	token: string;
	readlist?: ReadlistSlug;
	purpose?: InboxAddressPurpose;
	disabled?: boolean;
}): InboxAddressEntry {
	return {
		address: InboxAddressSchema.parse(`${input.name}-${input.token}@read.place`),
		userId: READER,
		name: AliasNameSchema.parse(input.name),
		token: InboxTokenSchema.parse(input.token),
		createdAt: "2026-09-24T00:00:00.000Z",
		disabledAt: input.disabled ? "2026-09-24T01:00:00.000Z" : undefined,
		purpose: input.purpose ?? "user-alias",
		readlist: input.readlist,
	};
}

function renderInboxes(input: {
	inboxes: readonly InboxAddressEntry[];
	purpose?: string;
}): Document {
	return new JSDOM(
		`<main>${renderReadlistInboxes(
			buildReadlistInboxes({
				readlist: {
					slug: WORK,
					label: "Work Reading",
					purpose: input.purpose,
				},
				inboxes: input.inboxes,
				readlists: [
					DEFAULT_READLIST,
					{ slug: WORK, label: "Work Reading" },
					{ slug: LATER, label: "Later" },
				],
			}),
		)}</main>`,
	).window.document;
}

function section(doc: Document): Element {
	const inboxes = doc.querySelector("[data-test-readlist-inboxes]");
	assert(inboxes, "the inboxes section must render in every state");
	return inboxes;
}

function row(doc: Document, address: string): Element {
	const found = doc.querySelector(`[data-test-preferences-inbox="${address}"]`);
	assert(found, `the ${address} row must render`);
	return found;
}

function rowSummaries(doc: Document) {
	return Array.from(doc.querySelectorAll("[data-test-preferences-inbox]"), (found) => ({
		name: found.querySelector("[data-test-inbox-name]")?.textContent,
		address: found.querySelector("[data-test-inbox-address]")?.textContent,
		destination: found.querySelector("[data-test-inbox-destination]")?.textContent,
		routed: found.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked,
	}));
}

function descriptionLines(doc: Document): string[] {
	return Array.from(doc.querySelectorAll("[data-test-inboxes-description]"), (line) => line.textContent);
}

function routeCheckbox(found: Element): HTMLInputElement {
	const checkbox = found.querySelector<HTMLInputElement>('input[type="checkbox"]');
	assert(checkbox, "every row must carry its Send to this readlist checkbox");
	return checkbox;
}

function hiddenFields(form: Element): Record<string, string | null> {
	return Object.fromEntries(
		Array.from(form.querySelectorAll('input[type="hidden"]'), (input) => [
			input.getAttribute("name"),
			input.getAttribute("value"),
		]),
	);
}

describe("buildReadlistInboxes", () => {
	it("says where each inbox's newsletters go now, ticking the ones sent here", () => {
		const doc = renderInboxes({
			inboxes: [
				inbox({ name: "news", token: "a7b2c9", readlist: WORK }),
				inbox({ name: "tech", token: "b8c3d0", readlist: LATER }),
				inbox({ name: "deals", token: "c9d4e1" }),
				inbox({ name: "old", token: "d0e5f2", readlist: DELETED }),
			],
		});

		expect(rowSummaries(doc)).toEqual([
			{
				name: "deals",
				address: "deals-c9d4e1@read.place",
				destination: "Saves to All",
				routed: false,
			},
			{
				name: "news",
				address: "news-a7b2c9@read.place",
				destination: "Saves to All and Work Reading",
				routed: true,
			},
			{
				name: "old",
				address: "old-d0e5f2@read.place",
				destination: "Saves to All",
				routed: false,
			},
			{
				name: "tech",
				address: "tech-b8c3d0@read.place",
				destination: "Saves to All and Later",
				routed: false,
			},
		]);
	});

	it("marks which inboxes already come to this readlist", () => {
		const doc = renderInboxes({
			inboxes: [
				inbox({ name: "news", token: "a7b2c9", readlist: WORK }),
				inbox({ name: "tech", token: "b8c3d0", readlist: LATER }),
			],
		});

		const routing = Array.from(doc.querySelectorAll("[data-test-preferences-inbox]"), (found) =>
			found.getAttribute("data-test-inbox-routing"),
		);
		expect(routing).toEqual(["here", "elsewhere"]);
	});

	it("lists mapped Gmail inboxes beside the reader's own, leaving out the Gmail gateway and every turned-off inbox", () => {
		const doc = renderInboxes({
			inboxes: [
				inbox({ name: "gmail", token: "a1a1a1", purpose: "gmail-forwarding" }),
				inbox({ name: "tldr", token: "b2b2b2", purpose: "gmail-mapped" }),
				inbox({ name: "paused", token: "c3c3c3", disabled: true }),
				inbox({ name: "stale", token: "d4d4d4", purpose: "gmail-mapped", disabled: true }),
				inbox({ name: "news", token: "e5e5e5" }),
			],
		});

		expect(rowSummaries(doc).map((summary) => summary.address)).toEqual([
			"news-e5e5e5@read.place",
			"tldr-b2b2b2@read.place",
		]);
	});

	it("orders inboxes by name, then by address when two share a name", () => {
		const doc = renderInboxes({
			inboxes: [
				inbox({ name: "news", token: "zz9999" }),
				inbox({ name: "alpha", token: "mm5555" }),
				inbox({ name: "news", token: "aa1111" }),
			],
		});

		expect(rowSummaries(doc).map((summary) => summary.address)).toEqual([
			"alpha-mm5555@read.place",
			"news-aa1111@read.place",
			"news-zz9999@read.place",
		]);
	});

	it("posts an inbox coming here back to All on untick, tagged as taking it away", () => {
		const doc = renderInboxes({ inboxes: [inbox({ name: "news", token: "a7b2c9", readlist: WORK })] });
		const found = row(doc, "news-a7b2c9@read.place");
		const form = found.querySelector("form");
		assert(form, "every row must carry its routing form");

		expect(form.getAttribute("method")).toBe("POST");
		expect(form.getAttribute("action")).toBe(
			`/queue/queues/${WORK}/preferences/inboxes?utm_source=queue-preferences&utm_medium=internal&utm_content=unroute-inbox`,
		);
		expect(hiddenFields(form)).toEqual({ address: "news-a7b2c9@read.place" });
		expect(routeCheckbox(found).checked).toBe(true);
	});

	it("posts any other inbox to this readlist on tick, tagged as bringing it here", () => {
		const doc = renderInboxes({ inboxes: [inbox({ name: "tech", token: "b8c3d0", readlist: LATER })] });
		const found = row(doc, "tech-b8c3d0@read.place");
		const form = found.querySelector("form");
		assert(form, "every row must carry its routing form");

		expect(form.getAttribute("action")).toBe(
			`/queue/queues/${WORK}/preferences/inboxes?utm_source=queue-preferences&utm_medium=internal&utm_content=route-inbox`,
		);
		expect(hiddenFields(form)).toEqual({ address: "tech-b8c3d0@read.place" });
		expect(routeCheckbox(found)).toMatchObject({ name: "send_here", value: "1", checked: false });
	});

	it("submits the row the moment its checkbox changes, keeping a Save button for readers without scripts", () => {
		const doc = renderInboxes({ inboxes: [inbox({ name: "news", token: "a7b2c9" })] });
		const found = row(doc, "news-a7b2c9@read.place");
		const checkbox = routeCheckbox(found);

		expect(checkbox.getAttribute("onclick")).toBe("this.form.requestSubmit()");
		expect(checkbox.id).toBe("readlist-inbox-news-a7b2c9@read.place");
		expect(checkbox.closest("label")?.textContent?.trim()).toBe("Send to this readlist");
		expect(found.querySelector("noscript")?.innerHTML).toContain("Save");
	});

	it("names each routing checkbox's inbox for assistive technology", () => {
		const doc = renderInboxes({
			inboxes: [inbox({ name: "news", token: "a7b2c9" }), inbox({ name: "tech", token: "b8c3d0" })],
		});

		const described = Array.from(
			doc.querySelectorAll('[data-test-preferences-inbox] input[type="checkbox"]'),
			(checkbox) => doc.getElementById(checkbox.getAttribute("aria-describedby") ?? "")?.textContent,
		);
		expect(described).toEqual(["news", "tech"]);
	});

	it("says a custom email sent here saves every article it links to into All and here", () => {
		const doc = renderInboxes({ inboxes: [] });

		expect(descriptionLines(doc)).toEqual([
			"Send a custom email here and every article each email links to is saved to 'All' and 'Work Reading'.",
		]);
		expect(doc.querySelector("[data-test-email-delivery-label]")?.textContent).toBe("The articles it links to");
	});

	it("adds that only the articles matching the purpose are saved here once the readlist has one", () => {
		const doc = renderInboxes({ inboxes: [], purpose: "Essays on how teams ship." });

		expect(descriptionLines(doc)).toEqual([
			"Send a custom email here and every article each email links to is saved to 'All'.",
			"Only the ones who match your preferences will be saved to 'Work Reading'",
		]);
		expect(doc.querySelector("[data-test-email-delivery-label]")?.textContent).toBe(
			"The articles it links to that matches this readlist preferences",
		);
	});

	it("names the section Readlist inbox emails and anchors it for the save redirect", () => {
		const doc = renderInboxes({ inboxes: [] });

		expect(section(doc).id).toBe("readlist-inboxes");
		expect(doc.getElementById("readlist-inboxes-title")?.textContent).toBe("Readlist inbox emails");
	});

	it("shows the empty state, with a tracked way to create an inbox, when the reader has none", () => {
		const doc = renderInboxes({ inboxes: [] });
		const create = doc.querySelector('[data-test-action="create-inbox"]');
		assert(create, "the empty state must offer to create an inbox");

		expect(section(doc).getAttribute("data-test-inboxes-state")).toBe("empty");
		expect(section(doc).classList.contains("readlist-inboxes--empty")).toBe(true);
		expect(create.textContent).toBe("Create a readlist inbox email");
		expect(create.getAttribute("href")).toBe(
			"/newsletters/custom-emails?utm_source=queue-preferences&utm_medium=internal&utm_content=create-inbox",
		);
	});

	it("offers a tracked way to manage the reader's custom emails once there are some to route", () => {
		const doc = renderInboxes({ inboxes: [inbox({ name: "news", token: "a7b2c9" })] });
		const manage = doc.querySelector('[data-test-action="manage-inboxes"]');
		assert(manage, "the listed state must offer to manage custom emails");

		expect(manage.textContent).toBe("Manage readlist inbox emails");
		expect(manage.getAttribute("href")).toBe(
			"/newsletters/custom-emails?utm_source=queue-preferences&utm_medium=internal&utm_content=manage-inboxes",
		);
	});

	it("shows the empty state when no inbox the reader has can be routed", () => {
		const doc = renderInboxes({
			inboxes: [
				inbox({ name: "gmail", token: "a1a1a1", purpose: "gmail-forwarding" }),
				inbox({ name: "paused", token: "c3c3c3", disabled: true }),
			],
		});

		expect(section(doc).getAttribute("data-test-inboxes-state")).toBe("empty");
	});

	it("swaps the empty state for the list once an inbox can be routed", () => {
		const doc = renderInboxes({ inboxes: [inbox({ name: "news", token: "a7b2c9" })] });

		expect(section(doc).getAttribute("data-test-inboxes-state")).toBe("listed");
		expect(section(doc).classList.contains("readlist-inboxes--listed")).toBe(true);
	});
});
